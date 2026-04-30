const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'nclw_admin';
const SESSION_TTL_SEC = 12 * 60 * 60;

function sessionSecret() {
  const s = process.env.SESSION_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_JWT_SECRET missing or too short (need >= 32 chars)');
  }
  return s;
}

function signSession({ admin_id, role, tenant_id, username }) {
  const payload = { sub: admin_id, role, tenant_id: tenant_id || null, username };
  return jwt.sign(payload, sessionSecret(), {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_SEC
  });
}

function verifySession(token) {
  try {
    return jwt.verify(token, sessionSecret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

function readCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const found = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!found) return null;
  return decodeURIComponent(found.slice(COOKIE_NAME.length + 1));
}

function setSessionCookie(res, token, { secure }) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res, { secure }) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SEC,
  signSession,
  verifySession,
  readCookie,
  setSessionCookie,
  clearSessionCookie
};
