const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function originHost(value) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function requestHostFromHeaders(req) {
  const xfh = req.headers['x-forwarded-host'];
  if (xfh) return String(xfh).split(',')[0].trim();
  return req.headers.host || null;
}

function csrfOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const allowed = parseAllowedOrigins();
  const origin = req.headers.origin || req.headers.referer || null;
  const reqHost = requestHostFromHeaders(req);
  const incomingHost = originHost(origin);

  if (!incomingHost) {
    return res.status(403).json({ success: false, error: 'csrf_origin_missing' });
  }

  if (allowed.length > 0) {
    const allowedHosts = allowed.map(originHost).filter(Boolean);
    if (allowedHosts.includes(incomingHost)) return next();
  }

  if (reqHost && incomingHost === reqHost) return next();

  return res.status(403).json({
    success: false,
    error: 'csrf_origin_mismatch',
    expected: reqHost,
    got: incomingHost
  });
}

module.exports = { csrfOriginGuard };
