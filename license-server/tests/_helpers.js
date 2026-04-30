const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshDbEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nclw-test-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.SESSION_JWT_SECRET = 'b'.repeat(64);
  process.env.ADMIN_SECRET = 'c'.repeat(64);
  process.env.LOG_LEVEL = 'silent';
  return dir;
}

const SRC_DIR = path.resolve(__dirname, '..', 'src') + path.sep;

function purgeRequireCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) {
      delete require.cache[key];
    }
  }
}

module.exports = { freshDbEnv, purgeRequireCache };
