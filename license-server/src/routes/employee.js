const { z } = require('zod');
const tenantsRepo = require('../repos/tenants');
const departmentsRepo = require('../repos/departments');
const employeesRepo = require('../repos/employees');
const inviteCodesRepo = require('../repos/invite_codes');
const { signEmployeeToken, verifyEmployeeToken } = require('../auth/employee_jwt');

function badError(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: code, message });
}

function handleNamedError(res, err, ...allowedNames) {
  if (err && allowedNames.includes(err.name)) {
    return badError(res, err.code, err.message);
  }
  throw err;
}

// ----- Schemas --------------------------------------------------------------

const FP_RE = /^[A-Za-z0-9_-]{8,128}$/;

const registerSchema = z.object({
  tenant_id: z.string().min(1).max(64),
  invite_code: z.string().min(4).max(16),
  password: z.string().min(8).max(200),
  machine_fingerprint: z.string().regex(FP_RE),
  display_name: z.string().max(100).optional()
});

const loginSchema = z.object({
  tenant_id: z.string().min(1).max(64),
  username: z.string().min(3).max(64),
  password: z.string().min(1).max(200),
  machine_fingerprint: z.string().regex(FP_RE)
});

const changePasswordSchema = z.object({
  old_password: z.string().min(1).max(200),
  new_password: z.string().min(8).max(200)
});

const refreshSchema = z.object({
  machine_fingerprint: z.string().regex(FP_RE)
});

// ----- Helpers --------------------------------------------------------------

function ensureTenantActive(tenant_id, res) {
  const tenant = tenantsRepo.getTenant(tenant_id);
  if (!tenant) {
    badError(res, 'tenant_not_found', 'unknown tenant_id', 404);
    return null;
  }
  if (tenant.status !== 'active') {
    badError(res, 'tenant_suspended', `tenant is ${tenant.status}`, 403);
    return null;
  }
  return tenant;
}

function readBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim();
}

// ----- Middleware -----------------------------------------------------------

function requireEmployee(req, res, next) {
  const token = readBearer(req);
  if (!token) return badError(res, 'unauthenticated', 'missing bearer token', 401);
  let claims;
  try {
    claims = verifyEmployeeToken(token);
  } catch (err) {
    return badError(res, 'invalid_token', err.message || 'token verification failed', 401);
  }
  const emp = employeesRepo.getEmployee(claims.sub);
  if (!emp || emp.tenant_id !== claims.tenant_id) {
    return badError(res, 'employee_not_found', 'employee no longer exists', 401);
  }
  if (emp.status !== 'active') {
    return badError(res, 'employee_inactive', `account is ${emp.status}`, 403);
  }
  if (!emp.machine_fingerprint || emp.machine_fingerprint !== claims.fp) {
    return badError(res, 'fingerprint_drift', 'machine binding has changed; please re-login', 401);
  }
  const tenant = tenantsRepo.getTenant(emp.tenant_id);
  if (!tenant || tenant.status !== 'active') {
    return badError(res, 'tenant_suspended', 'tenant is suspended', 403);
  }
  req.employee = emp;
  req.tenant = tenant;
  req.tokenClaims = claims;
  next();
}

// ----- Handlers -------------------------------------------------------------

async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return badError(res, 'invalid_body', JSON.stringify(parsed.error.issues));
  }
  const tenant = ensureTenantActive(parsed.data.tenant_id, res);
  if (!tenant) return;
  let invite;
  try {
    invite = inviteCodesRepo.getByCode(parsed.data.invite_code);
  } catch {
    return badError(res, 'invite_not_found', 'invite code not recognized', 404);
  }
  if (!invite || invite.tenant_id !== tenant.id) {
    return badError(res, 'invite_not_found', 'invite code not recognized', 404);
  }
  if (invite.used_at) return badError(res, 'invite_already_used', 'invite code already used');
  if (Date.parse(invite.expires_at) < Date.now()) {
    return badError(res, 'invite_expired', 'invite code has expired');
  }
  const dept = departmentsRepo.getDepartment(invite.department_id);
  if (!dept || dept.status !== 'active') {
    return badError(res, 'department_unavailable', 'department is not available');
  }
  let employee;
  try {
    employee = await employeesRepo.createEmployee({
      tenant_id: tenant.id,
      department_id: dept.id,
      raw_username: invite.raw_username,
      password: parsed.data.password,
      machine_fingerprint: parsed.data.machine_fingerprint,
      display_name: parsed.data.display_name ?? invite.display_name ?? null,
      created_by: invite.created_by
    });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
  try {
    inviteCodesRepo.consumeInviteCode(invite.code, tenant.id, employee.id);
  } catch (err) {
    // Roll back the employee row if invite consume races; same code can't be
    // double-spent. Treat as a client-visible error.
    employeesRepo.deleteEmployee(employee.id);
    return handleNamedError(res, err, 'InviteCodeError');
  }
  const { token, expires_at } = signEmployeeToken({
    employee_id: employee.id,
    tenant_id: tenant.id,
    machine_fingerprint: employee.machine_fingerprint
  });
  return res.status(201).json({
    success: true,
    employee_id: employee.id,
    username: employee.username,
    department: { id: dept.id, name: dept.name, abbrev: dept.abbrev },
    jwt: token,
    expires_at
  });
}

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return badError(res, 'invalid_body', JSON.stringify(parsed.error.issues));
  }
  const tenant = ensureTenantActive(parsed.data.tenant_id, res);
  if (!tenant) return;
  let emp;
  try {
    emp = await employeesRepo.authenticate(
      tenant.id,
      parsed.data.username,
      parsed.data.password,
      parsed.data.machine_fingerprint
    );
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
  const { token, expires_at } = signEmployeeToken({
    employee_id: emp.id,
    tenant_id: tenant.id,
    machine_fingerprint: emp.machine_fingerprint
  });
  return res.json({
    success: true,
    employee_id: emp.id,
    username: emp.username,
    jwt: token,
    expires_at
  });
}

function me(req, res) {
  const dept = departmentsRepo.getDepartment(req.employee.department_id);
  return res.json({
    success: true,
    employee: req.employee,
    department: dept ? { id: dept.id, name: dept.name, abbrev: dept.abbrev } : null,
    tenant: { id: req.tenant.id, name: req.tenant.name, slug: req.tenant.slug }
  });
}

function refresh(req, res) {
  const parsed = refreshSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badError(res, 'invalid_body', JSON.stringify(parsed.error.issues));
  }
  if (parsed.data.machine_fingerprint !== req.employee.machine_fingerprint) {
    return badError(res, 'fingerprint_mismatch', 'machine binding has changed; please re-login', 401);
  }
  const { token, expires_at } = signEmployeeToken({
    employee_id: req.employee.id,
    tenant_id: req.employee.tenant_id,
    machine_fingerprint: req.employee.machine_fingerprint
  });
  return res.json({ success: true, jwt: token, expires_at });
}

async function changePassword(req, res) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return badError(res, 'invalid_body', JSON.stringify(parsed.error.issues));
  }
  try {
    await employeesRepo.changePassword(
      req.employee.id,
      parsed.data.old_password,
      parsed.data.new_password
    );
    return res.json({ success: true });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
}

function logout(req, res) {
  // Stateless JWT — server has no token store. Clients drop the JWT.
  // Future: add a jti blacklist if/when "immediate kick" is needed beyond
  // setStatus(suspended), which already blocks /me + /refresh on next call.
  return res.json({ success: true });
}

module.exports = {
  requireEmployee,
  register,
  login,
  me,
  refresh,
  changePassword,
  logout
};
