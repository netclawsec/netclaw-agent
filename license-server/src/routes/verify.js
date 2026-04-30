const { z } = require('zod');
const { verify: jwtVerify } = require('../jwt');
const { getLicense, getSeat, touchSeat, licenseState } = require('../license');
const tenantsRepo = require('../repos/tenants');

const schema = z.object({
  token: z.string().min(10),
  fingerprint: z.string().min(8)
});

module.exports = function verify(req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ valid: false, error: 'invalid_body' });
  }
  const { token, fingerprint } = parsed.data;

  let payload;
  try {
    payload = jwtVerify(token);
  } catch (err) {
    return res.status(401).json({ valid: false, error: 'invalid_token' });
  }

  if (payload.fp !== fingerprint) {
    return res.status(403).json({ valid: false, error: 'fingerprint_mismatch' });
  }

  const seat = getSeat(payload.seat_id);
  if (!seat || seat.deactivated_at !== null) {
    return res.status(403).json({ valid: false, error: 'activation_deactivated' });
  }

  const lic = getLicense(payload.sub);
  if (!lic) {
    return res.status(404).json({ valid: false, error: 'license_not_found' });
  }
  if (lic.status === 'revoked') {
    return res.status(403).json({ valid: false, error: 'license_revoked' });
  }
  if (new Date(lic.expires_at) <= new Date()) {
    return res.status(403).json({ valid: false, error: 'license_expired', expires_at: lic.expires_at });
  }
  if (lic.tenant_id) {
    const tenant = tenantsRepo.getTenant(lic.tenant_id);
    if (!tenant || tenant.status !== 'active') {
      return res.status(403).json({ valid: false, error: 'tenant_suspended' });
    }
  }

  touchSeat(seat.id);
  return res.json({ valid: true, license: licenseState(lic) });
};
