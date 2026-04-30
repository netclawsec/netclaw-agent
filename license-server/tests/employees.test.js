const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

function setup() {
  freshDbEnv();
  purgeRequireCache();
  const { db } = require('../src/db');
  const tenants = require('../src/repos/tenants');
  const departments = require('../src/repos/departments');
  const employees = require('../src/repos/employees');
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme', seat_quota: 50 });
  const d = departments.createDepartment({ tenant_id: t.id, name: '研发部', abbrev: 'dev' });
  return { db, tenants, departments, employees, tenant_id: t.id, dept: d };
}

test('createEmployee: builds username = <abbrev>-<raw_username>, hides password_hash', async () => {
  const { employees, tenant_id, dept } = setup();
  const e = await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  assert.equal(e.username, 'dev-zhangsan');
  assert.equal(e.raw_username, 'zhangsan');
  assert.equal(e.password_hash, undefined, 'password_hash must not leak in public view');
  assert.equal(e.machine_fingerprint, 'fp-machine-aaaa-bbbb');
  assert.equal(e.status, 'active');
});

test('createEmployee: rejects weak password (no digit)', async () => {
  const { employees, tenant_id, dept } = setup();
  await assert.rejects(
    employees.createEmployee({
      tenant_id,
      department_id: dept.id,
      raw_username: 'zhangsan',
      password: 'abcdefgh',
      machine_fingerprint: 'fp-machine-aaaa-bbbb'
    }),
    (err) => err.code === 'weak_password'
  );
});

test('createEmployee: rejects short password', async () => {
  const { employees, tenant_id, dept } = setup();
  await assert.rejects(
    employees.createEmployee({
      tenant_id,
      department_id: dept.id,
      raw_username: 'zhangsan',
      password: 'abc12',
      machine_fingerprint: 'fp-machine-aaaa-bbbb'
    }),
    (err) => err.code === 'invalid_password'
  );
});

test('createEmployee: rejects raw_username that does not match pattern', async () => {
  const { employees, tenant_id, dept } = setup();
  await assert.rejects(
    employees.createEmployee({
      tenant_id,
      department_id: dept.id,
      raw_username: 'Zhang San',
      password: 'abcd1234',
      machine_fingerprint: 'fp-machine-aaaa-bbbb'
    }),
    (err) => err.code === 'invalid_username'
  );
});

test('createEmployee: enforces unique username within tenant', async () => {
  const { employees, tenant_id, dept } = setup();
  await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  await assert.rejects(
    employees.createEmployee({
      tenant_id,
      department_id: dept.id,
      raw_username: 'zhangsan',
      password: 'pass1234',
      machine_fingerprint: 'fp-machine-cccc-dddd'
    }),
    (err) => err.code === 'username_exists'
  );
});

test('createEmployee: rejects department from different tenant', async () => {
  const { tenants, departments, employees } = setup();
  const a = tenants.createTenant({ name: 'A', slug: 'tenant-a', seat_quota: 10 });
  const b = tenants.createTenant({ name: 'B', slug: 'tenant-b', seat_quota: 10 });
  const dB = departments.createDepartment({ tenant_id: b.id, name: 'B-Dev', abbrev: 'dev' });
  await assert.rejects(
    employees.createEmployee({
      tenant_id: a.id,
      department_id: dB.id,
      raw_username: 'evilbob',
      password: 'abcd1234',
      machine_fingerprint: 'fp-machine-cross-tenant'
    }),
    (err) => err.code === 'department_not_found'
  );
});

test('authenticate: succeeds with correct password and matching fingerprint', async () => {
  const { employees, tenant_id, dept } = setup();
  await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  const result = await employees.authenticate(
    tenant_id,
    'dev-zhangsan',
    'abcd1234',
    'fp-machine-aaaa-bbbb'
  );
  assert.equal(result.username, 'dev-zhangsan');
});

test('authenticate: rejects wrong password with bad_credentials', async () => {
  const { employees, tenant_id, dept } = setup();
  await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  await assert.rejects(
    employees.authenticate(tenant_id, 'dev-zhangsan', 'WRONG1234', 'fp-machine-aaaa-bbbb'),
    (err) => err.code === 'bad_credentials'
  );
});

test('authenticate: rejects mismatched fingerprint when machine already bound', async () => {
  const { employees, tenant_id, dept } = setup();
  await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  await assert.rejects(
    employees.authenticate(tenant_id, 'dev-zhangsan', 'abcd1234', 'fp-machine-other-cccc'),
    (err) => err.code === 'fingerprint_mismatch'
  );
});

test('authenticate: rejects suspended account', async () => {
  const { employees, tenant_id, dept } = setup();
  const e = await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  employees.setStatus(e.id, 'suspended');
  await assert.rejects(
    employees.authenticate(tenant_id, 'dev-zhangsan', 'abcd1234', 'fp-machine-aaaa-bbbb'),
    (err) => err.code === 'not_active'
  );
});

test('setStatus(suspended) unbinds the machine; re-bind on next login from new fp', async () => {
  const { employees, tenant_id, dept } = setup();
  const e = await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  employees.setStatus(e.id, 'suspended');
  let fresh = employees.getEmployee(e.id);
  assert.equal(fresh.machine_fingerprint, null);
  // re-activate to allow re-bind
  employees.setStatus(e.id, 'active');
  await employees.authenticate(tenant_id, 'dev-zhangsan', 'abcd1234', 'fp-machine-replacement');
  fresh = employees.getEmployee(e.id);
  assert.equal(fresh.machine_fingerprint, 'fp-machine-replacement');
});

test('changePassword: requires correct old password', async () => {
  const { employees, tenant_id, dept } = setup();
  const e = await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-aaaa-bbbb'
  });
  await assert.rejects(
    employees.changePassword(e.id, 'wrong', 'NEW_pass5678'),
    (err) => err.code === 'bad_old_password'
  );
  await employees.changePassword(e.id, 'abcd1234', 'NEW_pass5678');
  await employees.authenticate(tenant_id, 'dev-zhangsan', 'NEW_pass5678', 'fp-machine-aaaa-bbbb');
});

test('unbindMachine: clears fingerprint so employee can bind a new machine', async () => {
  const { employees, tenant_id, dept } = setup();
  const e = await employees.createEmployee({
    tenant_id,
    department_id: dept.id,
    raw_username: 'zhangsan',
    password: 'abcd1234',
    machine_fingerprint: 'fp-machine-old-1111'
  });
  employees.unbindMachine(e.id);
  const result = await employees.authenticate(
    tenant_id,
    'dev-zhangsan',
    'abcd1234',
    'fp-machine-new-2222'
  );
  assert.equal(result.machine_fingerprint, 'fp-machine-new-2222');
});
