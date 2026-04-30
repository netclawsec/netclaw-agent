const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

function setup() {
  freshDbEnv();
  purgeRequireCache();
  const { db } = require('../src/db');
  const tenants = require('../src/repos/tenants');
  const departments = require('../src/repos/departments');
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme', seat_quota: 50 });
  return { db, tenants, departments, tenant_id: t.id };
}

test('createDepartment: rejects bad name and bad abbrev', () => {
  const { departments, tenant_id } = setup();
  assert.throws(
    () => departments.createDepartment({ tenant_id, name: '', abbrev: 'dev' }),
    (err) => err.code === 'invalid_name'
  );
  assert.throws(
    () => departments.createDepartment({ tenant_id, name: '研发', abbrev: 'DEV' }),
    (err) => err.code === 'invalid_abbrev'
  );
  assert.throws(
    () => departments.createDepartment({ tenant_id, name: '研发', abbrev: 'a' }),
    (err) => err.code === 'invalid_abbrev'
  );
});

test('createDepartment: enforces unique abbrev within tenant', () => {
  const { departments, tenant_id } = setup();
  departments.createDepartment({ tenant_id, name: '研发部', abbrev: 'dev' });
  assert.throws(
    () => departments.createDepartment({ tenant_id, name: '工程部', abbrev: 'dev' }),
    (err) => err.code === 'abbrev_exists'
  );
});

test('createDepartment: enforces unique name within tenant', () => {
  const { departments, tenant_id } = setup();
  departments.createDepartment({ tenant_id, name: '研发部', abbrev: 'dev' });
  assert.throws(
    () => departments.createDepartment({ tenant_id, name: '研发部', abbrev: 'eng' }),
    (err) => err.code === 'name_exists'
  );
});

test('different tenants can reuse the same abbrev/name', () => {
  const { departments, tenants } = setup();
  const a = tenants.createTenant({ name: 'A', slug: 'tenant-a', seat_quota: 10 });
  const b = tenants.createTenant({ name: 'B', slug: 'tenant-b', seat_quota: 10 });
  departments.createDepartment({ tenant_id: a.id, name: '研发部', abbrev: 'dev' });
  departments.createDepartment({ tenant_id: b.id, name: '研发部', abbrev: 'dev' });
  assert.equal(departments.listDepartments(a.id).length, 1);
  assert.equal(departments.listDepartments(b.id).length, 1);
});

test('updateDepartment: changes name + abbrev + status, blocks duplicates', () => {
  const { departments, tenant_id } = setup();
  const d1 = departments.createDepartment({ tenant_id, name: '研发部', abbrev: 'dev' });
  const d2 = departments.createDepartment({ tenant_id, name: '市场部', abbrev: 'mkt' });
  const u = departments.updateDepartment(d1.id, { name: '工程部', status: 'archived' });
  assert.equal(u.name, '工程部');
  assert.equal(u.status, 'archived');
  assert.throws(
    () => departments.updateDepartment(d2.id, { abbrev: 'dev' }),
    (err) => err.code === 'abbrev_exists'
  );
});

test('deleteDepartment: refuses if active employees exist, allows when none', async () => {
  const { departments, tenant_id } = setup();
  const employees = require('../src/repos/employees');
  const dept = departments.createDepartment({ tenant_id, name: '研发部', abbrev: 'dev' });

  // empty department -> deletable
  const removed = departments.deleteDepartment(dept.id);
  assert.equal(removed.id, dept.id);
  assert.equal(departments.getDepartment(dept.id), null);

  // with employee -> blocked
  const dept2 = departments.createDepartment({ tenant_id, name: '研发部', abbrev: 'dev' });
  await employees.createEmployee({
    tenant_id,
    department_id: dept2.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-test-machine-1234'
  });
  assert.throws(
    () => departments.deleteDepartment(dept2.id),
    (err) => err.code === 'department_in_use'
  );
});
