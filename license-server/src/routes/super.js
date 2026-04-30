const { z } = require('zod');
const tenantsRepo = require('../repos/tenants');
const adminsRepo = require('../repos/admins');
const license = require('../license');

const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/);
const NAME = z.string().min(1).max(100);
const QUOTA = z.number().int().min(0).max(1_000_000);
const USERNAME = z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/);
const PASSWORD = z.string().min(8).max(200);

function handleRepoError(res, err) {
  if (err && err.name === 'TenantError') {
    return res.status(400).json({ success: false, error: err.code, message: err.message });
  }
  if (err && err.name === 'AdminError') {
    return res.status(400).json({ success: false, error: err.code, message: err.message });
  }
  throw err;
}

function listTenants(req, res) {
  return res.json({ success: true, tenants: tenantsRepo.listTenants() });
}

const createTenantSchema = z.object({
  name: NAME,
  slug: SLUG,
  seat_quota: QUOTA,
  notes: z.string().max(500).optional()
});

function createTenant(req, res) {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const t = tenantsRepo.createTenant(parsed.data);
    return res.status(201).json({ success: true, tenant: t });
  } catch (err) {
    return handleRepoError(res, err);
  }
}

function getTenantWithAdmins(req, res) {
  const t = tenantsRepo.getTenant(req.params.tenant_id);
  if (!t) return res.status(404).json({ success: false, error: 'tenant_not_found' });
  return res.json({
    success: true,
    tenant: {
      ...t,
      seats_used: tenantsRepo.listTenants().find((x) => x.id === t.id)?.seats_used || 0,
      quota_remaining: tenantsRepo.quotaRemaining(t.id)
    },
    admins: adminsRepo.listAdminsByTenant(t.id),
    licenses: license.listLicenses().filter((l) => l.tenant_id === t.id)
  });
}

const updateTenantSchema = z.object({
  name: NAME.optional(),
  seat_quota: QUOTA.optional(),
  status: z.enum(['active', 'suspended']).optional(),
  notes: z.string().max(500).nullable().optional()
});

function updateTenant(req, res) {
  const parsed = updateTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const t = tenantsRepo.getTenant(req.params.tenant_id);
  if (!t) return res.status(404).json({ success: false, error: 'tenant_not_found' });
  try {
    let updated = t;
    if (parsed.data.name !== undefined) updated = tenantsRepo.renameTenant(t.id, parsed.data.name) || updated;
    if (parsed.data.seat_quota !== undefined) updated = tenantsRepo.updateQuota(t.id, parsed.data.seat_quota) || updated;
    if (parsed.data.status !== undefined) updated = tenantsRepo.setStatus(t.id, parsed.data.status) || updated;
    if (parsed.data.notes !== undefined) updated = tenantsRepo.setNotes(t.id, parsed.data.notes) || updated;
    return res.json({ success: true, tenant: updated });
  } catch (err) {
    return handleRepoError(res, err);
  }
}

function deleteTenant(req, res) {
  try {
    const removed = tenantsRepo.deleteTenant(req.params.tenant_id);
    if (!removed) return res.status(404).json({ success: false, error: 'tenant_not_found' });
    return res.json({ success: true });
  } catch (err) {
    return handleRepoError(res, err);
  }
}

const createAdminSchema = z.object({
  username: USERNAME,
  password: PASSWORD,
  display_name: z.string().max(100).optional(),
  role: z.enum(['super', 'tenant_admin']).default('tenant_admin')
});

async function createTenantAdmin(req, res) {
  const parsed = createAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const t = tenantsRepo.getTenant(req.params.tenant_id);
  if (!t) return res.status(404).json({ success: false, error: 'tenant_not_found' });
  try {
    const a = await adminsRepo.createAdmin({
      tenant_id: t.id,
      username: parsed.data.username,
      password: parsed.data.password,
      display_name: parsed.data.display_name || null,
      role: 'tenant_admin'
    });
    return res.status(201).json({ success: true, admin: a });
  } catch (err) {
    return handleRepoError(res, err);
  }
}

