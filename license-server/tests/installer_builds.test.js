const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

let server;
let baseUrl;
let tenants;
let admins;
let departments;
let installerBuilds;
let authRoutes;
let installerRoutes;
let internalRoutes;
let asyncHandler;
let mw;
let workerAuth;

const WORKER_TOKEN = 'test-worker-token-1234567890abcdef';

function start() {
  freshDbEnv();
  process.env.BUILD_WORKER_TOKEN = WORKER_TOKEN;
  process.env.BUILD_DEFAULT_LICENSE_SERVER = 'https://license.test.example.com';
  purgeRequireCache();
  const express = require('express');
  authRoutes = require('../src/routes/auth');
  installerRoutes = require('../src/routes/installer');
  internalRoutes = require('../src/routes/internal');
  mw = require('../src/auth/middleware');
  workerAuth = require('../src/auth/worker');
  asyncHandler = require('../src/utils/asyncHandler');

  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', asyncHandler(authRoutes.login));

  app.post('/api/tenant/installer/builds',                  mw.requireTenantAdmin, asyncHandler(installerRoutes.createBuild));
  app.get ('/api/tenant/installer/builds',                  mw.requireTenantAdmin, installerRoutes.listBuilds);
  app.get ('/api/tenant/installer/builds/:build_id',        mw.requireTenantAdmin, installerRoutes.getBuild);

  app.get ('/api/internal/build-queue',                     workerAuth.requireBuildWorker, internalRoutes.claimNext);
  app.post('/api/internal/build-queue/:build_id/upload',    workerAuth.requireBuildWorker, internalRoutes.uploadResult);
  app.post('/api/internal/build-queue/:build_id/fail',      workerAuth.requireBuildWorker, internalRoutes.failBuild);
  app.post('/api/internal/build-queue/reap',                workerAuth.requireBuildWorker, internalRoutes.reapStale);

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      tenants = require('../src/repos/tenants');
      admins = require('../src/repos/admins');
      departments = require('../src/repos/departments');
      installerBuilds = require('../src/repos/installer_builds');
      resolve();
    });
  });
}

function stop() {
  return new Promise((resolve) => server.close(resolve));
}

async function request(method, path, { body, cookie, bearer } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const req = http.request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers },
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
  const t = tenants.createTenant({ name: `Co-${slug}`, slug, seat_quota: 50 });
  await admins.createAdmin({
    tenant_id: t.id,
    username,
    password: 'mgr-pw-12345',
    role: 'tenant_admin'
  });
  const login = await request('POST', '/api/auth/login', {
    body: { username, password: 'mgr-pw-12345' }
  });
  return { tenant: t, cookie: extractCookie(login.headers['set-cookie']) };
}

function seedDept(tenantId, abbrev = 'dev', name = '研发部') {
  return departments.createDepartment({ tenant_id: tenantId, name, abbrev });
}

// ---------- tenant-side ----------------------------------------------------

test('POST /tenant/installer/builds creates a pending build with bundle snapshot', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id, 'dev', '研发部');
    seedDept(tenant.id, 'mkt', '市场部');
    const r = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    assert.equal(r.status, 201);
    assert.equal(r.json.build.status, 'pending');
    assert.equal(r.json.build.tenant_id, tenant.id);
    const bundle = r.json.build.bundle_json;
    assert.equal(bundle.schema_version, 1);
    assert.equal(bundle.tenant_slug, 'acme-co');
    assert.equal(bundle.license_server, 'https://license.test.example.com');
    assert.equal(bundle.departments.length, 2);
    assert.deepEqual(
      bundle.departments.map((d) => d.abbrev).sort(),
      ['dev', 'mkt']
    );
  } finally { await stop(); }
});

test('POST /tenant/installer/builds rejects when no active departments', async () => {
  await start();
  try {
    const { cookie } = await loginAsAdmin('empty-co', 'mgr');
    const r = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'no_active_departments');
  } finally { await stop(); }
});

test('POST /tenant/installer/builds accepts license_server override', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id);
    const r = await request('POST', '/api/tenant/installer/builds', {
      cookie,
      body: { license_server: 'https://license.custom.example.com' }
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.build.bundle_json.license_server, 'https://license.custom.example.com');
  } finally { await stop(); }
});

test('GET /tenant/installer/builds/:id returns 404 for cross-tenant lookup', async () => {
  await start();
  try {
    const { tenant: tA, cookie: cookieA } = await loginAsAdmin('co-a', 'mgrA');
    const { tenant: tB } = await loginAsAdmin('co-b', 'mgrB');
    seedDept(tB.id);
    const buildB = installerBuilds.createBuild({
      tenant_id: tB.id,
      bundle_json: { schema_version: 1, tenant_slug: 'co-b' },
      requested_by: 'someone'
    });
    const r = await request('GET', `/api/tenant/installer/builds/${buildB.id}`, { cookie: cookieA });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'build_not_found');
    // Sanity: tenant A's own list is empty
    seedDept(tA.id);
    const list = await request('GET', '/api/tenant/installer/builds', { cookie: cookieA });
    assert.equal(list.json.builds.length, 0);
  } finally { await stop(); }
});

