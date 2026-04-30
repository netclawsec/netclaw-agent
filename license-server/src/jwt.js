const jwt = require('jsonwebtoken');

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET missing or too short (need >= 32 chars)');
  }
  return s;
}

function sign(payload, expiresAtIso) {
  const expSec = Math.floor(new Date(expiresAtIso).getTime() / 1000);
  return jwt.sign(payload, secret(), {
    algorithm: 'HS256',
    expiresIn: Math.max(60, expSec - Math.floor(Date.now() / 1000))
  });
}

function verify(token) {
  return jwt.verify(token, secret(), { algorithms: ['HS256'] });
}

module.exports = { sign, verify };
