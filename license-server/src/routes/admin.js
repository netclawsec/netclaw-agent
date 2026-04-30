const { z } = require('zod');
const {
  getLicense,
  listLicenses,
  listSeats,
  createLicense,
  renewLicense,
  revokeLicense,
  updateSeatsLimit,
  unbindSeats
} = require('../license');

const schemas = {
  create: z.object({
    action: z.literal('create'),
    customer_name: z.string().min(1),
    months: z.number().int().min(1).max(36),
    plan: z.string().optional(),
    seats: z.number().int().min(1).max(100).optional(),
    notes: z.string().optional(),
    tenant_id: z.string().optional()
  }),
  renew: z.object({
    action: z.literal('renew'),
    license_key: z.string().min(1),
    months: z.number().int().min(1).max(36)
  }),
  revoke: z.object({ action: z.literal('revoke'), license_key: z.string().min(1) }),
  unbind: z.object({
    action: z.literal('unbind'),
    license_key: z.string().min(1),
    fingerprint: z.string().optional()
  }),
  set_seats: z.object({
    action: z.literal('set_seats'),
    license_key: z.string().min(1),
    seats: z.number().int().min(1).max(100)
  }),
  list: z.object({ action: z.literal('list') }),
  get: z.object({ action: z.literal('get'), license_key: z.string().min(1) })
};

module.exports = function admin(req, res) {
  const action = req.body && req.body.action;
  if (!action || !schemas[action]) {
    return res.status(400).json({ success: false, error: 'unknown_action' });
  }
  const parsed = schemas[action].safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'invalid_params',
      details: parsed.error.issues
    });
  }
  const data = parsed.data;

  if (action === 'create') {
    try {
      const lic = createLicense(data);
      return res.status(201).json({ success: true, license: lic });
    } catch (err) {
      if (err && err.name === 'LicenseError') {
        return res.status(400).json({ success: false, error: err.code, message: err.message });
      }
      throw err;
    }
  }
  if (action === 'renew') {
    const lic = renewLicense(data.license_key, data.months);
    if (!lic) return res.status(404).json({ success: false, error: 'license_not_found' });
    return res.json({ success: true, license: lic });
  }
  if (action === 'revoke') {
    const lic = revokeLicense(data.license_key);
    if (!lic) return res.status(404).json({ success: false, error: 'license_not_found' });
    return res.json({ success: true });
  }
  if (action === 'unbind') {
    const lic = getLicense(data.license_key);
    if (!lic) return res.status(404).json({ success: false, error: 'license_not_found' });
    const result = unbindSeats(data.license_key, data.fingerprint);
    return res.json({ success: true, changed: result.changed });
  }
  if (action === 'set_seats') {
    const lic = updateSeatsLimit(data.license_key, data.seats);
    if (!lic) return res.status(404).json({ success: false, error: 'license_not_found' });
    return res.json({ success: true, license: lic });
  }
  if (action === 'list') {
    return res.json({ success: true, licenses: listLicenses() });
  }
  if (action === 'get') {
    const lic = getLicense(data.license_key);
    if (!lic) return res.status(404).json({ success: false, error: 'license_not_found' });
    return res.json({ success: true, license: lic, seats: listSeats(data.license_key) });
  }
};
