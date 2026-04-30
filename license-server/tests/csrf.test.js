const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, purgeRequireCache } = require('./_helpers');

function buildApp() {
  freshDbEnv();
  purgeRequireCache();
  const express = require('express');
  const { csrfOriginGuard } = require('../src/auth/csrf');
  const app = express();
  app.use(express.json());
  app.use(csrfOriginGuard);
  app.get('/safe', (req, res) => res.json({ ok: true }));
  app.post('/state', (req, res) => res.json({ ok: true }));
  return app;
}

const http = require('node:http');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function call(server, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ method, hostname: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET requests skip the CSRF guard', async () => {
  const server = await listen(buildApp());
  try {
    const r = await call(server, 'GET', '/safe');
    assert.equal(r.status, 200);
  } finally { await close(server); }
});

test('POST without Origin/Referer is rejected', async () => {
  const server = await listen(buildApp());
  try {
    const r = await call(server, 'POST', '/state');
    assert.equal(r.status, 403);
    assert.match(r.body, /csrf_origin_missing/);
  } finally { await close(server); }
});

test('POST with same-origin passes', async () => {
  const server = await listen(buildApp());
  try {
    const { port } = server.address();
    const r = await call(server, 'POST', '/state', {
      Origin: `http://127.0.0.1:${port}`,
      Host: `127.0.0.1:${port}`
    });
    assert.equal(r.status, 200);
  } finally { await close(server); }
});

test('POST with foreign origin is rejected', async () => {
  const server = await listen(buildApp());
  try {
    const r = await call(server, 'POST', '/state', {
      Origin: 'http://evil.example.com'
    });
    assert.equal(r.status, 403);
    assert.match(r.body, /csrf_origin_mismatch/);
  } finally { await close(server); }
});

test('ALLOWED_ORIGINS env adds explicit allow-list', async () => {
  process.env.ALLOWED_ORIGINS = 'https://license.netclawsec.com,http://120.55.247.72';
  const server = await listen(buildApp());
  try {
    const r = await call(server, 'POST', '/state', {
      Origin: 'http://120.55.247.72'
    });
    assert.equal(r.status, 200);
  } finally {
    delete process.env.ALLOWED_ORIGINS;
    await close(server);
  }
});
