require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const tenants = require('../src/repos/tenants');
const admins = require('../src/repos/admins');
const departments = require('../src/repos/departments');
const employees = require('../src/repos/employees');
const inviteCodes = require('../src/repos/invite_codes');
const license = require('../src/license');

(async () => {
  const t = tenants.createTenant({ name: '示例科技', slug: 'demo', seat_quota: 50 });
  const a = await admins.createAdmin({ tenant_id: t.id, username: 'admin', password: 'admin1234', role: 'tenant_admin', display_name: '管理员' });
  const d1 = departments.createDepartment({ tenant_id: t.id, name: '研发部', abbrev: 'dev', created_by: a.id });
  const d2 = departments.createDepartment({ tenant_id: t.id, name: '市场部', abbrev: 'mkt', created_by: a.id });
  const d3 = departments.createDepartment({ tenant_id: t.id, name: '设计部', abbrev: 'design', created_by: a.id });
  departments.updateDepartment(d3.id, { status: 'archived' });

  const e1 = await employees.createEmployee({
    tenant_id: t.id, department_id: d1.id, raw_username: 'zhangsan',
    password: 'zhang1234', machine_fingerprint: 'fp-zhang-aaaa-bbbb-cccc-dddd', display_name: '张三', created_by: a.id
  });
  const e2 = await employees.createEmployee({
    tenant_id: t.id, department_id: d1.id, raw_username: 'lisi',
    password: 'lisi1234', machine_fingerprint: 'fp-lisi-aaaa-bbbb-cccc-eeee', display_name: '李四', created_by: a.id
  });
  employees.setStatus(e2.id, 'suspended');
  await employees.createEmployee({
    tenant_id: t.id, department_id: d2.id, raw_username: 'wangwu',
    password: 'wangwu1234', machine_fingerprint: 'fp-wangwu-aaaa-bbbb-cccc-ffff', display_name: '王五', created_by: a.id
  });

  inviteCodes.createInviteCode({ tenant_id: t.id, department_id: d1.id, raw_username: 'newhire1', created_by: a.id });
  const inv2 = inviteCodes.createInviteCode({ tenant_id: t.id, department_id: d2.id, raw_username: 'newhire2', created_by: a.id });
  inviteCodes.revokeInviteCode(inv2.code, t.id);

  const lic1 = license.createLicense({ tenant_id: t.id, customer_name: '张三 (研发)', months: 6, seats: 1 });
  license.createLicense({ tenant_id: t.id, customer_name: '李四 (研发)', months: 12, seats: 1 });
  console.log('seeded:');
  console.log('  tenant:', t.id, t.name);
  console.log('  admin login: admin / admin1234');
  console.log('  license:', lic1.license_key);
})();