const createSuperSchema = z.object({
  username: USERNAME,
  password: PASSWORD,
  display_name: z.string().max(100).optional()
});

async function createSuperAdmin(req, res) {
  const parsed = createSuperSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const a = await adminsRepo.createAdmin({
      tenant_id: null,
      username: parsed.data.username,
      password: parsed.data.password,
      display_name: parsed.data.display_name || null,
      role: 'super'
    });
    return res.status(201).json({ success: true, admin: a });
  } catch (err) {
    return handleRepoError(res, err);
  }
}

const adminPatchSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  display_name: z.string().max(100).nullable().optional(),
  password: PASSWORD.optional()
});

async function patchAdmin(req, res) {
  const parsed = adminPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const target = adminsRepo.getAdminById(req.params.admin_id);
  if (!target) return res.status(404).json({ success: false, error: 'admin_not_found' });
  try {
    let updated = target;
    if (parsed.data.status !== undefined) updated = adminsRepo.setStatus(target.id, parsed.data.status) || updated;
    if (parsed.data.display_name !== undefined) updated = adminsRepo.setDisplayName(target.id, parsed.data.display_name) || updated;
    if (parsed.data.password !== undefined) updated = (await adminsRepo.changePassword(target.id, parsed.data.password)) || updated;
    return res.json({ success: true, admin: updated });
  } catch (err) {
    return handleRepoError(res, err);
  }
}

function deleteAdmin(req, res) {
  const target = adminsRepo.getAdminById(req.params.admin_id);
  if (!target) return res.status(404).json({ success: false, error: 'admin_not_found' });
  if (target.id === req.session.admin.id) {
    return res.status(400).json({ success: false, error: 'cannot_delete_self' });
  }
  adminsRepo.deleteAdmin(target.id);
  return res.json({ success: true });
}

function listAdmins(req, res) {
  return res.json({ success: true, admins: adminsRepo.listAdmins() });
}

// ----- Super-side license CRUD (moved from tenant.js so customers can't
// self-extend their own license by 36 months) ---------------------------------

const createLicenseSchema = z.object({
  customer_name: z.string().min(1).max(100),
  months: z.number().int().min(1).max(36),
  seats: z.number().int().min(1).max(100).default(1),
  plan: z.string().max(32).optional(),
  notes: z.string().max(500).optional()
});

function createLicenseForTenant(req, res) {
  const parsed = createLicenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const tenant = tenantsRepo.getTenant(req.params.tenant_id);
  if (!tenant) {
    return res.status(404).json({ success: false, error: 'tenant_not_found' });
  }
  try {
    const lic = license.createLicense({
      tenant_id: tenant.id,
      customer_name: parsed.data.customer_name,
      months: parsed.data.months,
      seats: parsed.data.seats,
      plan: parsed.data.plan,
      notes: parsed.data.notes
    });
    return res.status(201).json({ success: true, license: lic });
  } catch (err) {
    if (err && err.name === 'LicenseError') {
      return res.status(400).json({ success: false, error: err.code, message: err.message });
    }
    throw err;
  }
}

const renewSchema = z.object({ months: z.number().int().min(1).max(36) });

function renewLicense(req, res) {
  const parsed = renewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const lic = license.getLicense(req.params.license_key);
  if (!lic) {
    return res.status(404).json({ success: false, error: 'license_not_found' });
  }
  const updated = license.renewLicense(lic.license_key, parsed.data.months);
  return res.json({ success: true, license: updated });
}

module.exports = {
  listTenants,
  createTenant,
  getTenantWithAdmins,
  updateTenant,
  deleteTenant,
  createTenantAdmin,
  createSuperAdmin,
  patchAdmin,
  deleteAdmin,
  listAdmins,
  createLicenseForTenant,
  renewLicense
};
