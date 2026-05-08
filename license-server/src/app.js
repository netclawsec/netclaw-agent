require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');

const { logger } = require('./logger');
const activate = require('./routes/activate');
const verify = require('./routes/verify');
const deactivate = require('./routes/deactivate');
const admin = require('./routes/admin');
const adminAuth = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const superRoutes = require('./routes/super');
const tenantRoutes = require('./routes/tenant');
const { requireAuth, requireSuper, requireTenantAdmin } = require('./auth/middleware');
const { csrfOriginGuard } = require('./auth/csrf');
const asyncHandler = require('./utils/asyncHandler');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - t0,
      ip: req.ip
    }, 'request');
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'netclaw-license', ts: new Date().toISOString() });
});

const activateLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const verifyLimiter   = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

app.post('/api/license/activate',   activateLimiter, activate);
app.post('/api/license/verify',     verifyLimiter,   verify);
app.post('/api/license/deactivate', verifyLimiter,   deactivate);
app.post('/api/admin/licenses',     adminAuth,       admin);

// Public agent-version-check (no auth — every installed client can ask
// "what's latest?" — the actual download still requires the tenant-specific
// signed URL the response carries).
const agentVersionsRoutes = require('./routes/agent_versions');
const staticBundlesRoutes = require('./routes/static_bundles');
const downloadsRoutes = require('./routes/downloads');
const versionCheckLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const readLimiter = versionCheckLimiter;
app.get('/api/agent/version-check', versionCheckLimiter, agentVersionsRoutes.check);
app.get('/api/agent/static-bundle-check', readLimiter, staticBundlesRoutes.check);

// Employee-side API (Bearer JWT auth; no cookies; rate-limited per IP).
const employeeRoutes = require('./routes/employee');
const employeeLoginLimiter    = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const employeeRegisterLimiter = rateLimit({ windowMs: 60_000, limit: 5,  standardHeaders: true, legacyHeaders: false });
const employeeReadLimiter     = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

app.get ('/api/employee/tenant-by-invite', employeeReadLimiter,     employeeRoutes.tenantByInvite);
app.post('/api/employee/register',         employeeRegisterLimiter, asyncHandler(employeeRoutes.register));
app.post('/api/employee/login',            employeeLoginLimiter,    asyncHandler(employeeRoutes.login));
app.get ('/api/employee/me',               employeeReadLimiter,     employeeRoutes.requireEmployee, employeeRoutes.me);
app.post('/api/employee/refresh',          employeeReadLimiter,     employeeRoutes.requireEmployee, employeeRoutes.refresh);
app.post('/api/employee/change-password',  employeeLoginLimiter,    employeeRoutes.requireEmployee, asyncHandler(employeeRoutes.changePassword));
app.post('/api/employee/logout',           employeeReadLimiter,     employeeRoutes.requireEmployee, employeeRoutes.logout);

const cookieAuthRouter = express.Router();
cookieAuthRouter.use(csrfOriginGuard);

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

cookieAuthRouter.post('/auth/login',           loginLimiter,                asyncHandler(authRoutes.login));
cookieAuthRouter.post('/auth/logout',          authRoutes.logout);
cookieAuthRouter.get ('/auth/me',              requireAuth,                 authRoutes.me);
cookieAuthRouter.post('/auth/change-password', requireAuth,                 asyncHandler(authRoutes.changePassword));

cookieAuthRouter.get   ('/super/tenants',                       requireSuper, superRoutes.listTenants);
cookieAuthRouter.post  ('/super/tenants',                       requireSuper, asyncHandler(superRoutes.createTenant));
cookieAuthRouter.get   ('/super/tenants/:tenant_id',            requireSuper, superRoutes.getTenantWithAdmins);
cookieAuthRouter.patch ('/super/tenants/:tenant_id',            requireSuper, superRoutes.updateTenant);
cookieAuthRouter.delete('/super/tenants/:tenant_id',            requireSuper, superRoutes.deleteTenant);
cookieAuthRouter.post  ('/super/tenants/:tenant_id/admins',     requireSuper, asyncHandler(superRoutes.createTenantAdmin));
cookieAuthRouter.post  ('/super/tenants/:tenant_id/licenses',   requireSuper, superRoutes.createLicenseForTenant);
cookieAuthRouter.post  ('/super/licenses/:license_key/renew',   requireSuper, superRoutes.renewLicense);
cookieAuthRouter.get   ('/super/admins',                        requireSuper, superRoutes.listAdmins);
cookieAuthRouter.post  ('/super/admins',                        requireSuper, asyncHandler(superRoutes.createSuperAdmin));
cookieAuthRouter.patch ('/super/admins/:admin_id',              requireSuper, asyncHandler(superRoutes.patchAdmin));
cookieAuthRouter.delete('/super/admins/:admin_id',              requireSuper, superRoutes.deleteAdmin);

// Super-side agent version publish (one entry per shipped build)
cookieAuthRouter.get   ('/super/agent/versions',                requireSuper, agentVersionsRoutes.listAll);
cookieAuthRouter.post  ('/super/agent/versions',                requireSuper, agentVersionsRoutes.publish);
cookieAuthRouter.delete('/super/agent/versions/:version',       requireSuper, agentVersionsRoutes.deleteOne);

cookieAuthRouter.post  ('/super/static-bundles',                requireSuper, asyncHandler(staticBundlesRoutes.publish));
cookieAuthRouter.get   ('/super/static-bundles',                requireSuper, staticBundlesRoutes.listAll);
cookieAuthRouter.delete('/super/static-bundles/:version',       requireSuper, staticBundlesRoutes.retract);

