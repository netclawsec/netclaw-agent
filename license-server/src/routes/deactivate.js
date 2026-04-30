const { z } = require('zod');
const { verify: jwtVerify } = require('../jwt');
const { getSeat, deactivateSeatById } = require('../license');

const schema = z.object({
  token: z.string().min(10),
  fingerprint: z.string().min(8)
});

module.exports = function deactivate(req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const { token, fingerprint } = parsed.data;

  let payload;
  try {
    payload = jwtVerify(token);
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }

  if (payload.fp !== fingerprint) {
    return res.status(403).json({ error: 'fingerprint_mismatch' });
  }

  const seat = getSeat(payload.seat_id);
  if (!seat) {
    return res.status(404).json({ error: 'seat_not_found' });
  }
  if (seat.deactivated_at === null) {
    deactivateSeatById(seat.id);
  }
  return res.json({ success: true });
};
