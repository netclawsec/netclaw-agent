const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

function setup() {
  freshDbEnv();
  purgeRequireCache();
  return require('../src/repos/tenants');
}

test('createTenant: happy path', () => {
  const repo = setup();
  const t = repo.createTenant({
    name: '北京东方童',
    slug: 'dongfangtong',
    seat_quota: 50,
    notes: '黄芳负责'
  });
  assert.match(t.id, /^[0-9a-f-]{36}$/);
  assert.equal(t.name, '北京东方童');
  assert.equal(t.slug, 'dongfangtong');
  assert.equal(t.seat_quota, 50);
  assert.equal(t.status, 'active');
});

test('createTenant: rejects bad slug', () => {
  const repo = setup();
  assert.throws(
    () => repo.createTenant({ name: 'X', slug: 'Bad Slug!', seat_quota: 1 }),
    { code: 'invalid_slug' }
  );
  assert.throws(
    () => repo.createTenant({ name: 'X', slug: 'a', seat_quota: 1 }),
    { code: 'invalid_slug' }
  );
  assert.throws(
    () => repo.createTenant({ name: 'X', slug: '-leading-hyphen', seat_quota: 1 }),
    { code: 'invalid_slug' }
  );
});

test('createTenant: rejects duplicate slug', () => {
  const repo = setup();
  repo.createTenant({ name: 'A', slug: 'acme', seat_quota: 1 });
  assert.throws(
    () => repo.createTenant({ name: 'B', slug: 'acme', seat_quota: 1 }),
    { code: 'slug_exists' }
  );
});

test('createTenant: rejects out-of-range quota', () => {
  const repo = setup();
  assert.throws(
    () => repo.createTenant({ name: 'X', slug: 'acme-co', seat_quota: -1 }),
    { code: 'invalid_quota' }
  );
  assert.throws(
    () => repo.createTenant({ name: 'X', slug: 'acme-co2', seat_quota: 1.5 }),
    { code: 'invalid_quota' }
  );
});

test('listTenants: returns seats_used and license_count alongside tenant', () => {
  const repo = setup();
  const t = repo.createTenant({ name: 'X', slug: 'acme-co', seat_quota: 100 });
  const list = repo.listTenants();
  const found = list.find((r) => r.id === t.id);
  assert.ok(found);
  assert.equal(found.seats_used, 0);
  assert.equal(found.license_count, 0);
});

test('updateQuota / setStatus / renameTenant return updated row', () => {
  const repo = setup();
  const t = repo.createTenant({ name: 'X', slug: 'acme-co', seat_quota: 10 });
  assert.equal(repo.updateQuota(t.id, 25).seat_quota, 25);
  assert.equal(repo.setStatus(t.id, 'suspended').status, 'suspended');
  assert.equal(repo.renameTenant(t.id, 'New Name').name, 'New Name');
});

test('deleteTenant: forbidden for default tenant', () => {
  const repo = setup();
  assert.throws(() => repo.deleteTenant('default'), { code: 'cannot_delete_default' });
});

test('quotaRemaining: respects active license seats', () => {
  const repo = setup();
  const { db } = require('../src/db');
  const t = repo.createTenant({ name: 'X', slug: 'acme-co', seat_quota: 10 });
  db.prepare(`
    INSERT INTO licenses (license_key, customer_name, plan, seats, created_at, expires_at, status, tenant_id)
    VALUES (?, ?, 'pro', 3, datetime('now'), datetime('now','+1 month'), 'active', ?)
  `).run('NCLW-AAAAA-BBBBB-CCCCC-DDDDD', 'emp', t.id);
  assert.equal(repo.quotaRemaining(t.id), 7);
});