// ---------- worker-side ----------------------------------------------------

test('GET /internal/build-queue rejects without bearer token', async () => {
  await start();
  try {
    const r = await request('GET', '/api/internal/build-queue');
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'missing_worker_token');
  } finally { await stop(); }
});

test('GET /internal/build-queue rejects wrong bearer token', async () => {
  await start();
  try {
    const r = await request('GET', '/api/internal/build-queue', { bearer: 'wrong-token-zzzzz' });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'invalid_worker_token');
  } finally { await stop(); }
});

test('GET /internal/build-queue 204 when no pending', async () => {
  await start();
  try {
    const r = await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });
    assert.equal(r.status, 204);
  } finally { await stop(); }
});

test('worker happy path: claim → upload → succeeded', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id);
    const created = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    assert.equal(created.status, 201);
    const buildId = created.json.build.id;

    const claim = await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });
    assert.equal(claim.status, 200);
    assert.equal(claim.json.build.id, buildId);
    assert.equal(claim.json.build.status, 'building');
    assert.ok(claim.json.build.claimed_at);

    // Second claim should now return 204 (already claimed).
    const next = await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });
    assert.equal(next.status, 204);

    const upload = await request('POST', `/api/internal/build-queue/${buildId}/upload`, {
      bearer: WORKER_TOKEN,
      body: { download_url: 'https://oss.example.com/installers/acme-co/v1.exe' }
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.json.build.status, 'succeeded');
    assert.equal(upload.json.build.download_url, 'https://oss.example.com/installers/acme-co/v1.exe');

    // Tenant admin can now see the download URL.
    const detail = await request('GET', `/api/tenant/installer/builds/${buildId}`, { cookie });
    assert.equal(detail.json.build.status, 'succeeded');
    assert.equal(
      detail.json.build.download_url,
      'https://oss.example.com/installers/acme-co/v1.exe'
    );
  } finally { await stop(); }
});

test('worker fail path: claim → fail with error message', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id);
    const created = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    const buildId = created.json.build.id;
    await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });

    const fail = await request('POST', `/api/internal/build-queue/${buildId}/fail`, {
      bearer: WORKER_TOKEN,
      body: { error: 'PyInstaller crashed: OSError 2' }
    });
    assert.equal(fail.status, 200);
    assert.equal(fail.json.build.status, 'failed');
    assert.equal(fail.json.build.error, 'PyInstaller crashed: OSError 2');
  } finally { await stop(); }
});

test('worker upload to non-building build returns 409', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id);
    const created = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    // Note: did NOT claim it yet, so it's still status=pending.
    const upload = await request('POST', `/api/internal/build-queue/${created.json.build.id}/upload`, {
      bearer: WORKER_TOKEN,
      body: { download_url: 'https://oss.example.com/x.exe' }
    });
    assert.equal(upload.status, 409);
    assert.equal(upload.json.error, 'build_not_in_building_state');
  } finally { await stop(); }
});

test('two workers racing claim() yield distinct jobs (no double-claim)', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id);
    const a = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    const b = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    const ids = new Set([a.json.build.id, b.json.build.id]);

    const claim1 = await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });
    const claim2 = await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });
    const claim3 = await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN });

    assert.equal(claim1.status, 200);
    assert.equal(claim2.status, 200);
    assert.equal(claim3.status, 204);
    const claimed = new Set([claim1.json.build.id, claim2.json.build.id]);
    assert.equal(claimed.size, 2, 'each worker got a distinct job');
    assert.deepEqual([...claimed].sort(), [...ids].sort());
  } finally { await stop(); }
});

test('reap stale building jobs marks them failed', async () => {
  await start();
  try {
    const { tenant, cookie } = await loginAsAdmin('acme-co', 'mgr');
    seedDept(tenant.id);
    const created = await request('POST', '/api/tenant/installer/builds', { cookie, body: {} });
    await request('GET', '/api/internal/build-queue', { bearer: WORKER_TOKEN }); // claim

    // Backdate claimed_at to simulate a 31-min-old build.
    const { db } = require('../src/db');
    db.prepare(
      `UPDATE installer_builds SET claimed_at = ? WHERE id = ?`
    ).run(new Date(Date.now() - 31 * 60_000).toISOString(), created.json.build.id);

    const reap = await request('POST', '/api/internal/build-queue/reap', {
      bearer: WORKER_TOKEN,
      body: {}
    });
    assert.equal(reap.status, 200);
    assert.equal(reap.json.reaped, 1);

    const detail = await request('GET', `/api/tenant/installer/builds/${created.json.build.id}`, { cookie });
    assert.equal(detail.json.build.status, 'failed');
    assert.equal(detail.json.build.error, 'build_timed_out');
  } finally { await stop(); }
});
