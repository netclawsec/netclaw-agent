const { z } = require('zod');

const tenantsRepo = require('../repos/tenants');
const departmentsRepo = require('../repos/departments');
const installerBuildsRepo = require('../repos/installer_builds');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function tenantOf(req) {
  return req.session.admin.tenant_id;
}
function adminIdOf(req) {
  return req.session.admin.id;
}

const buildRequestSchema = z.object({
  // Optional: caller can pin a license_server URL override (default: env or
  // tenant default). If omitted, server fills in BUILD_DEFAULT_LICENSE_SERVER.
  license_server: z.string().url().max(200).optional(),
  // Whether the bundled installer requires invite codes for employee
  // self-registration (mirrors §3.4 of the multi-tenant plan).
  require_invite_code: z.boolean().optional()
});

// Build the bundle.json payload that the per-tenant Windows installer will
// embed. The payload is captured *at request time* — later department
// edits don't retroactively change historical builds.
function snapshotBundle(tenantId, opts) {
  const tenant = tenantsRepo.getTenant(tenantId);
  if (!tenant || tenant.status !== 'active') {
    return { error: 'tenant_not_found_or_inactive' };
  }
  if (!SLUG_RE.test(tenant.slug || '')) {
    return { error: 'tenant_slug_unsuitable_for_build' };
  }
  const departments = departmentsRepo
    .listDepartments(tenantId)
    .filter((d) => d.status === 'active')
    .map((d) => ({ id: d.id, name: d.name, abbrev: d.abbrev }));
  if (departments.length === 0) {
    return { error: 'no_active_departments' };
  }
  const license_server =
    opts.license_server ||
    process.env.BUILD_DEFAULT_LICENSE_SERVER ||
    'https://license.netclawsec.com.cn';
  return {
    bundle: {
      schema_version: 1,
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      tenant_name: tenant.name,
      license_server,
      require_invite_code: opts.require_invite_code !== false,
      departments,
      built_at: new Date().toISOString()
    }
  };
}

function createBuild(req, res) {
  const parsed = buildRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const tenantId = tenantOf(req);
  const snap = snapshotBundle(tenantId, parsed.data);
  if (snap.error) {
    return res.status(400).json({ success: false, error: snap.error });
  }
  const build = installerBuildsRepo.createBuild({
    tenant_id: tenantId,
    bundle_json: snap.bundle,
    requested_by: adminIdOf(req),
    worker_kind: 'manual'
  });
  return res.status(201).json({ success: true, build });
}

function listBuilds(req, res) {
  const limit = Number(req.query.limit) || 50;
  const builds = installerBuildsRepo.listBuilds(tenantOf(req), { limit });
  return res.json({ success: true, builds });
}

function getBuild(req, res) {
  const build = installerBuildsRepo.getBuild(req.params.build_id, {
    tenant_id: tenantOf(req)
  });
  if (!build) {
    return res.status(404).json({ success: false, error: 'build_not_found' });
  }
  return res.json({ success: true, build });
}

module.exports = {
  createBuild,
  listBuilds,
  getBuild,
  // Exported for tests so they can stub the snapshot logic if needed.
  __snapshotBundle: snapshotBundle
};
