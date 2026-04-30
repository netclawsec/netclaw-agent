const { z } = require('zod');
const adminsRepo = require('../repos/admins');
const tenantsRepo = require('../repos/tenants');
const { signSession, setSessionCookie, clearSessionCookie } = require('../auth/session');

function isSecure() {
  const explicit = process.env.SESSION_COOKIE_SECURE;
  if (explicit !== undefined) return explicit.toLowerCase() === 'true';
  return process.env.NODE_ENV === 'production';
}

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200)
});

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  const { username, password } = parsed.data;
  const admin = await adminsRepo.authenticate(username, password);
  if (!admin) {
    return res.status(401).json({ success: false, error: 'invalid_credentials' });
  }
  if (admin.role === 'tenant_admin') {
    const tenant = tenantsRepo.getTenant(admin.tenant_id);
    if (!tenant || tenant.status !== 'active') {
      return res.status(403).json({ success: false, error: 'tenant_suspended' });
    }
  }
  const token = signSession({
    admin_id: admin.id,
    role: admin.role,
    tenant_id: admin.tenant_id,
    username: admin.username
  });
  setSessionCookie(res, token, { secure: isSecure() });
  return res.json({
    success: true,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tenant_id: admin.tenant_id,
      display_name: admin.display_name
    }
  });
}

function logout(req, res) {
  clearSessionCookie(res, { secure: isSecure() });
  return res.json({ success: true });
}

function me(req, res) {
  const { admin } = req.session;
  let tenant = null;
  if (admin.tenant_id) {
    tenant = tenantsRepo.getTenant(admin.tenant_id);
  }
  return res.json({
    success: true,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tenant_id: admin.tenant_id,
      display_name: admin.display_name,
      last_login_at: admin.last_login_at
    },
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, slug: tenant.slug, seat_quota: tenant.seat_quota, status: tenant.status }
      : null
  });
}

const changePasswordSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(8).max(200)
});

async function changePassword(req, res) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  const { old_password, new_password } = parsed.data;
  const admin = req.session.admin;
  const verified = await adminsRepo.authenticate(admin.username, old_password);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'old_password_wrong' });
  }
  await adminsRepo.changePassword(admin.id, new_password);
  return res.json({ success: true });
}

module.exports = { login, logout, me, changePassword };
