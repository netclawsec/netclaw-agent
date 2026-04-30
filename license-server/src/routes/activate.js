const { z } = require('zod');
const {
  getLicense,
  countActiveSeats,
  upsertSeatForActivation,
  licenseState
} = require('../license');
const tenantsRepo = require('../repos/tenants');
const { sign } = require('../jwt');

const schema = z.object({
  license_key: z.string().min(1),
  fingerprint: z.string().min(8),
  hostname: z.string().optional(),
  platform: z.string().optional(),
  app_version: z.string().optional()
});

module.exports = function activate(req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const body = parsed.data;

  const lic = getLicense(body.license_key);
  if (!lic) {
    return res.status(404).json({ error: 'license_not_found' });
  }
  if (lic.status === 'revoked') {
    return res.status(403).json({ error: 'license_revoked' });
  }
  if (new Date(lic.expires_at) <= new Date()) {
    return res.status(403).json({ error: 'license_expired', expires_at: lic.expires_at });
  }
  if (lic.tenant_id) {
    const tenant = tenantsRepo.getTenant(lic.tenant_id);
    if (!tenant || tenant.status !== 'active') {
      return res.status(403).json({ error: 'tenant_suspended' });
    }
  }

  const { getSeatByFp } = require('../license');
  // Check existing seat for this fingerprint
  const existingByFp = (function lookup() {
    try {
      return require('../license').listSeats(lic.license_key).find(s => s.fingerprint === body.fingerprint);
    } catch { return null; }
  })();

  // If seat exists and active for this fingerprint, reactivate it (idempotent)
  // Otherwise enforce seat cap
  if (!existingByFp || existingByFp.deactivated_at !== null) {
    const activeCount = countActiveSeats(lic.license_key);
    // If this fp will replace a previously-deactivated seat it's fine; only enforce when new fp
    const wouldBeNew = !existingByFp;
    if (wouldBeNew && activeCount >= lic.seats) {
      return res.status(403).json({ error: 'seats_full', active_seats: activeCount, seats: lic.seats });
    }
  }

  const seat = upsertSeatForActivation({
    license_key: lic.license_key,
    fingerprint: body.fingerprint,
    hostname: body.hostname,
    platform: body.platform,
    app_version: body.app_version
  });

  const token = sign(
    { sub: lic.license_key, fp: body.fingerprint, seat_id: seat.id },
    lic.expires_at
  );

  return res.status(200).json({
    token,
    license: licenseState(lic)
  });
};
