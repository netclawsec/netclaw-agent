const crypto = require('node:crypto');
const { db } = require('../db');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

class TenantError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'TenantError';
  }
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO tenants (id, name, slug, seat_quota, status, created_at, notes)
    VALUES (@id, @name, @slug, @seat_quota, @status, @created_at, @notes)
  `),
  getById:   db.prepare('SELECT * FROM tenants WHERE id = ?'),
  getBySlug: db.prepare('SELECT * FROM tenants WHERE slug = ?'),
  list:      db.prepare('SELECT * FROM tenants ORDER BY created_at DESC'),
  setStatus: db.prepare('UPDATE tenants SET status = ? WHERE id = ?'),
  setQuota:  db.prepare('UPDATE tenants SET seat_quota = ? WHERE id = ?'),
  setNotes:  db.prepare('UPDATE tenants SET notes = ? WHERE id = ?'),
  rename:    db.prepare('UPDATE tenants SET name = ? WHERE id = ?'),
  delete:    db.prepare('DELETE FROM tenants WHERE id = ?'),
  sumLicenseSeats: db.prepare(`
    SELECT COALESCE(SUM(seats), 0) AS total
    FROM licenses
    WHERE tenant_id = ? AND status = 'active'
  `),
  countLicenses: db.prepare(`
    SELECT COUNT(*) AS n FROM licenses WHERE tenant_id = ?
  `)
};

function nowIso() {
  return new Date().toISOString();
}

function createTenant({ name, slug, seat_quota = 0, notes = null }) {
  if (!name || typeof name !== 'string' || name.length === 0 || name.length > 100) {
    throw new TenantError('invalid_name', 'name must be 1-100 chars');
  }
  if (!SLUG_RE.test(slug)) {
    throw new TenantError(
      'invalid_slug',
      'slug must be 3-32 chars, lowercase letters/digits/hyphens, start+end alphanumeric'
    );
  }
  if (!Number.isInteger(seat_quota) || seat_quota < 0 || seat_quota > 1_000_000) {
    throw new TenantError('invalid_quota', 'seat_quota must be 0..1,000,000');
  }
  if (stmts.getBySlug.get(slug)) {
    throw new TenantError('slug_exists', `tenant slug "${slug}" already exists`);
  }
  const tenant = {
    id: crypto.randomUUID(),
    name,
    slug,
    seat_quota,
    status: 'active',
    created_at: nowIso(),
    notes
  };
  stmts.insert.run(tenant);
  return tenant;
}

function getTenant(id) {
  return stmts.getById.get(id) || null;
}

function getTenantBySlug(slug) {
  return stmts.getBySlug.get(slug) || null;
}

function listTenants() {
  return stmts.list.all().map((t) => ({
    ...t,
    seats_used: stmts.sumLicenseSeats.get(t.id).total,
    license_count: stmts.countLicenses.get(t.id).n
  }));
}

function updateQuota(id, seat_quota) {
  if (!Number.isInteger(seat_quota) || seat_quota < 0 || seat_quota > 1_000_000) {
    throw new TenantError('invalid_quota', 'seat_quota must be 0..1,000,000');
  }
  const existing = getTenant(id);
  if (!existing) return null;
  stmts.setQuota.run(seat_quota, id);
  return { ...existing, seat_quota };
}

function setStatus(id, status) {
  if (status !== 'active' && status !== 'suspended') {
    throw new TenantError('invalid_status', 'status must be active|suspended');
  }
  const existing = getTenant(id);
  if (!existing) return null;
  stmts.setStatus.run(status, id);
  return { ...existing, status };
}

function renameTenant(id, name) {
  if (!name || typeof name !== 'string' || name.length === 0 || name.length > 100) {
    throw new TenantError('invalid_name', 'name must be 1-100 chars');
  }
  const existing = getTenant(id);
  if (!existing) return null;
  stmts.rename.run(name, id);
  return { ...existing, name };
}

function setNotes(id, notes) {
  const existing = getTenant(id);
  if (!existing) return null;
  stmts.setNotes.run(notes, id);
  return { ...existing, notes };
}

function deleteTenant(id) {
  const existing = getTenant(id);
  if (!existing) return null;
  if (id === 'default') {
    throw new TenantError('cannot_delete_default', 'default tenant cannot be deleted');
  }
  const licenseCount = stmts.countLicenses.get(id).n;
  if (licenseCount > 0) {
    throw new TenantError(
      'tenant_has_licenses',
      `cannot delete tenant with ${licenseCount} licenses; revoke or transfer first`
    );
  }
  stmts.delete.run(id);
  return existing;
}

function quotaRemaining(tenant_id) {
  const tenant = getTenant(tenant_id);
  if (!tenant) return 0;
  const used = stmts.sumLicenseSeats.get(tenant_id).total;
  return Math.max(0, tenant.seat_quota - used);
}

module.exports = {
  TenantError,
  createTenant,
  getTenant,
  getTenantBySlug,
  listTenants,
  updateQuota,
  setStatus,
  renameTenant,
  setNotes,
  deleteTenant,
  quotaRemaining
};
