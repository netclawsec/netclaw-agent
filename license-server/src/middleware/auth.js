module.exports = function adminAuth(req, res, next) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || adminSecret === 'change_me_long_random_hex') {
    return res.status(500).json({ success: false, error: 'server_misconfigured' });
  }
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ success: false, error: 'missing_bearer' });
  }
  if (header !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ success: false, error: 'invalid_bearer' });
  }
  next();
};
