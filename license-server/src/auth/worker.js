const crypto = require('node:crypto');

// Build worker uses a static shared token from BUILD_WORKER_TOKEN env. It's
// separate from JWT_SECRET / SESSION_JWT_SECRET on purpose — the worker runs
// on your macOS box and never sees user data; its credential is independent
// from anything that touches admins/employees.
//
// We compare via timingSafeEqual to avoid leaking info via response time.

function expectedToken() {
  const token = process.env.BUILD_WORKER_TOKEN;
  if (!token || token.length < 16) {
    return null;
  }
  return token;
}

function safeEqual(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // timingSafeEqual throws on length mismatch; do a dummy compare so the
    // timing of the rejection doesn't depend on length-vs-bytes.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function requireBuildWorker(req, res, next) {
  const expected = expectedToken();
  if (!expected) {
    return res.status(503).json({ success: false, error: 'build_worker_disabled' });
  }
  const auth = req.get('authorization') || '';
  const m = /^Bearer (.+)$/i.exec(auth);
  if (!m) {
    return res.status(401).json({ success: false, error: 'missing_worker_token' });
  }
  if (!safeEqual(m[1], expected)) {
    return res.status(401).json({ success: false, error: 'invalid_worker_token' });
  }
  req.worker = { kind: 'build' };
  next();
}

module.exports = { requireBuildWorker };
