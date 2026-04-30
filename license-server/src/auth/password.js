const crypto = require('node:crypto');
const util = require('node:util');

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_BYTES = 16;

const pbkdf2Async = util.promisify(crypto.pbkdf2);

class PasswordError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PasswordError';
  }
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new PasswordError('invalid_password', 'password must be 8-200 chars');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  const actual = await pbkdf2Async(password, salt, iterations, expected.length, PBKDF2_DIGEST);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function assertEmployeePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new PasswordError('invalid_password', 'password must be 8-200 chars');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new PasswordError('weak_password', 'password must contain at least one letter and one digit');
  }
}

module.exports = {
  PasswordError,
  hashPassword,
  verifyPassword,
  assertEmployeePasswordStrength
};
