const { z } = require('zod');
const tenantsRepo = require('../repos/tenants');
const adminsRepo = require('../repos/admins');
const license = require('../license');

function tenantOf(req) {
  return req.session.admin.tenant_id;
}

function handleLicenseError(res, err) {
  if (err && err.name === 'LicenseError') {
    return res.status(400).json({ success: false, error: err.code, message: err.message });
  }
  throw err;
}

function dashboard(req, res) {
  const tenant_id = tenantOf(req);
  const tenant = tenantsRepo.getTenant(tenant_id);
  if (!tenant) return res.status(404).json({ success: false, error: 'tenant_not_found' });
  const licenses = license.listLicensesByTenant(tenant_id);
  const seats_used = licenses
    .filter((l) => l.status === 'active')
    .reduce((sum, l) => sum + l.seats, 0);
  const active_seats = licenses.reduce((sum, l) => sum + (l.active_seats || 0), 0);
  return res.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      seat_quota: tenant.seat_quota,
      status: tenant.status,
      seats_used,
      seats_remaining: Math.max(0, tenant.seat_quota - seats_used),
      active_seats,
      license_count: licenses.length
    }
  });
}

function listLicenses(req, res) {
  return res.json({ success: true, licenses: license.listLicensesByTenant(tenantOf(req)) });
}

const createSchema = z.object({
  customer_name: z.string().min(1).max(100),
  months: z.number().int().min(1).max(36),
  seats: z.number().int().min(1).max(100).default(1),
  plan: z.string().max(32).optional(),
  notes: z.string().max(500).optional()
});

function createLicense(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const lic = license.createLicense({
      tenant_id: tenantOf(req),
      customer_name: parsed.data.customer_name,
      months: parsed.data.months,
      seats: parsed.data.seats,
      plan: parsed.data.plan,
      notes: parsed.data.notes
    });
    return res.status(201).json({ success: true, license: lic });
  } catch (err) {
    return handleLicenseError(res, err);
  }
}

function ensureOwned(req, res) {
  const lic = license.getLicense(req.params.license_key);
  if (!lic || lic.tenant_id !== tenantOf(req)) {
    res.status(404).json({ success: false, error: 'license_not_found' });
    return null;
  }
  return lic;
}

function getLicenseDetail(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const seats = license.listSeats(lic.license_key);
  return res.json({ success: true, license: lic, seats });
}

const renewSchema = z.object({ months: z.number().int().min(1).max(36) });

function renewLicense(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const parsed = renewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  const updated = license.renewLicense(lic.license_key, parsed.data.months);
  return res.json({ success: true, license: updated });
}

function revokeLicense(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const updated = license.revokeLicense(lic.license_key);
  return res.json({ success: true, license: updated });
}

const updateSeatsSchema = z.object({ seats: z.number().int().min(1).max(100) });

function updateLicenseSeats(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const parsed = updateSeatsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  try {
    const updated = license.updateSeatsLimitWithQuota(lic.license_key, parsed.data.seats);
    return res.json({ success: true, license: updated });
  } catch (err) {
    return handleLicenseError(res, err);
  }
}

const unbindSchema = z.object({ fingerprint: z.string().min(8).optional() });

function unbindSeat(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const parsed = unbindSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  const result = license.unbindSeats(lic.license_key, parsed.data.fingerprint);
  return res.json({ success: true, changed: result?.changed ?? 0 });
}

function listSeats(req, res) {
  const tenant_id = tenantOf(req);
  const all = [];
  for (const lic of license.listLicensesByTenant(tenant_id)) {
    for (const seat of license.listSeats(lic.license_key)) {
      all.push({
        license_key: lic.license_key,
        customer_name: lic.customer_name,
        ...seat
      });
    }
  }
  return res.json({ success: true, seats: all });
}

module.exports = {
  dashboard,
  listLicenses,
  createLicense,
  getLicenseDetail,
  renewLicense,
  revokeLicense,
  updateLicenseSeats,
  unbindSeat,
  listSeats
};
