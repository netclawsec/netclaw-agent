const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

function setup() {
  freshDbEnv();
  purgeRequireCache();
  const tenants = require('../src/repos/tenants');
  const admins = require('../src/repos/admins');
  return { tenants, admins };
}

test('hashPassword + verifyPassword roundtrip', async () => {
  const { admins } = setup();
  const stored = await admins.hashPassword('correct horse battery staple');
  assert.match(stored, /^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await admins.verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await admins.verifyPassword('wrong password', stored), false);
});

test('hashPassword: rejects too short / too long', async () => {
  const { admins } = setup();
  await assert.rejects(() => admins.hashPassword('short'), { code: 'invalid_password' });
  await assert.rejects(() => admins.hashPassword('a'.repeat(201)), { code: 'invalid_password' });
});

test('createAdmin: super admin without tenant_id', async () => {
  const { admins } = setup();
  const a = await admins.createAdmin({
    tenant_id: null,
    username: 'crawford',
    password: 'super-secret-pw',
    role: 'super',
    display_name: 'Super User'
  });
  assert.equal(a.role, 'super');
  assert.equal(a.tenant_id, null);
  assert.equal(a.password_hash, undefined, 'password_hash must not leak');
});

test('createAdmin: tenant_admin requires tenant_id', async () => {
  const { admins, tenants } = setup();
  const t = tenants.createTenant({ name: 'X', slug: 'acme-co', seat_quota: 10 });
  const a = await admins.createAdmin({
    tenant_id: t.id,
    username: 'manager',
    password: 'manager-pw',
    role: 'tenant_admin'
  });
  assert.equal(a.tenant_id, t.id);
});

test('createAdmin: rejects mismatched role+tenant', async () => {
  const { admins, tenants } = setup();
  const t = tenants.createTenant({ name: 'X', slug: 'acme-co', seat_quota: 10 });
  await assert.rejects(
    () => admins.createAdmin({ tenant_id: t.id, username: 'user1', password: 'pw12345678', role: 'super' }),
    { code: 'super_no_tenant' }
  );
  await assert.rejects(
    () => admins.createAdmin({ tenant_id: null, username: 'user2', password: 'pw12345678', role: 'tenant_admin' }),
    { code: 'tenant_admin_needs_tenant' }
  );
});

test('createAdmin: rejects duplicate username', async () => {
  const { admins } = setup();
  await admins.createAdmin({ tenant_id: null, username: 'dup', password: 'pw12345678', role: 'super' });
  await assert.rejects(
    () => admins.createAdmin({ tenant_id: null, username: 'dup', password: 'pw12345678', role: 'super' }),
    { code: 'username_exists' }
  );
});

test('createAdmin: rejects bad username pattern', async () => {
  const { admins } = setup();
  await assert.rejects(
    () => admins.createAdmin({ tenant_id: null, username: 'a b', password: 'pw12345678', role: 'super' }),
    { code: 'invalid_username' }
  );
});

test('authenticate: success returns admin, failure returns null', async () => {
  const { admins } = setup();
  await admins.createAdmin({ tenant_id: null, username: 'crawford', password: 'super-pw', role: 'super' });
  const ok = await admins.authenticate('crawford', 'super-pw');
  assert.ok(ok);
  assert.equal(ok.username, 'crawford');
  assert.equal(await admins.authenticate('crawford', 'wrong'), null);
  assert.equal(await admins.authenticate('nope', 'super-pw'), null);
});

test('authenticate: disabled admin cannot log in', async () => {
  const { admins } = setup();
  const a = await admins.createAdmin({ tenant_id: null, username: 'frozen', password: 'pw12345678', role: 'super' });
  admins.setStatus(a.id, 'disabled');
  assert.equal(await admins.authenticate('frozen', 'pw12345678'), null);
});

test('changePassword: invalidates old password', async () => {
  const { admins } = setup();
  const a = await admins.createAdmin({ tenant_id: null, username: 'rotater', password: 'old-pw12345', role: 'super' });
  await admins.changePassword(a.id, 'new-pw12345');
  assert.equal(await admins.authenticate('rotater', 'old-pw12345'), null);
  assert.ok(await admins.authenticate('rotater', 'new-pw12345'));
});

test('listAdminsByTenant: scoped to tenant', async () => {
  const { admins, tenants } = setup();
  const t1 = tenants.createTenant({ name: 'A', slug: 'acme-aa', seat_quota: 1 });
  const t2 = tenants.createTenant({ name: 'B', slug: 'acme-bb', seat_quota: 1 });
  await admins.createAdmin({ tenant_id: t1.id, username: 'a-mgr', password: 'pw12345678', role: 'tenant_admin' });
  await admins.createAdmin({ tenant_id: t2.id, username: 'b-mgr', password: 'pw12345678', role: 'tenant_admin' });
  const list = admins.listAdminsByTenant(t1.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].username, 'a-mgr');
});
