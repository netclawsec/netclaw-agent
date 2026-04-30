const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

let server;
let baseUrl;
let tenants;
let admins;
let departments;
let employees;
let inviteCodes;
let authRoutes;
let tenantRoutes;
let asyncHandler;
let mw;

function start() {
  freshDbEnv();
  purgeRequireCache();
  const express = require('express');
  authRoutes = require('../src/routes/auth');
  tenantRoutes = require('../src/routes/tenant');
  mw = require('../src/auth/middleware');
  asyncHandler = require('../src/utils/asyncHandler');

  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', asyncHandler(authRoutes.login));

  app.get   ('/api/tenant/departments',                            mw.requireTenantAdmin, tenantRoutes.listDepartments);
  app.post  ('/api/tenant/departments',                            mw.requireTenantAdmin, tenantRoutes.createDepartment);
  app.patch ('/api/tenant/departments/:department_id',             mw.requireTenantAdmin, tenantRoutes.updateDepartment);
  app.delete('/api/tenant/departments/:department_id',             mw.requireTenantAdmin, tenantRoutes.deleteDepartment);

  app.get   ('/api/tenant/employees',                              mw.requireTenantAdmin, tenantRoutes.listEmployees);
  app.post  ('/api/tenant/employees',                              mw.requireTenantAdmin, asyncHandler(tenantRoutes.createEmployee));
  app.patch ('/api/tenant/employees/:employee_id',                 mw.requireTenantAdmin, tenantRoutes.updateEmployee);
  app.post  ('/api/tenant/employees/:employee_id/suspend',         mw.requireTenantAdmin, tenantRoutes.suspendEmployee);
  app.post  ('/api/tenant/employees/:employee_id/reactivate',      mw.requireTenantAdmin, tenantRoutes.reactivateEmployee);
  app.post  ('/api/tenant/employees/:employee_id/unbind',          mw.requireTenantAdmin, tenantRoutes.unbindEmployeeMachine);
  app.delete('/api/tenant/employees/:employee_id',                 mw.requireTenantAdmin, tenantRoutes.deleteEmployee);

  app.get   ('/api/tenant/invite-codes',                           mw.requireTenantAdmin, tenantRoutes.listInviteCodes);
  app.post  ('/api/tenant/invite-codes/:code/revoke',              mw.requireTenantAdmin, tenantRoutes.revokeInviteCode);

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      tenants = require('../src/repos/tenants');
      admins = require('../src/repos/admins');
      departments = require('../src/repos/departments');
      employees = require('../src/repos/employees');
      inviteCodes = require('../src/repos/invite_codes');
      resolve();
    });
  });
}

function stop() {
  return new Promise((resolve) => server.close(resolve));
}

