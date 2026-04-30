const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

function setup() {
  freshDbEnv();
  purgeRequireCache();
  return {
    license: require('../src/license'),
    tenants: require('../src/repos/tenants')
  };
}

test('createLicense: defaults to default tenant', () => {
  const { license } = setup();
  const lic = license.createLicense({ customer_name: 'X', months: 1, seats: 1 });
  assert.equal(lic.tenant_id, 'default');
});

test('createLicense: respects tenant quota', () => {
  const { license, tenants } = setup();
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 5 });
  license.createLicense({ tenant_id: t.id, customer_name: 'A', months: 1, seats: 3 });
  license.createLicense({ tenant_id: t.id, customer_name: 'B', months: 1, seats: 2 });
  assert.throws(
    () => license.createLicense({ tenant_id: t.id, customer_name: 'C', months: 1, seats: 1 }),
    { code: 'quota_exceeded' }
  );
});

test('createLicense: rejects unknown tenant', () => {
  const { license } = setup();
  assert.throws(
    () => license.createLicense({ tenant_id: 'no-such-tenant', customer_name: 'X', months: 1, seats: 1 }),
    { code: 'tenant_not_found' }
  );
});

test('createLicense: rejects suspended tenant', () => {
  const { license, tenants } = setup();
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 5 });
  tenants.setStatus(t.id, 'suspended');
  assert.throws(
    () => license.createLicense({ tenant_id: t.id, customer_name: 'X', months: 1, seats: 1 }),
    { code: 'tenant_suspended' }
  );
});

test('updateSeatsLimitWithQuota: enforces tenant quota', () => {
  const { license, tenants } = setup();
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 5 });
  const lic = license.createLicense({ tenant_id: t.id, customer_name: 'X', months: 1, seats: 3 });
  assert.equal(license.updateSeatsLimitWithQuota(lic.license_key, 5).seats, 5);
  assert.throws(
    () => license.updateSeatsLimitWithQuota(lic.license_key, 6),
    { code: 'quota_exceeded' }
  );
});

test('deleteTenant: refuses when tenant has licenses', () => {
  const { license, tenants } = setup();
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 5 });
  license.createLicense({ tenant_id: t.id, customer_name: 'X', months: 1, seats: 1 });
  assert.throws(() => tenants.deleteTenant(t.id), { code: 'tenant_has_licenses' });
});

test('listLicensesByTenant: scoped to tenant', () => {
  const { license, tenants } = setup();
  const a = tenants.createTenant({ name: 'A', slug: 'acme-aa', seat_quota: 5 });
  const b = tenants.createTenant({ name: 'B', slug: 'acme-bb', seat_quota: 5 });
  license.createLicense({ tenant_id: a.id, customer_name: 'A1', months: 1, seats: 1 });
  license.createLicense({ tenant_id: a.id, customer_name: 'A2', months: 1, seats: 1 });
  license.createLicense({ tenant_id: b.id, customer_name: 'B1', months: 1, seats: 1 });

  assert.equal(license.listLicensesByTenant(a.id).length, 2);
  assert.equal(license.listLicensesByTenant(b.id).length, 1);
});
