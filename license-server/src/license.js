const crypto = require('node:crypto');
const { db } = require('./db');

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateKey() {
  const segments = [];
  for (let s = 0; s < 4; s++) {
    const bytes = crypto.randomBytes(5);
    let seg = '';
    for (let j = 0; j < 5; j++) seg += CHARSET[bytes[j] % CHARSET.length];
    segments.push(seg);
  }
  return `NCLW-${segments.join('-')}`;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

const stmts = {
  getLicense:  db.prepare('SELECT * FROM licenses WHERE license_key = ?'),
  listLicenses: db.prepare('SELECT * FROM licenses ORDER BY created_at DESC'),
  listLicensesByTenant: db.prepare('SELECT * FROM licenses WHERE tenant_id = ? ORDER BY created_at DESC'),
  insertLicense: db.prepare(`
    INSERT INTO licenses (license_key, customer_name, plan, seats, created_at, expires_at, status, tenant_id)
    VALUES (@license_key, @customer_name, @plan, @seats, @created_at, @expires_at, @status, @tenant_id)
  `),
  setExpires: db.prepare('UPDATE licenses SET expires_at = ?, status = ? WHERE license_key = ?'),
  setStatus:  db.prepare('UPDATE licenses SET status = ? WHERE license_key = ?'),
  setSeatsCol: db.prepare('UPDATE licenses SET seats = ? WHERE license_key = ?'),
  sumActiveSeatsForTenant: db.prepare(`
    SELECT COALESCE(SUM(seats), 0) AS total FROM licenses WHERE tenant_id = ? AND status = 'active'
  `),
  getTenantQuota: db.prepare(`SELECT seat_quota, status FROM tenants WHERE id = ?`),

  getSeatByFp: db.prepare(`
    SELECT * FROM seats WHERE license_key = ? AND fingerprint = ?
  `),
  getSeatById: db.prepare('SELECT * FROM seats WHERE id = ?'),
  listSeatsForLicense: db.prepare(`
    SELECT * FROM seats WHERE license_key = ? ORDER BY activated_at DESC
  `),
  countActiveSeats: db.prepare(`
    SELECT COUNT(*) AS n FROM seats
    WHERE license_key = ? AND deactivated_at IS NULL
  `),
  insertSeat: db.prepare(`
    INSERT INTO seats (license_key, fingerprint, hostname, platform, app_version, activated_at, last_verified_at)
    VALUES (@license_key, @fingerprint, @hostname, @platform, @app_version, @activated_at, @last_verified_at)
  `),
  reactivateSeat: db.prepare(`
    UPDATE seats
       SET hostname = @hostname,
           platform = @platform,
           app_version = @app_version,
           activated_at = @activated_at,
           last_verified_at = @last_verified_at,
           deactivated_at = NULL
     WHERE id = @id
  `),
  touchSeat: db.prepare('UPDATE seats SET last_verified_at = ? WHERE id = ?'),
  deactivateSeat: db.prepare('UPDATE seats SET deactivated_at = ? WHERE id = ?'),
  deactivateAllSeats: db.prepare(`
    UPDATE seats SET deactivated_at = ? WHERE license_key = ? AND deactivated_at IS NULL
  `)
};

function getLicense(key) {
  return stmts.getLicense.get(key) || null;
}

function listLicenses() {
  return stmts.listLicenses.all().map(lic => ({
    ...lic,
    active_seats: stmts.countActiveSeats.get(lic.license_key).n
  }));
}

function listSeats(license_key) {
  return stmts.listSeatsForLicense.all(license_key);
}

class LicenseError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.name = 'LicenseError';
    Object.assign(this, extra);
  }
}

function createLicense({ tenant_id = 'default', customer_name, months, plan, seats, notes }) {
  const seatsNum = Number(seats || 1);
  const tx = db.transaction(() => {
    const tenant = stmts.getTenantQuota.get(tenant_id);
    if (!tenant) {
      throw new LicenseError('tenant_not_found', `tenant "${tenant_id}" does not exist`);
    }
    if (tenant.status !== 'active') {
      throw new LicenseError('tenant_suspended', `tenant "${tenant_id}" is suspended`);
    }
    const used = stmts.sumActiveSeatsForTenant.get(tenant_id).total;
    if (used + seatsNum > tenant.seat_quota) {
      throw new LicenseError(
        'quota_exceeded',
        `tenant quota exceeded: requested ${seatsNum}, ${used}/${tenant.seat_quota} already in use`,
        { used, requested: seatsNum, quota: tenant.seat_quota }
      );
    }
    const now = nowIso();
    const lic = {
      license_key: generateKey(),
      customer_name,
      plan: plan || 'pro',
      seats: seatsNum,
      created_at: now,
      expires_at: addMonths(now, Number(months)),
      status: 'active',
      tenant_id
    };
    stmts.insertLicense.run(lic);
    return { ...lic, notes: notes || null };
  });
  return tx();
}

