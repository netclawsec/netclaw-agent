const crypto = require('node:crypto');
const { db } = require('../db');
const departments = require('./departments');
const employees = require('./employees');

const DEFAULT_TTL_DAYS = 7;
const CODE_LEN = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit confusables 0/O/1/I/L

class InviteCodeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'InviteCodeError';
  }
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO invite_codes (
      code, tenant_id, department_id, raw_username, display_name,
      used_at, used_by_employee_id, expires_at, created_at, created_by
    ) VALUES (
      @code, @tenant_id, @department_id, @raw_username, @display_name,
      NULL, NULL, @expires_at, @created_at, @created_by
    )
  `),
  getByCode: db.prepare('SELECT * FROM invite_codes WHERE code = ?'),
  listByTenant: db.prepare(`
    SELECT ic.*, d.name AS department_name, d.abbrev AS department_abbrev
    FROM invite_codes ic
    JOIN departments d ON d.id = ic.department_id
    WHERE ic.tenant_id = ?
    ORDER BY ic.created_at DESC
  `),
  markUsed: db.prepare(`
    UPDATE invite_codes
       SET used_at = ?, used_by_employee_id = ?
     WHERE code = ? AND used_at IS NULL
  `),
  // Revoke = mark used_at but leave used_by_employee_id NULL.
  // (Convention: used_at IS NOT NULL AND used_by_employee_id IS NULL → revoked.)
  revoke: db.prepare(`
    UPDATE invite_codes
       SET used_at = ?
     WHERE code = ? AND used_at IS NULL
  `),
  delete: db.prepare('DELETE FROM invite_codes WHERE code = ?')
};

function nowIso() {
  return new Date().toISOString();
}

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function createInviteCode({
  tenant_id,
  department_id,
  raw_username,
  display_name = null,
  created_by = null,
  ttl_days = DEFAULT_TTL_DAYS
}) {
  if (!tenant_id) throw new InviteCodeError('invalid_tenant', 'tenant_id required');
  const dept = departments.getDepartment(department_id);
  if (!dept || dept.tenant_id !== tenant_id) {
    throw new InviteCodeError('department_not_found', 'department does not belong to this tenant');
  }
  if (dept.status !== 'active') {
    throw new InviteCodeError('department_archived', 'department is archived');
  }
  if (!/^[a-z0-9._-]{2,32}$/.test(raw_username || '')) {
    throw new InviteCodeError(
      'invalid_username',
      'raw_username must be 2-32 chars; lowercase letters/digits/._-'
    );
  }
  if (display_name != null && (typeof display_name !== 'string' || display_name.length > 100)) {
    throw new InviteCodeError('invalid_display_name', 'display_name must be ≤ 100 chars');
  }
  // Pre-flight: would the resulting username collide with an existing employee?
  const username = `${dept.abbrev}-${raw_username}`;
  if (employees.getEmployeeByUsername(tenant_id, username)) {
    throw new InviteCodeError('username_exists', `username "${username}" already taken in this tenant`);
  }
  if (!Number.isInteger(ttl_days) || ttl_days < 1 || ttl_days > 30) {
    throw new InviteCodeError('invalid_ttl', 'ttl_days must be 1..30');
  }
  // Try a few times in case of unlikely PRIMARY KEY collision.
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const now = nowIso();
    const expires_at = new Date(Date.now() + ttl_days * 86_400_000).toISOString();
    const row = {
      code,
      tenant_id,
      department_id,
      raw_username,
      display_name,
      expires_at,
      created_at: now,
      created_by
    };
    try {
      stmts.insert.run(row);
      return row;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new InviteCodeError('code_generation_failed', 'unable to allocate invite code');
}

function getByCode(code) {
  return stmts.getByCode.get(code) || null;
}

function listByTenant(tenant_id) {
  return stmts.listByTenant.all(tenant_id);
}

function consumeInviteCode(code, tenant_id, employee_id) {
  const row = stmts.getByCode.get(code);
  if (!row) throw new InviteCodeError('invite_not_found', 'invite code not recognized');
  if (row.tenant_id !== tenant_id) {
    throw new InviteCodeError('invite_wrong_tenant', 'invite code does not belong to this tenant');
  }
  if (row.used_at) throw new InviteCodeError('invite_already_used', 'invite code already used');
  if (Date.parse(row.expires_at) < Date.now()) {
    throw new InviteCodeError('invite_expired', 'invite code has expired');
  }
  const result = stmts.markUsed.run(nowIso(), employee_id, code);
  if (result.changes !== 1) {
    // Race: someone consumed between get and mark.
    throw new InviteCodeError('invite_already_used', 'invite code already used');
  }
  return { ...row, used_at: nowIso(), used_by_employee_id: employee_id };
}

function revokeInviteCode(code, tenant_id) {
  const row = stmts.getByCode.get(code);
  if (!row) return null;
  if (row.tenant_id !== tenant_id) {
    throw new InviteCodeError('invite_wrong_tenant', 'invite code does not belong to this tenant');
  }
  if (row.used_at) throw new InviteCodeError('invite_already_used', 'invite code already used or revoked');
  stmts.revoke.run(nowIso(), code);
  return getByCode(code);
}

module.exports = {
  InviteCodeError,
  createInviteCode,
  getByCode,
  listByTenant,
  consumeInviteCode,
  revokeInviteCode,
  DEFAULT_TTL_DAYS
};
