const { z } = require('zod');

const agentVersionsRepo = require('../repos/agent_versions');

// Public route — agent clients call this on every launch with their current
// version. We don't gate by tenant_id here (any installed client can ask
// "what's latest?"), but the response is identical for all tenants since
// the build artifact is itself per-tenant via OSS object key. Tenants that
// haven't been re-built for the new version yet will simply get a 404 from
// OSS when they try to download — that's the signal "wait for rebuild".
function check(req, res) {
  const current = (req.query.current || '').toString();
  const channel = (req.query.channel || 'stable').toString();
  if (channel !== 'stable' && channel !== 'beta') {
    return res.status(400).json({ success: false, error: 'invalid_channel' });
  }
  const latest = agentVersionsRepo.latestVersion({ channel });
  if (!latest) {
    return res.json({ success: true, latest: null, has_update: false });
  }
  const hasUpdate =
    !current || agentVersionsRepo.compareSemver(latest.version, current) > 0;
  // Force-update is signaled when the client's current version is BELOW
  // the latest publication's force_update_below threshold. Designed for
  // urgent security patches where waiting on the user to click "update
  // later" isn't acceptable.
  const force =
    Boolean(latest.force_update_below) &&
    Boolean(current) &&
    agentVersionsRepo.compareSemver(current, latest.force_update_below) < 0;
  return res.json({
    success: true,
    has_update: hasUpdate,
    force,
    latest: {
      version: latest.version,
      download_url: latest.download_url,
      sha256: latest.sha256,
      size_bytes: latest.size_bytes,
      changelog: latest.changelog,
      published_at: latest.published_at
    }
  });
}

// ----- super-only publish ---------------------------------------------------

const publishSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  download_url: z.string().url().max(2048),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  size_bytes: z.number().int().positive(),
  changelog: z.string().max(4000).optional(),
  force_update_below: z.string().regex(/^\d+\.\d+\.\d+$/).nullable().optional(),
  channel: z.enum(['stable', 'beta']).default('stable')
});

function publish(req, res) {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const row = agentVersionsRepo.publishVersion({
      ...parsed.data,
      published_by: req.session.admin.id
    });
    return res.status(201).json({ success: true, version: row });
  } catch (err) {
    if (err && err.name === 'AgentVersionError') {
      return res.status(400).json({ success: false, error: err.code, message: err.message });
    }
    throw err;
  }
}

function listAll(req, res) {
  const channel = (req.query.channel || 'stable').toString();
  const limit = Number(req.query.limit) || 50;
  return res.json({
    success: true,
    versions: agentVersionsRepo.listVersions({ channel, limit })
  });
}

function deleteOne(req, res) {
  const ok = agentVersionsRepo.deleteVersion(req.params.version);
  if (!ok) {
    return res.status(404).json({ success: false, error: 'version_not_found' });
  }
  return res.json({ success: true });
}

module.exports = { check, publish, listAll, deleteOne };
