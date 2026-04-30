const { z } = require('zod');
const tenantsRepo = require('../repos/tenants');
const adminsRepo = require('../repos/admins');
const license = require('../license');
const departmentsRepo = require('../repos/departments');
const employeesRepo = require('../repos/employees');
const inviteCodesRepo = require('../repos/invite_codes');

function tenantOf(req) {
  return req.session.admin.tenant_id;
}

function adminIdOf(req) {
  return req.session.admin.id;
}

function handleLicenseError(res, err) {
  if (err && err.name === 'LicenseError') {
    return res.status(400).json({ success: false, error: err.code, message: err.message });
  }
  throw err;
}

function handleNamedError(res, err, ...allowedNames) {
  if (err && allowedNames.includes(err.name)) {
    return res.status(400).json({ success: false, error: err.code, message: err.message });
  }
  throw err;
}

function dashboard(req, res) {
  const tenant_id = tenantOf(req);
  const tenant = tenantsRepo.getTenant(tenant_id);
  if (!tenant) return res.status(404).json({ success: false, error: 'tenant_not_found' });
  const licenses = license.listLicensesByTenant(tenant_id);
  const seats_used = licenses
    .filter((l) => l.status === 'active')
    .reduce((sum, l) => sum + l.seats, 0);
  const active_seats = licenses.reduce((sum, l) => sum + (l.active_seats || 0), 0);
  return res.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      seat_quota: tenant.seat_quota,
      status: tenant.status,
      seats_used,
      seats_remaining: Math.max(0, tenant.seat_quota - seats_used),
      active_seats,
      license_count: licenses.length
    }
  });
}

function listLicenses(req, res) {
  return res.json({ success: true, licenses: license.listLicensesByTenant(tenantOf(req)) });
}

// License create + renew moved to super.js. Tenant admins can list/revoke/
// adjust seats/unbind machines but can't extend their own paid period —
// that comes from super on receipt of payment.

function ensureOwned(req, res) {
  const lic = license.getLicense(req.params.license_key);
  if (!lic || lic.tenant_id !== tenantOf(req)) {
    res.status(404).json({ success: false, error: 'license_not_found' });
    return null;
  }
  return lic;
}

function getLicenseDetail(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const seats = license.listSeats(lic.license_key);
  return res.json({ success: true, license: lic, seats });
}

// renewLicense moved to super.js for the same reason as createLicense.

function revokeLicense(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const updated = license.revokeLicense(lic.license_key);
  return res.json({ success: true, license: updated });
}

const updateSeatsSchema = z.object({ seats: z.number().int().min(1).max(100) });

function updateLicenseSeats(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const parsed = updateSeatsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  try {
    const updated = license.updateSeatsLimitWithQuota(lic.license_key, parsed.data.seats);
    return res.json({ success: true, license: updated });
  } catch (err) {
    return handleLicenseError(res, err);
  }
}

const unbindSchema = z.object({ fingerprint: z.string().min(8).optional() });

function unbindSeat(req, res) {
  const lic = ensureOwned(req, res);
  if (!lic) return;
  const parsed = unbindSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body' });
  }
  const result = license.unbindSeats(lic.license_key, parsed.data.fingerprint);
  return res.json({ success: true, changed: result?.changed ?? 0 });
}

function listSeats(req, res) {
  const tenant_id = tenantOf(req);
  const all = [];
  for (const lic of license.listLicensesByTenant(tenant_id)) {
    for (const seat of license.listSeats(lic.license_key)) {
      all.push({
        license_key: lic.license_key,
        customer_name: lic.customer_name,
        ...seat
      });
    }
  }
  return res.json({ success: true, seats: all });
}

// ----- Departments (admin side) ---------------------------------------------

const departmentCreateSchema = z.object({
  name: z.string().min(1).max(40),
  abbrev: z.string().min(2).max(8)
});

const departmentUpdateSchema = z
  .object({
    name: z.string().min(1).max(40).optional(),
    abbrev: z.string().min(2).max(8).optional(),
    status: z.enum(['active', 'archived']).optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

function ensureOwnedDepartment(req, res) {
  const dept = departmentsRepo.getDepartment(req.params.department_id);
  if (!dept || dept.tenant_id !== tenantOf(req)) {
    res.status(404).json({ success: false, error: 'department_not_found' });
    return null;
  }
  return dept;
}

function listDepartments(req, res) {
  return res.json({ success: true, departments: departmentsRepo.listDepartments(tenantOf(req)) });
}

function createDepartment(req, res) {
  const parsed = departmentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const dept = departmentsRepo.createDepartment({
      tenant_id: tenantOf(req),
      created_by: adminIdOf(req),
      ...parsed.data
    });
    return res.status(201).json({ success: true, department: dept });
  } catch (err) {
    return handleNamedError(res, err, 'DepartmentError');
  }
}

function updateDepartment(req, res) {
  const dept = ensureOwnedDepartment(req, res);
  if (!dept) return;
  const parsed = departmentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const updated = departmentsRepo.updateDepartment(dept.id, parsed.data);
    return res.json({ success: true, department: updated });
  } catch (err) {
    return handleNamedError(res, err, 'DepartmentError');
  }
}

