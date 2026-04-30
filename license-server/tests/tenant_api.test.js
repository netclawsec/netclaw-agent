const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

let server;
let baseUrl;
let tenants;
let admins;
let license;
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
  app.get('/api/tenant/dashboard', mw.requireTenantAdmin, tenantRoutes.dashboard);
  app.get('/api/tenant/licenses', mw.requireTenantAdmin, tenantRoutes.listLicenses);
  app.post('/api/tenant/licenses', mw.requireTenantAdmin, tenantRoutes.createLicense);
  app.get('/api/tenant/licenses/:license_key', mw.requireTenantAdmin, tenantRoutes.getLicenseDetail);
  app.post('/api/tenant/licenses/:license_key/revoke', mw.requireTenantAdmin, tenantRoutes.revokeLicense);
  app.get('/api/tenant/seats', mw.requireTenantAdmin, tenantRoutes.listSeats);

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      tenants = require('../src/repos/tenants');
      admins = require('../src/repos/admins');
      license = require('../src/license');
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

async function loginAsTenantAdmin() {
  const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 10 });
  await admins.createAdmin({
    tenant_id: t.id,
    username: 'mgr',
    password: 'mgr-pw-12345',
    role: 'tenant_admin'
  });
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'mgr', password: 'mgr-pw-12345' }
  });
  return { tenant: t, cookie: extractCookie(login.headers['set-cookie']) };
}

test('tenant admin: dashboard reflects quota and counts', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsTenantAdmin();
    license.createLicense({ tenant_id: tenant.id, customer_name: 'employee-A', months: 1, seats: 3 });
    const r = await request('GET', '/api/tenant/dashboard', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json.tenant.seat_quota, 10);
    assert.equal(r.json.tenant.seats_used, 3);
    assert.equal(r.json.tenant.seats_remaining, 7);
    assert.equal(r.json.tenant.license_count, 1);
  } finally { await stop(); }
});

test('tenant admin: create license respects quota', async () => {
  await start();
  try {
    const { cookie } = await loginAsTenantAdmin();
    const ok = await request('POST', '/api/tenant/licenses', {
      cookie,
      body: { customer_name: 'employee-A', months: 6, seats: 5 }
    });
    assert.equal(ok.status, 201);
    assert.match(ok.json.license.license_key, /^NCLW-/);

    const exceed = await request('POST', '/api/tenant/licenses', {
      cookie,
      body: { customer_name: 'employee-B', months: 6, seats: 6 }
    });
    assert.equal(exceed.status, 400);
    assert.equal(exceed.json.error, 'quota_exceeded');
  } finally { await stop(); }
});

test('tenant admin: cannot access other tenant license', async () => {
  await start();
  try {
    const { cookie } = await loginAsTenantAdmin();

    const otherTenant = tenants.createTenant({ name: 'Other', slug: 'other-co', seat_quota: 5 });
    const otherLic = license.createLicense({
      tenant_id: otherTenant.id,
      customer_name: 'other-employee',
      months: 1,
      seats: 1
    });

    const r = await request('GET', `/api/tenant/licenses/${otherLic.license_key}`, { cookie });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'license_not_found');

    const revoke = await request('POST', `/api/tenant/licenses/${otherLic.license_key}/revoke`, { cookie });
    assert.equal(revoke.status, 404);
  } finally { await stop(); }
});

test('tenant admin: list licenses scoped to own tenant', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsTenantAdmin();
    license.createLicense({ tenant_id: tenant.id, customer_name: 'mine-1', months: 1, seats: 1 });
    license.createLicense({ tenant_id: tenant.id, customer_name: 'mine-2', months: 1, seats: 1 });

    const otherTenant = tenants.createTenant({ name: 'Other', slug: 'other-co', seat_quota: 5 });
    license.createLicense({ tenant_id: otherTenant.id, customer_name: 'theirs', months: 1, seats: 1 });

    const r = await request('GET', '/api/tenant/licenses', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json.licenses.length, 2);
    assert.ok(r.json.licenses.every((l) => l.tenant_id === tenant.id));
  } finally { await stop(); }
});

test('tenant admin: super admin cannot use tenant endpoints', async () => {
  await start();
  try {
    await admins.createAdmin({
      tenant_id: null,
      username: 'crawford',
      password: 'super-pw-12345',
      role: 'super'
    });
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'crawford', password: 'super-pw-12345' }
    });
    const cookie = extractCookie(login.headers['set-cookie']);
    const r = await request('GET', '/api/tenant/dashboard', { cookie });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'forbidden_tenant_admin_only');
  } finally { await stop(); }
});

test('tenant admin: revoke does not free quota mid-cycle (active=true still counted? no — revoked excluded)', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsTenantAdmin();
    const lic = license.createLicense({ tenant_id: tenant.id, customer_name: 'tmp', months: 1, seats: 5 });

    let dash = (await request('GET', '/api/tenant/dashboard', { cookie })).json.tenant;
    assert.equal(dash.seats_used, 5);

    await request('POST', `/api/tenant/licenses/${lic.license_key}/revoke`, { cookie });

    dash = (await request('GET', '/api/tenant/dashboard', { cookie })).json.tenant;
    assert.equal(dash.seats_used, 0, 'revoked license should not count toward quota');
  } finally { await stop(); }
});
