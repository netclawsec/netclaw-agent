const crypto = require('node:crypto');
const { db } = require('../db');

const NAME_RE = /^.{1,40}$/;
const ABBREV_RE = /^[a-z0-9]{2,8}$/;

class DepartmentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'DepartmentError';
  }
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO departments (id, tenant_id, name, abbrev, status, created_at, created_by)
    VALUES (@id, @tenant_id, @name, @abbrev, @status, @created_at, @created_by)
  `),
  getById: db.prepare('SELECT * FROM departments WHERE id = ?'),
  getByAbbrev: db.prepare('SELECT * FROM departments WHERE tenant_id = ? AND abbrev = ?'),
  getByName: db.prepare('SELECT * FROM departments WHERE tenant_id = ? AND name = ?'),
  listByTenant: db.prepare(
    'SELECT * FROM departments WHERE tenant_id = ? ORDER BY status DESC, created_at ASC'
  ),
  setName:    db.prepare('UPDATE departments SET name = ? WHERE id = ?'),
  setAbbrev:  db.prepare('UPDATE departments SET abbrev = ? WHERE id = ?'),
  setStatus:  db.prepare('UPDATE departments SET status = ? WHERE id = ?'),
  delete:     db.prepare('DELETE FROM departments WHERE id = ?'),
  countActiveEmployees: db.prepare(
    `SELECT COUNT(*) AS n FROM tenant_employees
     WHERE department_id = ? AND status IN ('active', 'suspended')`
  )
};

function nowIso() {
  return new Date().toISOString();
}

function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new DepartmentError('invalid_name', 'name must be 1-40 chars');
  }
}

function assertAbbrev(abbrev) {
  if (typeof abbrev !== 'string' || !ABBREV_RE.test(abbrev)) {
    throw new DepartmentError(
      'invalid_abbrev',
      'abbrev must be 2-8 chars, lowercase letters/digits only'
    );
  }
}

function createDepartment({ tenant_id, name, abbrev, created_by }) {
  if (!tenant_id) throw new DepartmentError('invalid_tenant', 'tenant_id required');
  assertName(name);
  assertAbbrev(abbrev);
  if (stmts.getByAbbrev.get(tenant_id, abbrev)) {
    throw new DepartmentError('abbrev_exists', `abbrev "${abbrev}" already used in this tenant`);
  }
  if (stmts.getByName.get(tenant_id, name)) {
    throw new DepartmentError('name_exists', `name "${name}" already used in this tenant`);
  }
  const dept = {
    id: crypto.randomUUID(),
    tenant_id,
    name,
    abbrev,
    status: 'active',
    created_at: nowIso(),
    created_by: created_by ?? null
  };
  stmts.insert.run(dept);
  return dept;
}

function getDepartment(id) {
  return stmts.getById.get(id) || null;
}

function listDepartments(tenant_id) {
  return stmts.listByTenant.all(tenant_id);
}

function updateDepartment(id, { name, abbrev, status }) {
  const existing = getDepartment(id);
  if (!existing) return null;
  if (name !== undefined) {
    assertName(name);
    if (name !== existing.name) {
      const clash = stmts.getByName.get(existing.tenant_id, name);
      if (clash && clash.id !== id) {
        throw new DepartmentError('name_exists', `name "${name}" already used in this tenant`);
      }
      stmts.setName.run(name, id);
    }
  }
  if (abbrev !== undefined) {
    assertAbbrev(abbrev);
    if (abbrev !== existing.abbrev) {
      const clash = stmts.getByAbbrev.get(existing.tenant_id, abbrev);
      if (clash && clash.id !== id) {
        throw new DepartmentError('abbrev_exists', `abbrev "${abbrev}" already used in this tenant`);
      }
      stmts.setAbbrev.run(abbrev, id);
    }
  }
  if (status !== undefined) {
    if (status !== 'active' && status !== 'archived') {
      throw new DepartmentError('invalid_status', 'status must be active|archived');
    }
    stmts.setStatus.run(status, id);
  }
  return getDepartment(id);
}

function deleteDepartment(id) {
  const existing = getDepartment(id);
  if (!existing) return null;
  const active = stmts.countActiveEmployees.get(id).n;
  if (active > 0) {
    throw new DepartmentError(
      'department_in_use',
      `cannot delete department with ${active} active employees; reassign or remove them first`
    );
  }
  stmts.delete.run(id);
  return existing;
}

module.exports = {
  DepartmentError,
  createDepartment,
  getDepartment,
  listDepartments,
  updateDepartment,
  deleteDepartment
};
