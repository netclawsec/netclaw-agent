const crypto = require('node:crypto');
const { db } = require('../db');
const {
  hashPassword,
  verifyPassword,
  assertEmployeePasswordStrength,
  PasswordError
} = require('../auth/password');
const departments = require('./departments');

const RAW_USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
const FINGERPRINT_RE = /^[A-Za-z0-9_-]{8,128}$/;

class EmployeeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'EmployeeError';
  }
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO tenant_employees (
      id, tenant_id, department_id, username, raw_username,
      password_hash, display_name, status, machine_fingerprint,
      bound_at, password_changed_at, created_at, created_by
    ) VALUES (
      @id, @tenant_id, @department_id, @username, @raw_username,
      @password_hash, @display_name, @status, @machine_fingerprint,
      @bound_at, @password_changed_at, @created_at, @created_by
    )
  `),
  getById:        db.prepare('SELECT * FROM tenant_employees WHERE id = ?'),
  getByUsername:  db.prepare('SELECT * FROM tenant_employees WHERE tenant_id = ? AND username = ?'),
  listByTenant:   db.prepare(`
    SELECT te.*, d.name AS department_name, d.abbrev AS department_abbrev
    FROM tenant_employees te
    JOIN departments d ON d.id = te.department_id
    WHERE te.tenant_id = ?
    ORDER BY te.status ASC, te.created_at DESC
  `),
  setStatus:        db.prepare('UPDATE tenant_employees SET status = ? WHERE id = ?'),
  setDisplayName:   db.prepare('UPDATE tenant_employees SET display_name = ? WHERE id = ?'),
  setDepartment:    db.prepare('UPDATE tenant_employees SET department_id = ? WHERE id = ?'),
  setPassword:      db.prepare(`
    UPDATE tenant_employees
       SET password_hash = ?, password_changed_at = ?
     WHERE id = ?
  `),
  setMachine:       db.prepare(`
    UPDATE tenant_employees
       SET machine_fingerprint = ?, bound_at = ?
     WHERE id = ?
  `),
  unbindMachine:    db.prepare(`
    UPDATE tenant_employees
       SET machine_fingerprint = NULL, bound_at = NULL
     WHERE id = ?
  `),
  touchLogin:       db.prepare('UPDATE tenant_employees SET last_login_at = ? WHERE id = ?'),
  delete:           db.prepare('DELETE FROM tenant_employees WHERE id = ?')
};

function nowIso() {
  return new Date().toISOString();
}

function assertRawUsername(raw) {
  if (typeof raw !== 'string' || !RAW_USERNAME_RE.test(raw)) {
    throw new EmployeeError(
      'invalid_username',
      'raw_username must be 2-32 chars; lowercase letters/digits/._-'
    );
  }
}

function assertFingerprint(fp) {
  if (typeof fp !== 'string' || !FINGERPRINT_RE.test(fp)) {
    throw new EmployeeError(
      'invalid_fingerprint',
      'machine_fingerprint must be 8-128 chars [A-Za-z0-9_-]'
    );
  }
}

function buildUsername(abbrev, raw_username) {
  return `${abbrev}-${raw_username}`;
}

function publicView(emp) {
  if (!emp) return null;
  // Strip password_hash from any client-facing payload.
  const { password_hash: _omit, ...rest } = emp;
  return rest;
}

async function createEmployee({
  tenant_id,
  department_id,
  raw_username,
  password,
  machine_fingerprint,
  display_name = null,
  created_by = null
}) {
  if (!tenant_id) throw new EmployeeError('invalid_tenant', 'tenant_id required');
  const dept = departments.getDepartment(department_id);
  if (!dept || dept.tenant_id !== tenant_id) {
    throw new EmployeeError('department_not_found', 'department does not belong to this tenant');
  }
  if (dept.status !== 'active') {
    throw new EmployeeError('department_archived', 'department is archived');
  }
  assertRawUsername(raw_username);
  assertFingerprint(machine_fingerprint);
  try {
    assertEmployeePasswordStrength(password);
  } catch (err) {
    if (err instanceof PasswordError) throw new EmployeeError(err.code, err.message);
    throw err;
  }
  const username = buildUsername(dept.abbrev, raw_username);
  if (stmts.getByUsername.get(tenant_id, username)) {
    throw new EmployeeError('username_exists', `username "${username}" already taken in this tenant`);
  }
  const password_hash = await hashPassword(password);
  const now = nowIso();
  const emp = {
    id: crypto.randomUUID(),
    tenant_id,
    department_id,
    username,
    raw_username,
    password_hash,
    display_name,
    status: 'active',
    machine_fingerprint,
    bound_at: now,
    password_changed_at: now,
    created_at: now,
    created_by
  };
  stmts.insert.run(emp);
  return publicView(emp);
}

function getEmployee(id) {
  return publicView(stmts.getById.get(id));
}

function getEmployeeByUsername(tenant_id, username) {
  return publicView(stmts.getByUsername.get(tenant_id, username));
}

function listEmployees(tenant_id) {
  return stmts.listByTenant.all(tenant_id).map(publicView);
}

function updateEmployee(id, { display_name, department_id }) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  if (display_name !== undefined) {
    if (display_name !== null && (typeof display_name !== 'string' || display_name.length > 100)) {
      throw new EmployeeError('invalid_display_name', 'display_name must be ≤ 100 chars');
    }
    stmts.setDisplayName.run(display_name, id);
  }
  if (department_id !== undefined && department_id !== existing.department_id) {
    const dept = departments.getDepartment(department_id);
    if (!dept || dept.tenant_id !== existing.tenant_id) {
      throw new EmployeeError('department_not_found', 'department does not belong to this tenant');
    }
    stmts.setDepartment.run(department_id, id);
  }
  return getEmployee(id);
}

function setStatus(id, status) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  if (!['active', 'suspended', 'deleted'].includes(status)) {
    throw new EmployeeError('invalid_status', 'status must be active|suspended|deleted');
  }
  stmts.setStatus.run(status, id);
  if (status !== 'active') {
    stmts.unbindMachine.run(id);
  }
  return getEmployee(id);
}

function unbindMachine(id) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  stmts.unbindMachine.run(id);
  return getEmployee(id);
}

async function changePassword(id, oldPassword, newPassword) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  const ok = await verifyPassword(oldPassword, existing.password_hash);
  if (!ok) throw new EmployeeError('bad_old_password', 'current password is incorrect');
  try {
    assertEmployeePasswordStrength(newPassword);
  } catch (err) {
    if (err instanceof PasswordError) throw new EmployeeError(err.code, err.message);
    throw err;
  }
  const hash = await hashPassword(newPassword);
  stmts.setPassword.run(hash, nowIso(), id);
  return getEmployee(id);
}

async function authenticate(tenant_id, username, password, machine_fingerprint) {
  const emp = stmts.getByUsername.get(tenant_id, username);
  if (!emp) throw new EmployeeError('bad_credentials', 'username or password incorrect');
  if (emp.status !== 'active') throw new EmployeeError('not_active', `account is ${emp.status}`);
  const ok = await verifyPassword(password, emp.password_hash);
  if (!ok) throw new EmployeeError('bad_credentials', 'username or password incorrect');
  assertFingerprint(machine_fingerprint);
  if (emp.machine_fingerprint && emp.machine_fingerprint !== machine_fingerprint) {
    throw new EmployeeError(
      'fingerprint_mismatch',
      'this employee is bound to another machine; ask your tenant admin to unbind'
    );
  }
  if (!emp.machine_fingerprint) {
    stmts.setMachine.run(machine_fingerprint, nowIso(), emp.id);
  }
  stmts.touchLogin.run(nowIso(), emp.id);
  return getEmployee(emp.id);
}

function deleteEmployee(id) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  stmts.delete.run(id);
  return publicView(existing);
}

module.exports = {
  EmployeeError,
  createEmployee,
  getEmployee,
  getEmployeeByUsername,
  listEmployees,
  updateEmployee,
  setStatus,
  unbindMachine,
  changePassword,
  authenticate,
  deleteEmployee,
  buildUsername
};
