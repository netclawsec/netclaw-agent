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
let employeeRoutes;
let asyncHandler;

function start() {
  freshDbEnv();
  process.env.EMPLOYEE_JWT_SECRET = 'e'.repeat(64);
  purgeRequireCache();
  const express = require('express');
  asyncHandler = require('../src/utils/asyncHandler');
  employeeRoutes = require('../src/routes/employee');

  const app = express();
  app.use(express.json());
  app.post('/api/employee/register',         asyncHandler(employeeRoutes.register));
  app.post('/api/employee/login',            asyncHandler(employeeRoutes.login));
  app.get ('/api/employee/me',               employeeRoutes.requireEmployee, employeeRoutes.me);
  app.post('/api/employee/refresh',          employeeRoutes.requireEmployee, employeeRoutes.refresh);
  app.post('/api/employee/change-password',  employeeRoutes.requireEmployee, asyncHandler(employeeRoutes.changePassword));
  app.post('/api/employee/logout',           employeeRoutes.requireEmployee, employeeRoutes.logout);

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

async function request(method, path, { body, bearer } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const headers = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const req = http.request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setupTenantWithInvite(slug = 'acme-co') {
  const t = tenants.createTenant({ name: `Acme-${slug}`, slug, seat_quota: 50 });
  const dept = departments.createDepartment({
    tenant_id: t.id,
    name: '研发部',
    abbrev: 'dev'
  });
  const invite = inviteCodesRepoCreate(t.id, dept.id, 'zhangsan');
  return { tenant: t, dept, invite };
}
function inviteCodesRepoCreate(tenant_id, department_id, raw_username) {
  return inviteCodes.createInviteCode({ tenant_id, department_id, raw_username });
}

// ---------- register --------------------------------------------------------

test('register: invite_code + password creates employee + returns JWT', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    const r = await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.username, 'dev-zhangsan');
    assert.equal(typeof r.json.jwt, 'string');
    // employee row exists; invite_code is consumed.
    assert.equal(employees.listEmployees(tenant.id).length, 1);
    const usedInvite = inviteCodes.getByCode(invite.code);
    assert.ok(usedInvite.used_at, 'invite should be marked used');
    assert.equal(usedInvite.used_by_employee_id, r.json.employee_id);
  } finally { await stop(); }
});

test('register: same invite_code cannot be used twice', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    const ok = await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(ok.status, 201);
    const second = await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'pass5678',
        machine_fingerprint: 'fp-machine-cccc-dddd'
      }
    });
    assert.equal(second.status, 400);
    assert.equal(second.json.error, 'invite_already_used');
  } finally { await stop(); }
});

test('register: invite_code from another tenant is rejected', async () => {
  await start();
  try {
    const { tenant: tA } = await setupTenantWithInvite('acme-co');
    const { tenant: tB, invite: inviteB } = await setupTenantWithInvite('beta-co');
    const r = await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tA.id,
        invite_code: inviteB.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-cross'
      }
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'invite_not_found');
  } finally { await stop(); }
});

test('register: weak password rejected (no digit)', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    const r = await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'onlyletters',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'weak_password');
    // Invite must still be usable since registration failed.
    const fresh = inviteCodes.getByCode(invite.code);
    assert.equal(fresh.used_at, null);
  } finally { await stop(); }
});

test('register: suspended tenant is rejected', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    tenants.setStatus(tenant.id, 'suspended');
    const r = await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'tenant_suspended');
  } finally { await stop(); }
});

// ---------- login -----------------------------------------------------------

test('login: succeeds for registered employee, returns fresh JWT', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    const r = await request('POST', '/api/employee/login', {
      body: {
        tenant_id: tenant.id,
        username: 'dev-zhangsan',
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.jwt, 'string');
  } finally { await stop(); }
});