async function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch {}
          resolve({ status: res.statusCode, json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function extractCookie(setCookie) {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const c = arr.find((s) => s.startsWith('nclw_admin='));
  return c ? c.split(';')[0] : null;
}

async function loginAsAdmin(slug, username) {
  const t = tenants.createTenant({ name: `Acme-${slug}`, slug, seat_quota: 50 });
  await admins.createAdmin({
    tenant_id: t.id,
    username,
    password: 'mgr-pw-12345',
    role: 'tenant_admin'
  });
  // tenant_admin login now requires an active NCLW key; issue one here so
  // each test starts with the company "paid up". Time-based revocation is
  // covered by auth.test.js.
  const license = require('../src/license');
  const lic = license.createLicense({
    tenant_id: t.id,
    customer_name: `Acme-${slug}`,
    months: 12,
    seats: 1
  });
  const login = await request('POST', '/api/auth/login', {
    body: { username, password: 'mgr-pw-12345', license_key: lic.license_key }
  });
  return { tenant: t, cookie: extractCookie(login.headers['set-cookie']), license: lic };
}

// ---------- departments ----------------------------------------------------

test('POST /tenant/departments creates a dept and rejects duplicate abbrev', async () => {
  await start();
  try {
    const { cookie } = await loginAsAdmin('acme-co', 'mgr');
    const a = await request('POST', '/api/tenant/departments', {
      cookie,
      body: { name: '研发部', abbrev: 'dev' }
    });
    assert.equal(a.status, 201);
    assert.equal(a.json.department.abbrev, 'dev');
    const b = await request('POST', '/api/tenant/departments', {
      cookie,
      body: { name: '工程部', abbrev: 'dev' }
    });
    assert.equal(b.status, 400);
    assert.equal(b.json.error, 'abbrev_exists');
  } finally { await stop(); }
});

test('PATCH /tenant/departments archives a dept', async () => {
  await start();
  try {
    const { cookie } = await loginAsAdmin('acme-co', 'mgr');
    const c = await request('POST', '/api/tenant/departments', {
      cookie,
      body: { name: '研发部', abbrev: 'dev' }
    });
    const u = await request('PATCH', `/api/tenant/departments/${c.json.department.id}`, {
      cookie,
      body: { status: 'archived' }
    });
    assert.equal(u.status, 200);
    assert.equal(u.json.department.status, 'archived');
  } finally { await stop(); }
});

test('cross-tenant isolation: dept owned by tenant B is not reachable from A', async () => {
  await start();
  try {
    const { cookie: cookieA } = await loginAsAdmin('acme-co', 'mgrA');
    const { tenant: tB } = await loginAsAdmin('beta-co', 'mgrB');
    const deptB = departments.createDepartment({
      tenant_id: tB.id,
      name: 'B-Dev',
      abbrev: 'bdev'
    });
    // Tenant A admin tries to PATCH B's dept by direct id guess -> 404, never 200.
    const r = await request('PATCH', `/api/tenant/departments/${deptB.id}`, {
      cookie: cookieA,
      body: { name: 'pwned' }
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'department_not_found');
    // Confirm the dept is unchanged.
    const fresh = departments.getDepartment(deptB.id);
    assert.equal(fresh.name, 'B-Dev');
  } finally { await stop(); }
});

// ---------- employees: invite-code create flow -----------------------------

test('POST /tenant/employees returns invite_code (no employee row yet)', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    const dept = departments.createDepartment({
      tenant_id: tenant.id,
      name: '研发部',
      abbrev: 'dev'
    });
    const r = await request('POST', '/api/tenant/employees', {
      cookie,
      body: { department_id: dept.id, raw_username: 'zhangsan', display_name: '张三' }
    });
    assert.equal(r.status, 201);
    assert.match(r.json.invite_code, /^[A-Z2-9]{8}$/);
    assert.equal(r.json.preview_username, 'dev-zhangsan');
    // No employee row was inserted yet.
    assert.equal(employees.listEmployees(tenant.id).length, 0);
    // Invite code lives in the table.
    assert.equal(inviteCodes.listByTenant(tenant.id).length, 1);
  } finally { await stop(); }
});

test('POST /tenant/employees rejects bad raw_username', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    const dept = departments.createDepartment({
      tenant_id: tenant.id,
      name: '研发部',
      abbrev: 'dev'
    });
    const r = await request('POST', '/api/tenant/employees', {
      cookie,
      body: { department_id: dept.id, raw_username: 'Big Boss' }
    });
    assert.equal(r.status, 400);
  } finally { await stop(); }
});