function updateSeatsLimitWithQuota(key, seats) {
  const seatsNum = Number(seats);
  const tx = db.transaction(() => {
    const existing = getLicense(key);
    if (!existing) return null;
    const tenant = stmts.getTenantQuota.get(existing.tenant_id || 'default');
    if (tenant && existing.status === 'active') {
      const others = stmts.sumActiveSeatsForTenant.get(existing.tenant_id || 'default').total - existing.seats;
      if (others + seatsNum > tenant.seat_quota) {
        throw new LicenseError(
          'quota_exceeded',
          `tenant quota exceeded: requested ${seatsNum}, ${others}/${tenant.seat_quota} already used by other licenses`,
          { used: others, requested: seatsNum, quota: tenant.seat_quota }
        );
      }
    }
    stmts.setSeatsCol.run(seatsNum, key);
    return { ...existing, seats: seatsNum };
  });
  return tx();
}

function listLicensesByTenant(tenant_id) {
  return stmts.listLicensesByTenant.all(tenant_id).map((lic) => ({
    ...lic,
    active_seats: stmts.countActiveSeats.get(lic.license_key).n
  }));
}

function renewLicense(key, months) {
  const existing = getLicense(key);
  if (!existing) return null;
  const base = new Date(existing.expires_at) > new Date()
    ? existing.expires_at
    : nowIso();
  const newExpires = addMonths(base, Number(months));
  stmts.setExpires.run(newExpires, 'active', key);
  return { ...existing, expires_at: newExpires, status: 'active' };
}

function revokeLicense(key) {
  const existing = getLicense(key);
  if (!existing) return null;
  stmts.setStatus.run('revoked', key);
  return { ...existing, status: 'revoked' };
}

function updateSeatsLimit(key, seats) {
  const existing = getLicense(key);
  if (!existing) return null;
  stmts.setSeatsCol.run(Number(seats), key);
  return { ...existing, seats: Number(seats) };
}

function unbindSeats(key, fingerprint) {
  const existing = getLicense(key);
  if (!existing) return null;
  const when = nowIso();
  if (fingerprint) {
    const seat = stmts.getSeatByFp.get(key, fingerprint);
    if (!seat || seat.deactivated_at) return { changed: 0 };
    stmts.deactivateSeat.run(when, seat.id);
    return { changed: 1 };
  }
  const res = stmts.deactivateAllSeats.run(when, key);
  return { changed: res.changes };
}

function upsertSeatForActivation({ license_key, fingerprint, hostname, platform, app_version }) {
  const now = nowIso();
  const existing = stmts.getSeatByFp.get(license_key, fingerprint);
  if (existing) {
    stmts.reactivateSeat.run({
      id: existing.id,
      hostname: hostname || null,
      platform: platform || null,
      app_version: app_version || null,
      activated_at: existing.deactivated_at ? now : existing.activated_at,
      last_verified_at: now
    });
    return stmts.getSeatById.get(existing.id);
  }
  const info = stmts.insertSeat.run({
    license_key,
    fingerprint,
    hostname: hostname || null,
    platform: platform || null,
    app_version: app_version || null,
    activated_at: now,
    last_verified_at: now
  });
  return stmts.getSeatById.get(info.lastInsertRowid);
}

function countActiveSeats(license_key) {
  return stmts.countActiveSeats.get(license_key).n;
}

function touchSeat(seat_id) {
  stmts.touchSeat.run(nowIso(), seat_id);
}

function deactivateSeatById(seat_id) {
  stmts.deactivateSeat.run(nowIso(), seat_id);
}

function getSeat(seat_id) {
  return stmts.getSeatById.get(seat_id) || null;
}

function licenseState(lic) {
  return { plan: lic.plan, seats: lic.seats, expires_at: lic.expires_at };
}

module.exports = {
  generateKey,
  getLicense,
  listLicenses,
  listLicensesByTenant,
  listSeats,
  createLicense,
  renewLicense,
  revokeLicense,
  updateSeatsLimit,
  updateSeatsLimitWithQuota,
  unbindSeats,
  upsertSeatForActivation,
  countActiveSeats,
  touchSeat,
  deactivateSeatById,
  getSeat,
  licenseState,
  LicenseError
};
