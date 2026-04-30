const { z } = require('zod');

const installerBuildsRepo = require('../repos/installer_builds');

// Worker pulls one job from the queue. We claim atomically inside the
// transaction so two concurrent workers can't both end up with the same job.
function claimNext(req, res) {
  const worker_kind = (req.query.worker_kind || 'manual').toString();
  if (worker_kind !== 'manual' && worker_kind !== 'gh_actions') {
    return res.status(400).json({ success: false, error: 'invalid_worker_kind' });
  }
  const build = installerBuildsRepo.claimNextPending({ worker_kind });
  if (!build) {
    return res.status(204).end();
  }
  return res.json({ success: true, build });
}

const uploadSchema = z.object({
  download_url: z.string().url().max(2048)
});

function uploadResult(req, res) {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const updated = installerBuildsRepo.markSucceeded(req.params.build_id, {
    download_url: parsed.data.download_url
  });
  if (!updated) {
    return res.status(409).json({ success: false, error: 'build_not_in_building_state' });
  }
  return res.json({ success: true, build: updated });
}

const failSchema = z.object({
  error: z.string().max(2000).optional()
});

function failBuild(req, res) {
  const parsed = failSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const updated = installerBuildsRepo.markFailed(req.params.build_id, {
    error: parsed.data.error || 'unspecified_failure'
  });
  if (!updated) {
    return res.status(409).json({ success: false, error: 'build_already_completed' });
  }
  return res.json({ success: true, build: updated });
}

function reapStale(req, res) {
  const reaped = installerBuildsRepo.reapStaleBuilding();
  return res.json({ success: true, reaped });
}

module.exports = {
  claimNext,
  uploadResult,
  failBuild,
  reapStale
};
