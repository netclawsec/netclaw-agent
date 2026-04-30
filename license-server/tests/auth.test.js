const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

let server;
let baseUrl;
let admins;
let tenants;

function start() {
  freshDbEnv();
  purgeRequireCache();
  const express = require('express');
  const authRoutes = require('../src/routes/auth');
  const { requireAuth } = require('../src/auth/middleware');
  const asyncHandler = require('../src/utils/asyncHandler');

  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', asyncHandler(authRoutes.login));
  app.post('/api/auth/logout', authRoutes.logout);
  app.get('/api/auth/me', requireAuth, authRoutes.me);
  app.post('/api/auth/change-password', requireAuth, asyncHandler(authRoutes.changePassword));

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      tenants = require('../src/repos/tenants');
      admins = require('../src/repos/admins');
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

test('login flow: super admin', async () => {
  await start();
  try {
    await admins.createAdmin({
      tenant_id: null,
      username: 'crawford',
      password: 'super-pw-12345',
      role: 'super',
      display_name: 'Crawford'
    });

    const fail = await request('POST', '/api/auth/login', {
      body: { username: 'crawford', password: 'wrong' }
    });
    assert.equal(fail.status, 401);

    const ok = await request('POST', '/api/auth/login', {
      body: { username: 'crawford', password: 'super-pw-12345' }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.admin.role, 'super');
    const cookie = extractCookie(ok.headers['set-cookie']);
    assert.ok(cookie);

    const meAnon = await request('GET', '/api/auth/me');
    assert.equal(meAnon.status, 401);

    const me = await request('GET', '/api/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.admin.username, 'crawford');
    assert.equal(me.json.tenant, null);
  } finally {
    await stop();
  }
});

test('login flow: tenant admin tied to tenant', async () => {
  await start();
  try {
    const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 5 });
    await admins.createAdmin({
      tenant_id: t.id,
      username: 'mgr',
      password: 'mgr-pw-12345',
      role: 'tenant_admin'
    });

    const ok = await request('POST', '/api/auth/login', {
      body: { username: 'mgr', password: 'mgr-pw-12345' }
    });
    assert.equal(ok.status, 200);
    const cookie = extractCookie(ok.headers['set-cookie']);

    const me = await request('GET', '/api/auth/me', { cookie });
    assert.equal(me.json.admin.tenant_id, t.id);
    assert.equal(me.json.tenant.slug, 'acme-co');
  } finally {
    await stop();
  }
});

test('login flow: tenant suspended blocks login', async () => {
  await start();
  try {
    const t = tenants.createTenant({ name: 'Acme', slug: 'acme-co', seat_quota: 5 });
    await admins.createAdmin({
      tenant_id: t.id,
      username: 'mgr',
      password: 'mgr-pw-12345',
      role: 'tenant_admin'
    });
    tenants.setStatus(t.id, 'suspended');

    const res = await request('POST', '/api/auth/login', {
      body: { username: 'mgr', password: 'mgr-pw-12345' }
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'tenant_suspended');
  } finally {
    await stop();
  }
});

test('logout clears cookie', async () => {
  await start();
  try {
    await admins.createAdmin({ tenant_id: null, username: 'logoutuser', password: 'pw12345678', role: 'super' });
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'logoutuser', password: 'pw12345678' }
    });
    const cookie = extractCookie(login.headers['set-cookie']);

    const out = await request('POST', '/api/auth/logout', { cookie });
    assert.equal(out.status, 200);
    const cleared = out.headers['set-cookie'];
    assert.ok((Array.isArray(cleared) ? cleared : [cleared]).some((s) => /Max-Age=0/.test(s)));
  } finally {
    await stop();
  }
});

test('change-password: requires correct old password', async () => {
  await start();
  try {
    await admins.createAdmin({ tenant_id: null, username: 'rotater', password: 'old-pw-12345', role: 'super' });
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'rotater', password: 'old-pw-12345' }
    });
    const cookie = extractCookie(login.headers['set-cookie']);

    const wrong = await request('POST', '/api/auth/change-password', {
      cookie,
      body: { old_password: 'WRONG', new_password: 'new-pw-12345' }
    });
    assert.equal(wrong.status, 401);

    const ok = await request('POST', '/api/auth/change-password', {
      cookie,
      body: { old_password: 'old-pw-12345', new_password: 'new-pw-12345' }
    });
    assert.equal(ok.status, 200);

    const reLogin = await request('POST', '/api/auth/login', {
      body: { username: 'rotater', password: 'new-pw-12345' }
    });
    assert.equal(reLogin.status, 200);
  } finally {
    await stop();
  }
});
