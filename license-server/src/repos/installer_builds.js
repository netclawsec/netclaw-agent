const crypto = require('node:crypto');
const { db } = require('../db');

class InstallerBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'InstallerBuildError';
  }
}

const VALID_STATUS = new Set(['pending', 'building', 'succeeded', 'failed']);

const stmts = {
  insert: db.prepare(`
    INSERT INTO installer_builds
      (id, tenant_id, status, worker_kind, bundle_json, requested_by, requested_at)
    VALUES
      (@id, @tenant_id, @status, @worker_kind, @bundle_json, @requested_by, @requested_at)
  `),
  getById: db.prepare('SELECT * FROM installer_builds WHERE id = ?'),
  getOwned: db.prepare(
    'SELECT * FROM installer_builds WHERE id = ? AND tenant_id = ?'
  ),
  listByTenant: db.prepare(
    `SELECT * FROM installer_builds
     WHERE tenant_id = ?
     ORDER BY requested_at DESC
     LIMIT ?`
  ),
  // Pop one queued job for a worker. We claim with a single UPDATE so two
  // workers racing on the same row can't both end up with status=building.
  // Returns 1 if claimed, 0 otherwise.
  claim: db.prepare(
    `UPDATE installer_builds
        SET status = 'building', claimed_at = ?
      WHERE id = ?
        AND status = 'pending'`
  ),
  oldestPending: db.prepare(
    `SELECT id FROM installer_builds
      WHERE status = 'pending' AND worker_kind = ?
      ORDER BY requested_at ASC
      LIMIT 1`
  ),
  markSucceeded: db.prepare(
    `UPDATE installer_builds
        SET status = 'succeeded',
            download_url = ?,
            completed_at = ?
      WHERE id = ?
        AND status = 'building'`
  ),
  markFailed: db.prepare(
    `UPDATE installer_builds
        SET status = 'failed',
            error = ?,
            completed_at = ?
      WHERE id = ?
        AND status IN ('pending', 'building')`
  )
};

function nowIso() {
  return new Date().toISOString();
}

function mapRow(row) {
  if (!row) return null;
  let bundle_json;
  try {
    bundle_json = JSON.parse(row.bundle_json);
  } catch {
    bundle_json = null;
  }
  return { ...row, bundle_json };
}

function createBuild({ tenant_id, bundle_json, requested_by, worker_kind = 'manual' }) {
  if (!tenant_id) {
    throw new InstallerBuildError('invalid_tenant', 'tenant_id required');
  }
  if (!requested_by) {
    throw new InstallerBuildError('invalid_requester', 'requested_by required');
  }
  if (!bundle_json || typeof bundle_json !== 'object') {
    throw new InstallerBuildError('invalid_bundle', 'bundle_json must be an object');
  }
  if (worker_kind !== 'manual' && worker_kind !== 'gh_actions') {
    throw new InstallerBuildError('invalid_worker_kind', 'worker_kind must be manual|gh_actions');
  }
  const row = {
    id: crypto.randomUUID(),
    tenant_id,
    status: 'pending',
    worker_kind,
    bundle_json: JSON.stringify(bundle_json),
    requested_by,
    requested_at: nowIso()
  };
  stmts.insert.run(row);
  return mapRow(stmts.getById.get(row.id));
}

function getBuild(id, { tenant_id } = {}) {
  const row = tenant_id
    ? stmts.getOwned.get(id, tenant_id)
    : stmts.getById.get(id);
  return mapRow(row);
}

function listBuilds(tenant_id, { limit = 50 } = {}) {
  const capped = Math.max(1, Math.min(200, Number(limit) || 50));
  return stmts.listByTenant.all(tenant_id, capped).map(mapRow);
}

const claimNextTx = db.transaction((worker_kind) => {
  const next = stmts.oldestPending.get(worker_kind);
  if (!next) return null;
  const updated = stmts.claim.run(nowIso(), next.id);
  if (updated.changes !== 1) return null;
  return mapRow(stmts.getById.get(next.id));
});

function claimNextPending({ worker_kind = 'manual' } = {}) {
  return claimNextTx(worker_kind);
}

function claimById(id) {
  const result = stmts.claim.run(nowIso(), id);
  if (result.changes !== 1) {
    return null;
  }
  return mapRow(stmts.getById.get(id));
}

function markSucceeded(id, { download_url }) {
  if (typeof download_url !== 'string' || !download_url) {
    throw new InstallerBuildError('invalid_download_url', 'download_url must be a non-empty string');
  }
  const result = stmts.markSucceeded.run(download_url, nowIso(), id);
  if (result.changes !== 1) {
    return null;
  }
  return mapRow(stmts.getById.get(id));
}

function markFailed(id, { error }) {
  const errString =
    typeof error === 'string' && error.length ? error.slice(0, 2000) : 'unknown_error';
  const result = stmts.markFailed.run(errString, nowIso(), id);
  if (result.changes !== 1) {
    return null;
  }
  return mapRow(stmts.getById.get(id));
}

function reapStaleBuilding({ olderThanMs = 30 * 60 * 1000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stale = db
    .prepare(
      `SELECT id FROM installer_builds
        WHERE status = 'building'
          AND claimed_at IS NOT NULL
          AND claimed_at < ?`
    )
    .all(cutoff);
  let reaped = 0;
  for (const { id } of stale) {
    const out = markFailed(id, { error: 'build_timed_out' });
    if (out) reaped += 1;
  }
  return reaped;
}

module.exports = {
  InstallerBuildError,
  VALID_STATUS,
  createBuild,
  getBuild,
  listBuilds,
  claimNextPending,
  claimById,
  markSucceeded,
  markFailed,
  reapStaleBuilding
};