cookieAuthRouter.get   ('/tenant/dashboard',                              requireTenantAdmin, tenantRoutes.dashboard);
cookieAuthRouter.get   ('/tenant/licenses',                               requireTenantAdmin, tenantRoutes.listLicenses);
cookieAuthRouter.get   ('/tenant/licenses/:license_key',                  requireTenantAdmin, tenantRoutes.getLicenseDetail);
cookieAuthRouter.post  ('/tenant/licenses/:license_key/revoke',           requireTenantAdmin, tenantRoutes.revokeLicense);
cookieAuthRouter.patch ('/tenant/licenses/:license_key/seats',            requireTenantAdmin, tenantRoutes.updateLicenseSeats);
cookieAuthRouter.post  ('/tenant/licenses/:license_key/unbind',           requireTenantAdmin, tenantRoutes.unbindSeat);
cookieAuthRouter.get   ('/tenant/seats',                                  requireTenantAdmin, tenantRoutes.listSeats);

// Departments (admin-side)
cookieAuthRouter.get   ('/tenant/departments',                            requireTenantAdmin, tenantRoutes.listDepartments);
cookieAuthRouter.post  ('/tenant/departments',                            requireTenantAdmin, tenantRoutes.createDepartment);
cookieAuthRouter.patch ('/tenant/departments/:department_id',             requireTenantAdmin, tenantRoutes.updateDepartment);
cookieAuthRouter.delete('/tenant/departments/:department_id',             requireTenantAdmin, tenantRoutes.deleteDepartment);

// Employees (admin-side; "create employee" issues an invite code per §3.4-A)
cookieAuthRouter.get   ('/tenant/employees',                              requireTenantAdmin, tenantRoutes.listEmployees);
cookieAuthRouter.post  ('/tenant/employees',                              requireTenantAdmin, asyncHandler(tenantRoutes.createEmployee));
cookieAuthRouter.patch ('/tenant/employees/:employee_id',                 requireTenantAdmin, tenantRoutes.updateEmployee);
cookieAuthRouter.post  ('/tenant/employees/:employee_id/suspend',         requireTenantAdmin, tenantRoutes.suspendEmployee);
cookieAuthRouter.post  ('/tenant/employees/:employee_id/reactivate',      requireTenantAdmin, tenantRoutes.reactivateEmployee);
cookieAuthRouter.post  ('/tenant/employees/:employee_id/unbind',          requireTenantAdmin, tenantRoutes.unbindEmployeeMachine);
cookieAuthRouter.delete('/tenant/employees/:employee_id',                 requireTenantAdmin, tenantRoutes.deleteEmployee);

// Invite codes (admin-side)
cookieAuthRouter.get   ('/tenant/invite-codes',                           requireTenantAdmin, tenantRoutes.listInviteCodes);
cookieAuthRouter.post  ('/tenant/invite-codes/:code/revoke',              requireTenantAdmin, tenantRoutes.revokeInviteCode);

// Per-company installer build queue (admin-side)
const installerRoutes = require('./routes/installer');
cookieAuthRouter.post  ('/tenant/installer/builds',                       requireTenantAdmin, asyncHandler(installerRoutes.createBuild));
cookieAuthRouter.get   ('/tenant/installer/builds',                       requireTenantAdmin, installerRoutes.listBuilds);
cookieAuthRouter.get   ('/tenant/installer/builds/:build_id',             requireTenantAdmin, installerRoutes.getBuild);

// Internal build-worker routes — MUST be registered BEFORE the
// `app.use('/api', cookieAuthRouter)` mount below, otherwise mutating
// methods (POST/PATCH) get rejected by csrfOriginGuard which runs on
// every /api/* request before path-matching falls through to here.
const internalRoutes = require('./routes/internal');
const { requireBuildWorker } = require('./auth/worker');
const workerLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
app.get ('/api/internal/build-queue',                  workerLimiter, requireBuildWorker, internalRoutes.claimNext);
app.post('/api/internal/build-queue/:build_id/upload', workerLimiter, requireBuildWorker, internalRoutes.uploadResult);
app.post('/api/internal/build-queue/:build_id/fail',   workerLimiter, requireBuildWorker, internalRoutes.failBuild);
app.post('/api/internal/build-queue/reap',             workerLimiter, requireBuildWorker, internalRoutes.reapStale);

app.use('/api', cookieAuthRouter);

app.get('/downloads/installer-universal-latest', downloadsRoutes.latestInstaller);
app.get('/downloads/installer-universal/:version', downloadsRoutes.versionedInstaller);
app.get('/downloads/installer-mac-latest',         downloadsRoutes.latestDmg);
app.get('/downloads/installer-mac/:version',       downloadsRoutes.versionedDmg);
app.get('/downloads/static-bundle/:version', readLimiter, staticBundlesRoutes.download);

// Admin surfaces: same static directory served under two paths.
// - /admin/* — 企业管理员入口 (login.html shows License Key field)
// - /super/* — 超级管理员入口 (login.html hides License Key field by JS path
//   detection). Both paths serve the same files; the JS in login.html
//   branches based on location.pathname.
const path = require('node:path');
const _adminDir = path.join(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(_adminDir, { index: 'login.html', extensions: ['html'] }));
app.use('/super', express.static(_adminDir, { index: 'login.html', extensions: ['html'] }));
app.get('/admin', (req, res) => res.redirect('/admin/login.html'));
app.get('/super', (req, res) => res.redirect('/super/login.html'));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal_error' });
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, 'netclaw-license listening');
});