test('POST /tenant/employees: cross-tenant department is rejected', async () => {
  await start();
  try {
    const { cookie: cookieA } = await loginAsAdmin('acme-co', 'mgrA');
    const { tenant: tB } = await loginAsAdmin('beta-co', 'mgrB');
    const deptB = departments.createDepartment({
      tenant_id: tB.id,
      name: 'B-Dev',
      abbrev: 'bdev'
    });
    const r = await request('POST', '/api/tenant/employees', {
      cookie: cookieA,
      body: { department_id: deptB.id, raw_username: 'spy' }
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'department_not_found');
  } finally { await stop(); }
});

test('admin actions on employee row: suspend / unbind / reactivate / delete', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    const dept = departments.createDepartment({
      tenant_id: tenant.id,
      name: '研发部',
      abbrev: 'dev'
    });
    // Materialize an employee directly via repo (we test register-flow elsewhere).
    const emp = await employees.createEmployee({
      tenant_id: tenant.id,
      department_id: dept.id,
      raw_username: 'zhangsan',
      password: 'abcd1234',
      machine_fingerprint: 'fp-machine-aaaa-bbbb'
    });
    const suspended = await request('POST', `/api/tenant/employees/${emp.id}/suspend`, { cookie });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.json.employee.status, 'suspended');
    assert.equal(suspended.json.employee.machine_fingerprint, null);

    const reactivated = await request('POST', `/api/tenant/employees/${emp.id}/reactivate`, { cookie });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.json.employee.status, 'active');

    const unbound = await request('POST', `/api/tenant/employees/${emp.id}/unbind`, { cookie });
    assert.equal(unbound.status, 200);

    const removed = await request('DELETE', `/api/tenant/employees/${emp.id}`, { cookie });
    assert.equal(removed.status, 200);
    assert.equal(employees.listEmployees(tenant.id).length, 0);
  } finally { await stop(); }
});

test('cross-tenant isolation: employee from B not reachable via tenant A admin', async () => {
  await start();
  try {
    const { cookie: cookieA } = await loginAsAdmin('acme-co', 'mgrA');
    const { tenant: tB } = await loginAsAdmin('beta-co', 'mgrB');
    const deptB = departments.createDepartment({
      tenant_id: tB.id,
      name: 'B-Dev',
      abbrev: 'bdev'
    });
    const empB = await employees.createEmployee({
      tenant_id: tB.id,
      department_id: deptB.id,
      raw_username: 'bob',
      password: 'abcd1234',
      machine_fingerprint: 'fp-bob-machine'
    });
    const r = await request('POST', `/api/tenant/employees/${empB.id}/suspend`, { cookie: cookieA });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'employee_not_found');
    // Confirm B's employee is still active.
    const fresh = employees.getEmployee(empB.id);
    assert.equal(fresh.status, 'active');
  } finally { await stop(); }
});

// ---------- invite codes (revoke) -----------------------------------------

test('POST /tenant/invite-codes/:code/revoke: marks unused code revoked', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    const dept = departments.createDepartment({
      tenant_id: tenant.id,
      name: '研发部',
      abbrev: 'dev'
    });
    const c = await request('POST', '/api/tenant/employees', {
      cookie,
      body: { department_id: dept.id, raw_username: 'zhangsan' }
    });
    const code = c.json.invite_code;
    const r = await request('POST', `/api/tenant/invite-codes/${code}/revoke`, { cookie });
    assert.equal(r.status, 200);
    assert.ok(r.json.invite_code.used_at, 'revoked code should have used_at set');
    assert.equal(r.json.invite_code.used_by_employee_id, null);
  } finally { await stop(); }
});

test('cross-tenant isolation: cannot revoke another tenant invite code', async () => {
  await start();
  try {
    const { cookie: cookieA } = await loginAsAdmin('acme-co', 'mgrA');
    const { tenant: tB } = await loginAsAdmin('beta-co', 'mgrB');
    const deptB = departments.createDepartment({
      tenant_id: tB.id,
      name: 'B-Dev',
      abbrev: 'bdev'
    });
    const codeB = inviteCodes.createInviteCode({
      tenant_id: tB.id,
      department_id: deptB.id,
      raw_username: 'bobtarget'
    });
    const r = await request(
      'POST',
      `/api/tenant/invite-codes/${codeB.code}/revoke`,
      { cookie: cookieA }
    );
    // 400 from InviteCodeError, OR 404 — either way the action must fail.
    assert.notEqual(r.status, 200);
    const fresh = inviteCodes.getByCode(codeB.code);
    assert.equal(fresh.used_at, null);
  } finally { await stop(); }
});