function deleteDepartment(req, res) {
  const dept = ensureOwnedDepartment(req, res);
  if (!dept) return;
  try {
    departmentsRepo.deleteDepartment(dept.id);
    return res.json({ success: true });
  } catch (err) {
    return handleNamedError(res, err, 'DepartmentError');
  }
}

// ----- Employees (admin side) ----------------------------------------------

function ensureOwnedEmployee(req, res) {
  const emp = employeesRepo.getEmployee(req.params.employee_id);
  if (!emp || emp.tenant_id !== tenantOf(req)) {
    res.status(404).json({ success: false, error: 'employee_not_found' });
    return null;
  }
  return emp;
}

const inviteCreateSchema = z.object({
  department_id: z.string().min(1).max(64),
  raw_username: z.string().min(2).max(32),
  display_name: z.string().max(100).optional(),
  ttl_days: z.number().int().min(1).max(30).optional()
});

const employeeUpdateSchema = z
  .object({
    display_name: z.string().max(100).nullable().optional(),
    department_id: z.string().min(1).max(64).optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

function listEmployees(req, res) {
  return res.json({ success: true, employees: employeesRepo.listEmployees(tenantOf(req)) });
}

function createEmployee(req, res) {
  // Per §3.4-A, "create employee" actually creates a one-shot invite code.
  // The actual employee row is materialized on register.
  const parsed = inviteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  const dept = departmentsRepo.getDepartment(parsed.data.department_id);
  if (!dept || dept.tenant_id !== tenantOf(req)) {
    return res.status(404).json({ success: false, error: 'department_not_found' });
  }
  try {
    const code = inviteCodesRepo.createInviteCode({
      tenant_id: tenantOf(req),
      created_by: adminIdOf(req),
      ...parsed.data
    });
    return res.status(201).json({
      success: true,
      invite_code: code.code,
      expires_at: code.expires_at,
      department: { id: dept.id, name: dept.name, abbrev: dept.abbrev },
      raw_username: code.raw_username,
      preview_username: `${dept.abbrev}-${code.raw_username}`
    });
  } catch (err) {
    return handleNamedError(res, err, 'InviteCodeError');
  }
}

function updateEmployee(req, res) {
  const emp = ensureOwnedEmployee(req, res);
  if (!emp) return;
  const parsed = employeeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const updated = employeesRepo.updateEmployee(emp.id, parsed.data);
    return res.json({ success: true, employee: updated });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
}

function suspendEmployee(req, res) {
  const emp = ensureOwnedEmployee(req, res);
  if (!emp) return;
  try {
    const updated = employeesRepo.setStatus(emp.id, 'suspended');
    return res.json({ success: true, employee: updated });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
}

function reactivateEmployee(req, res) {
  const emp = ensureOwnedEmployee(req, res);
  if (!emp) return;
  try {
    const updated = employeesRepo.setStatus(emp.id, 'active');
    return res.json({ success: true, employee: updated });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
}

function unbindEmployeeMachine(req, res) {
  const emp = ensureOwnedEmployee(req, res);
  if (!emp) return;
  try {
    const updated = employeesRepo.unbindMachine(emp.id);
    return res.json({ success: true, employee: updated });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
}

function deleteEmployee(req, res) {
  const emp = ensureOwnedEmployee(req, res);
  if (!emp) return;
  try {
    employeesRepo.deleteEmployee(emp.id);
    return res.json({ success: true });
  } catch (err) {
    return handleNamedError(res, err, 'EmployeeError');
  }
}

// ----- Invite codes (admin side) -------------------------------------------

function listInviteCodes(req, res) {
  return res.json({ success: true, invite_codes: inviteCodesRepo.listByTenant(tenantOf(req)) });
}

function revokeInviteCode(req, res) {
  try {
    const result = inviteCodesRepo.revokeInviteCode(req.params.code, tenantOf(req));
    if (!result) {
      return res.status(404).json({ success: false, error: 'invite_not_found' });
    }
    return res.json({ success: true, invite_code: result });
  } catch (err) {
    return handleNamedError(res, err, 'InviteCodeError');
  }
}

module.exports = {
  dashboard,
  listLicenses,
  getLicenseDetail,
  revokeLicense,
  updateLicenseSeats,
  unbindSeat,
  listSeats,

  // departments
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,

  // employees
  listEmployees,
  createEmployee,
  updateEmployee,
  suspendEmployee,
  reactivateEmployee,
  unbindEmployeeMachine,
  deleteEmployee,

  // invite codes
  listInviteCodes,
  revokeInviteCode
};
