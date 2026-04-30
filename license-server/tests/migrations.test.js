const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

test('migrations create tenants/tenant_admins tables and add tenant_id to licenses', () => {
  freshDbEnv();
  purgeRequireCache();
  const { db } = require('../src/db');

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes('tenants'), 'tenants table missing');
  assert.ok(tables.includes('tenant_admins'), 'tenant_admins table missing');
  assert.ok(tables.includes('schema_version'), 'schema_version missing');

  const cols = db.prepare('PRAGMA table_info(licenses)').all().map((c) => c.name);
  assert.ok(cols.includes('tenant_id'), 'tenant_id column missing on licenses');

  const def = db.prepare("SELECT * FROM tenants WHERE id = 'default'").get();
  assert.ok(def, 'default tenant should exist');
  assert.equal(def.slug, 'default');
});

test('migrations are idempotent (running twice does not duplicate default tenant)', () => {
  freshDbEnv();
  purgeRequireCache();
  const { db } = require('../src/db');
  const { runMigrations } = require('../src/migrations');

  runMigrations(db);
  runMigrations(db);

  const count = db.prepare("SELECT COUNT(*) AS n FROM tenants WHERE id='default'").get().n;
  assert.equal(count, 1);

  const versions = db.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n;
  assert.equal(versions, 1, 'schema_version should have exactly one row for v1');
});

test('pre-existing licenses are backfilled to default tenant', () => {
  freshDbEnv();
  purgeRequireCache();
  const { db } = require('../src/db');

  db.prepare(`
    INSERT INTO licenses (license_key, customer_name, plan, seats, created_at, expires_at, status)
    VALUES (?, ?, 'pro', 1, datetime('now'), datetime('now', '+1 month'), 'active')
  `).run('NCLW-TEST1-TEST2-TEST3-TEST4', 'old-customer');
  db.prepare(`UPDATE licenses SET tenant_id = NULL WHERE license_key = ?`).run(
    'NCLW-TEST1-TEST2-TEST3-TEST4'
  );

  const { runMigrations } = require('../src/migrations');
  db.prepare('DELETE FROM schema_version').run();
  runMigrations(db);

  const lic = db
    .prepare('SELECT tenant_id FROM licenses WHERE license_key = ?')
    .get('NCLW-TEST1-TEST2-TEST3-TEST4');
  assert.equal(lic.tenant_id, 'default');
});
