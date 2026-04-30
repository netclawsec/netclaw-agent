const crypto = require('node:crypto');
const util = require('node:util');
const { db } = require('../db');

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_BYTES = 16;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

const pbkdf2Async = util.promisify(crypto.pbkdf2);

class AdminError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'AdminError';
  }
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new AdminError('invalid_password', 'password must be 8-200 chars');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  const actual = await pbkdf2Async(password, salt, iterations, expected.length, PBKDF2_DIGEST);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO tenant_admins
      (id, tenant_id, username, password_hash, role, status, display_name, created_at)
    VALUES
      (@id, @tenant_id, @username, @password_hash, @role, @status, @display_name, @created_at)
  `),
  getById:        db.prepare('SELECT * FROM tenant_admins WHERE id = ?'),
  getByUsername:  db.prepare('SELECT * FROM tenant_admins WHERE username = ?'),
  listAll:        db.prepare('SELECT * FROM tenant_admins ORDER BY created_at DESC'),
  listByTenant:   db.prepare('SELECT * FROM tenant_admins WHERE tenant_id = ? ORDER BY created_at DESC'),
  setPassword:    db.prepare('UPDATE tenant_admins SET password_hash = ? WHERE id = ?'),
  setStatus:      db.prepare('UPDATE tenant_admins SET status = ? WHERE id = ?'),
  setDisplay:     db.prepare('UPDATE tenant_admins SET display_name = ? WHERE id = ?'),
  touchLogin:     db.prepare('UPDATE tenant_admins SET last_login_at = ? WHERE id = ?'),
  delete:         db.prepare('DELETE FROM tenant_admins WHERE id = ?')
};

function nowIso() {
  return new Date().toISOString();
}

function publicView(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

async function createAdmin({ tenant_id, username, password, role, display_name = null }) {
  if (!USERNAME_RE.test(username || '')) {
    throw new AdminError(
      'invalid_username',
      'username must be 3-32 chars [a-zA-Z0-9_.-]'
    );
  }
  if (role !== 'super' && role !== 'tenant_admin') {
    throw new AdminError('invalid_role', 'role must be super|tenant_admin');
  }
  if (role === 'super' && tenant_id) {
    throw new AdminError('super_no_tenant', 'super admin cannot have tenant_id');
  }
  if (role === 'tenant_admin' && !tenant_id) {
    throw new AdminError('tenant_admin_needs_tenant', 'tenant_admin requires tenant_id');
  }
  if (stmts.getByUsername.get(username)) {
    throw new AdminError('username_exists', `username "${username}" already exists`);
  }
  const password_hash = await hashPassword(password);
  const row = {
    id: crypto.randomUUID(),
    tenant_id: tenant_id || null,
    username,
    password_hash,
    role,
    status: 'active',
    display_name,
    created_at: nowIso()
  };
  stmts.insert.run(row);
  return publicView(stmts.getById.get(row.id));
}

function getAdminById(id) {
  return publicView(stmts.getById.get(id));
}

function getAdminByUsernameRaw(username) {
  return stmts.getByUsername.get(username) || null;
}

function listAdmins() {
  return stmts.listAll.all().map(publicView);
}

function listAdminsByTenant(tenant_id) {
  return stmts.listByTenant.all(tenant_id).map(publicView);
}

async function changePassword(id, newPassword) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  const hashed = await hashPassword(newPassword);
  stmts.setPassword.run(hashed, id);
  return publicView(existing);
}

function setStatus(id, status) {
  if (status !== 'active' && status !== 'disabled') {
    throw new AdminError('invalid_status', 'status must be active|disabled');
  }
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  stmts.setStatus.run(status, id);
  return publicView({ ...existing, status });
}

function setDisplayName(id, display_name) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  stmts.setDisplay.run(display_name, id);
  return publicView({ ...existing, display_name });
}

function recordLogin(id) {
  stmts.touchLogin.run(nowIso(), id);
}

function deleteAdmin(id) {
  const existing = stmts.getById.get(id);
  if (!existing) return null;
  stmts.delete.run(id);
  return publicView(existing);
}

async function authenticate(username, password) {
  const row = getAdminByUsernameRaw(username);
  if (!row) return null;
  if (row.status !== 'active') return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  recordLogin(row.id);
  return publicView(row);
}

module.exports = {
  AdminError,
  hashPassword,
  verifyPassword,
  createAdmin,
  getAdminById,
  listAdmins,
  listAdminsByTenant,
  changePassword,
  setStatus,
  setDisplayName,
  deleteAdmin,
  authenticate,
  recordLogin
};
