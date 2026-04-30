const { readCookie, verifySession } = require('./session');
const adminsRepo = require('../repos/admins');
const tenantsRepo = require('../repos/tenants');

function loadSession(req) {
  const token = readCookie(req);
  if (!token) return null;
  const claims = verifySession(token);
  if (!claims) return null;
  const admin = adminsRepo.getAdminById(claims.sub);
  if (!admin || admin.status !== 'active') return null;
  let tenant = null;
  if (admin.tenant_id) {
    tenant = tenantsRepo.getTenant(admin.tenant_id);
    if (!tenant || tenant.status !== 'active') {
      return { admin, claims, tenant, tenantSuspended: true };
    }
  }
  return { admin, claims, tenant };
}

function requireAuth(req, res, next) {
  const session = loadSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'unauthenticated' });
  }
  if (session.tenantSuspended) {
    return res.status(403).json({ success: false, error: 'tenant_suspended' });
  }
  req.session = session;
  next();
}

function requireSuper(req, res, next) {
  const session = loadSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'unauthenticated' });
  }
  if (session.admin.role !== 'super') {
    return res.status(403).json({ success: false, error: 'forbidden_super_only' });
  }
  req.session = session;
  next();
}

function requireTenantAdmin(req, res, next) {
  const session = loadSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'unauthenticated' });
  }
  if (session.admin.role !== 'tenant_admin') {
    return res.status(403).json({ success: false, error: 'forbidden_tenant_admin_only' });
  }
  if (!session.admin.tenant_id) {
    return res.status(403).json({ success: false, error: 'tenant_admin_missing_tenant' });
  }
  if (session.tenantSuspended || !session.tenant) {
    return res.status(403).json({ success: false, error: 'tenant_suspended' });
  }
  req.session = session;
  next();
}

module.exports = { loadSession, requireAuth, requireSuper, requireTenantAdmin };
