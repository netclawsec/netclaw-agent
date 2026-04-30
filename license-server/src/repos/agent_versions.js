const { db } = require('../db');

class AgentVersionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'AgentVersionError';
  }
}

// Semantic-version parser used for ordering published builds. We only
// support `<major>.<minor>.<patch>` — no prerelease/build metadata. Anything
// that doesn't parse sorts as 0.0.0 so it never beats a real version.
function parseSemver(s) {
  if (typeof s !== 'string') return [0, 0, 0];
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return av[i] - bv[i];
  }
  return 0;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO agent_versions
      (version, download_url, sha256, size_bytes, changelog, force_update_below,
       published_at, published_by, channel)
    VALUES
      (@version, @download_url, @sha256, @size_bytes, @changelog, @force_update_below,
       @published_at, @published_by, @channel)
  `),
  getByVersion: db.prepare('SELECT * FROM agent_versions WHERE version = ?'),
  listByChannel: db.prepare(
    'SELECT * FROM agent_versions WHERE channel = ? ORDER BY published_at DESC LIMIT ?'
  ),
  // We compute "latest" in JS because semver ordering isn't expressible in
  // SQLite without a custom collation. Fetching all rows is fine — there are
  // typically <100 published versions over the lifetime of the product.
  allByChannel: db.prepare(
    'SELECT * FROM agent_versions WHERE channel = ?'
  ),
  delete: db.prepare('DELETE FROM agent_versions WHERE version = ?')
};

function nowIso() {
  return new Date().toISOString();
}

function publishVersion({
  version,
  download_url,
  sha256,
  size_bytes,
  changelog,
  force_update_below,
  published_by,
  channel = 'stable'
}) {
  if (!version || parseSemver(version).every((n) => n === 0)) {
    throw new AgentVersionError('invalid_version', 'version must be x.y.z');
  }
  if (!download_url || !/^https?:\/\//.test(download_url)) {
    throw new AgentVersionError('invalid_download_url', 'download_url must be http(s)://...');
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256 || '')) {
    throw new AgentVersionError('invalid_sha256', 'sha256 must be a 64-char hex string');
  }
  if (!Number.isInteger(size_bytes) || size_bytes <= 0) {
    throw new AgentVersionError('invalid_size_bytes', 'size_bytes must be a positive int');
  }
  if (force_update_below !== undefined && force_update_below !== null) {
    if (parseSemver(force_update_below).every((n) => n === 0)) {
      throw new AgentVersionError('invalid_force_update_below', 'force_update_below must be x.y.z');
    }
    if (compareSemver(force_update_below, version) > 0) {
      throw new AgentVersionError(
        'force_below_exceeds_version',
        'force_update_below must be <= the version itself'
      );
    }
  }
  if (channel !== 'stable' && channel !== 'beta') {
    throw new AgentVersionError('invalid_channel', 'channel must be stable|beta');
  }
  const row = {
    version,
    download_url,
    sha256: sha256.toLowerCase(),
    size_bytes,
    changelog: changelog ?? null,
    force_update_below: force_update_below ?? null,
    published_at: nowIso(),
    published_by,
    channel
  };
  if (stmts.getByVersion.get(version)) {
    throw new AgentVersionError('version_already_published', `version ${version} already exists`);
  }
  stmts.insert.run(row);
  return row;
}

function getVersion(version) {
  return stmts.getByVersion.get(version) || null;
}

function listVersions({ channel = 'stable', limit = 50 } = {}) {
  const capped = Math.max(1, Math.min(200, Number(limit) || 50));
  return stmts.listByChannel.all(channel, capped);
}

function latestVersion({ channel = 'stable' } = {}) {
  const all = stmts.allByChannel.all(channel);
  if (all.length === 0) return null;
  return all.reduce((best, row) => {
    if (!best) return row;
    return compareSemver(row.version, best.version) > 0 ? row : best;
  }, null);
}

function deleteVersion(version) {
  const result = stmts.delete.run(version);
  return result.changes === 1;
}

module.exports = {
  AgentVersionError,
  publishVersion,
  getVersion,
  listVersions,
  latestVersion,
  deleteVersion,
  // exported for tests
  parseSemver,
  compareSemver
};