test('login: wrong password returns bad_credentials', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    const r = await request('POST', '/api/employee/login', {
      body: {
        tenant_id: tenant.id,
        username: 'dev-zhangsan',
        password: 'WRONGPASS9',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_credentials');
  } finally { await stop(); }
});

test('login: foreign machine fingerprint after binding -> fingerprint_mismatch', async () => {
  await start();
  try {
    const { tenant, invite } = await setupTenantWithInvite();
    await request('POST', '/api/employee/register', {
      body: {
        tenant_id: tenant.id,
        invite_code: invite.code,
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    const r = await request('POST', '/api/employee/login', {
      body: {
        tenant_id: tenant.id,
        username: 'dev-zhangsan',
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-different-cccc'
      }
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'fingerprint_mismatch');
  } finally { await stop(); }
});

// ---------- me / refresh / change-password / logout -----------------------

async function registerAndGetJwt() {
  const { tenant, invite } = await setupTenantWithInvite();
  const reg = await request('POST', '/api/employee/register', {
    body: {
      tenant_id: tenant.id,
      invite_code: invite.code,
      password: 'abcd1234',
      machine_fingerprint: 'fp-machine-aaaa-bbbb'
    }
  });
  return { tenant, jwt: reg.json.jwt, employee_id: reg.json.employee_id };
}

test('GET /me with valid JWT returns employee + tenant info', async () => {
  await start();
  try {
    const { jwt } = await registerAndGetJwt();
    const r = await request('GET', '/api/employee/me', { bearer: jwt });
    assert.equal(r.status, 200);
    assert.equal(r.json.employee.username, 'dev-zhangsan');
    assert.equal(r.json.tenant.slug, 'acme-co');
    assert.equal(r.json.department.abbrev, 'dev');
  } finally { await stop(); }
});

test('GET /me without bearer returns 401', async () => {
  await start();
  try {
    const r = await request('GET', '/api/employee/me');
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'unauthenticated');
  } finally { await stop(); }
});

test('GET /me after admin suspends employee -> 403 employee_inactive', async () => {
  await start();
  try {
    const { jwt, employee_id } = await registerAndGetJwt();
    employees.setStatus(employee_id, 'suspended');
    const r = await request('GET', '/api/employee/me', { bearer: jwt });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'employee_inactive');
  } finally { await stop(); }
});

test('refresh with same fingerprint returns valid JWT and works for /me', async () => {
  await start();
  try {
    const { jwt } = await registerAndGetJwt();
    const r = await request('POST', '/api/employee/refresh', {
      bearer: jwt,
      body: { machine_fingerprint: 'fp-machine-aaaa-bbbb' }
    });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.jwt, 'string');
    assert.ok(r.json.expires_at);
    // Refreshed token can be used for /me.
    const me = await request('GET', '/api/employee/me', { bearer: r.json.jwt });
    assert.equal(me.status, 200);
  } finally { await stop(); }
});

test('refresh with different fingerprint returns fingerprint_mismatch', async () => {
  await start();
  try {
    const { jwt } = await registerAndGetJwt();
    const r = await request('POST', '/api/employee/refresh', {
      bearer: jwt,
      body: { machine_fingerprint: 'fp-machine-other-cccc' }
    });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'fingerprint_mismatch');
  } finally { await stop(); }
});

test('change-password: requires correct old, then login uses new', async () => {
  await start();
  try {
    const { tenant, jwt } = await registerAndGetJwt();
    const wrong = await request('POST', '/api/employee/change-password', {
      bearer: jwt,
      body: { old_password: 'WRONG', new_password: 'NEW_pw_5678' }
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error, 'bad_old_password');
    const ok = await request('POST', '/api/employee/change-password', {
      bearer: jwt,
      body: { old_password: 'abcd1234', new_password: 'NEW_pw_5678' }
    });
    assert.equal(ok.status, 200);
    const oldFails = await request('POST', '/api/employee/login', {
      body: {
        tenant_id: tenant.id,
        username: 'dev-zhangsan',
        password: 'abcd1234',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(oldFails.json.error, 'bad_credentials');
    const newOk = await request('POST', '/api/employee/login', {
      body: {
        tenant_id: tenant.id,
        username: 'dev-zhangsan',
        password: 'NEW_pw_5678',
        machine_fingerprint: 'fp-machine-aaaa-bbbb'
      }
    });
    assert.equal(newOk.status, 200);
  } finally { await stop(); }
});

test('logout: returns success without server-side state change', async () => {
  await start();
  try {
    const { jwt } = await registerAndGetJwt();
    const r = await request('POST', '/api/employee/logout', { bearer: jwt });
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
    // JWT is still valid until expiry — logout is currently client-side only.
    const meAfter = await request('GET', '/api/employee/me', { bearer: jwt });
    assert.equal(meAfter.status, 200);
  } finally { await stop(); }
});

test('me with token from a forged or expired secret is rejected', async () => {
  await start();
  try {
    // Forged JWT signed with a different secret.
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { sub: 'fake', tenant_id: 'fake', fp: 'fp-fake-machine' },
      'attacker-' + 'x'.repeat(60),
      { algorithm: 'HS256', issuer: 'netclaw-license', audience: 'netclaw-agent-employee', expiresIn: '1h' }
    );
    const r = await request('GET', '/api/employee/me', { bearer: bad });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'invalid_token');
  } finally { await stop(); }
});
