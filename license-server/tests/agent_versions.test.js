const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

let server;
let baseUrl;
let tenants;
let admins;
let agentVersions;
let authRoutes;
let agentVersionsRoutes;
let asyncHandler;
let mw;

function start() {
  freshDbEnv();
  purgeRequireCache();
  const express = require('express');
  authRoutes = require('../src/routes/auth');
  agentVersionsRoutes = require('../src/routes/agent_versions');
  mw = require('../src/auth/middleware');
  asyncHandler = require('../src/utils/asyncHandler');

  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', asyncHandler(authRoutes.login));
  app.get('/api/agent/version-check', agentVersionsRoutes.check);
  app.get('/api/super/agent/versions', mw.requireSuper, agentVersionsRoutes.listAll);
  app.post('/api/super/agent/versions', mw.requireSuper, agentVersionsRoutes.publish);
  app.delete('/api/super/agent/versions/:version', mw.requireSuper, agentVersionsRoutes.deleteOne);

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      tenants = require('../src/repos/tenants');
      admins = require('../src/repos/admins');
      agentVersions = require('../src/repos/agent_versions');
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

async function loginAsSuper(username = 'super1') {
  await admins.createAdmin({
    tenant_id: null,
    username,
    password: 'super-pw-12345',
    role: 'super'
  });
  const login = await request('POST', '/api/auth/login', {
    body: { username, password: 'super-pw-12345' }
  });
  return extractCookie(login.headers['set-cookie']);
}

const SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ---------- semver helpers --------------------------------------------------

test('semver parser handles x.y.z', async () => {
  await start();
  try {
    assert.deepEqual(agentVersions.parseSemver('0.10.0'), [0, 10, 0]);
    assert.deepEqual(agentVersions.parseSemver('1.2.3'), [1, 2, 3]);
    assert.deepEqual(agentVersions.parseSemver(' garbage '), [0, 0, 0]);
    assert.equal(agentVersions.compareSemver('0.10.0', '0.9.999'), Number(10) - Number(9));
    assert.ok(agentVersions.compareSemver('1.0.0', '0.99.99') > 0);
    assert.ok(agentVersions.compareSemver('0.10.0', '0.10.0') === 0);
  } finally { await stop(); }
});

// ---------- public version-check -------------------------------------------

test('GET /api/agent/version-check returns null when no versions published', async () => {
  await start();
  try {
    const r = await request('GET', '/api/agent/version-check?current=0.10.0');
    assert.equal(r.status, 200);
    assert.equal(r.json.has_update, false);
    assert.equal(r.json.latest, null);
  } finally { await stop(); }
});

test('version-check: latest > current → has_update=true', async () => {
  await start();
  try {
    agentVersions.publishVersion({
      version: '0.11.0',
      download_url: 'https://oss.example.com/installers/demo/v.exe',
      sha256: SHA,
      size_bytes: 60_000_000,
      changelog: 'fix CSV export',
      published_by: 'super1',
      channel: 'stable'
    });
    const r = await request('GET', '/api/agent/version-check?current=0.10.0');
    assert.equal(r.status, 200);
    assert.equal(r.json.has_update, true);
    assert.equal(r.json.force, false);
    assert.equal(r.json.latest.version, '0.11.0');
    assert.equal(r.json.latest.sha256, SHA);
  } finally { await stop(); }
});

test('version-check: same version → has_update=false', async () => {
  await start();
  try {
    agentVersions.publishVersion({
      version: '0.10.0',
      download_url: 'https://oss.example.com/installers/demo/v.exe',
      sha256: SHA,
      size_bytes: 60_000_000,
      published_by: 'super1'
    });
    const r = await request('GET', '/api/agent/version-check?current=0.10.0');
    assert.equal(r.json.has_update, false);
  } finally { await stop(); }
});

test('version-check: force flag set when current < force_update_below', async () => {
  await start();
  try {
    agentVersions.publishVersion({
      version: '0.11.0',
      download_url: 'https://oss.example.com/v.exe',
      sha256: SHA,
      size_bytes: 60_000_000,
      force_update_below: '0.10.5',
      published_by: 'super1'
    });
    // current=0.10.0 < force_update_below=0.10.5 → force=true
    const force = await request('GET', '/api/agent/version-check?current=0.10.0');
    assert.equal(force.json.force, true);
    // current=0.10.5 == force_update_below → force=false (not strictly below)
    const noForce = await request('GET', '/api/agent/version-check?current=0.10.5');
    assert.equal(noForce.json.force, false);
  } finally { await stop(); }
});

test('version-check: latest computed by semver, not insertion order', async () => {
  await start();
  try {
    // Insert 0.10.5 AFTER 0.11.0 — without semver-based selection,
    // insertion-order or published_at-DESC would falsely return 0.10.5.
    agentVersions.publishVersion({
      version: '0.11.0',
      download_url: 'https://oss.example.com/a.exe',
      sha256: SHA,
      size_bytes: 1,
      published_by: 'super1'
    });
    agentVersions.publishVersion({
      version: '0.10.5',
      download_url: 'https://oss.example.com/b.exe',
      sha256: SHA,
      size_bytes: 1,
      published_by: 'super1'
    });
    const r = await request('GET', '/api/agent/version-check?current=0.9.0');
    assert.equal(r.json.latest.version, '0.11.0');
  } finally { await stop(); }
});

// ---------- super-only publish ---------------------------------------------

test('POST /super/agent/versions: requires super', async () => {
  await start();
  try {
    const r = await request('POST', '/api/super/agent/versions', { body: { version: '0.11.0' } });
    assert.equal(r.status, 401);
  } finally { await stop(); }
});

test('POST /super/agent/versions: publishes a stable build', async () => {
  await start();
  try {
    const cookie = await loginAsSuper();
    const r = await request('POST', '/api/super/agent/versions', {
      cookie,
      body: {
        version: '0.11.0',
        download_url: 'https://oss.example.com/installers/demo/0.11.0.exe',
        sha256: SHA,
        size_bytes: 60_000_000,
        changelog: 'CSRF guard bug fix',
        channel: 'stable'
      }
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.version.version, '0.11.0');
    // published_by is the admin's UUID (req.session.admin.id), not username
    assert.match(r.json.version.published_by, /^[a-f0-9-]{36}$/);
  } finally { await stop(); }
});

test('POST /super/agent/versions: rejects invalid sha256', async () => {
  await start();
  try {
    const cookie = await loginAsSuper();
    const r = await request('POST', '/api/super/agent/versions', {
      cookie,
      body: {
        version: '0.11.0',
        download_url: 'https://oss.example.com/x.exe',
        sha256: 'not-a-hex-string',
        size_bytes: 100
      }
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_body');
  } finally { await stop(); }
});

test('POST /super/agent/versions: duplicate version returns 400', async () => {
  await start();
  try {
    const cookie = await loginAsSuper();
    const body = {
      version: '0.11.0',
      download_url: 'https://oss.example.com/x.exe',
      sha256: SHA,
      size_bytes: 100
    };
    const r1 = await request('POST', '/api/super/agent/versions', { cookie, body });
    assert.equal(r1.status, 201);
    const r2 = await request('POST', '/api/super/agent/versions', { cookie, body });
    assert.equal(r2.status, 400);
    assert.equal(r2.json.error, 'version_already_published');
  } finally { await stop(); }
});

test('POST /super/agent/versions: rejects force_update_below > version', async () => {
  await start();
  try {
    const cookie = await loginAsSuper();
    const r = await request('POST', '/api/super/agent/versions', {
      cookie,
      body: {
        version: '0.11.0',
        download_url: 'https://oss.example.com/x.exe',
        sha256: SHA,
        size_bytes: 100,
        force_update_below: '0.12.0' // ahead of the version itself
      }
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'force_below_exceeds_version');
  } finally { await stop(); }
});

test('GET + DELETE /super/agent/versions', async () => {
  await start();
  try {
    const cookie = await loginAsSuper();
    await request('POST', '/api/super/agent/versions', {
      cookie,
      body: { version: '0.11.0', download_url: 'https://oss.example.com/a.exe', sha256: SHA, size_bytes: 1 }
    });
    await request('POST', '/api/super/agent/versions', {
      cookie,
      body: { version: '0.10.0', download_url: 'https://oss.example.com/b.exe', sha256: SHA, size_bytes: 1 }
    });
    const list = await request('GET', '/api/super/agent/versions', { cookie });
    assert.equal(list.json.versions.length, 2);

    const del = await request('DELETE', '/api/super/agent/versions/0.11.0', { cookie });
    assert.equal(del.status, 200);
    const after = await request('GET', '/api/super/agent/versions', { cookie });
    assert.equal(after.json.versions.length, 1);
    assert.equal(after.json.versions[0].version, '0.10.0');
  } finally { await stop(); }
});
