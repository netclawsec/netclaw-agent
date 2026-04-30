const jwt = require('jsonwebtoken');

const ISSUER = 'netclaw-license';
const AUDIENCE = 'netclaw-agent-employee';
const DEFAULT_TTL_SEC = 24 * 60 * 60; // 24 hours

function secret() {
  const s = process.env.EMPLOYEE_JWT_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('EMPLOYEE_JWT_SECRET (or JWT_SECRET) missing or too short (need >= 32 chars)');
  }
  return s;
}

function signEmployeeToken({
  employee_id,
  tenant_id,
  machine_fingerprint,
  ttl_sec = DEFAULT_TTL_SEC
}) {
  const payload = {
    sub: employee_id,
    tenant_id,
    fp: machine_fingerprint
  };
  const token = jwt.sign(payload, secret(), {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: ttl_sec
  });
  const decoded = jwt.decode(token);
  return {
    token,
    expires_at: new Date(decoded.exp * 1000).toISOString()
  };
}

function verifyEmployeeToken(token) {
  return jwt.verify(token, secret(), {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE
  });
}

module.exports = {
  signEmployeeToken,
  verifyEmployeeToken,
  DEFAULT_TTL_SEC
};
