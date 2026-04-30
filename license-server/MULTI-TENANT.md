# 多租户后台使用说明

## 入口

http://120.55.247.72/admin/login.html （备案后切 `https://license.netclawsec.com.cn/admin/login.html`）

## 角色

- **超管（你）** — 管理"客户公司"（租户）和它们的 quota、暂停/恢复某公司
- **公司管理员（业务部主管）** — 管理本公司员工的 license key

## 你（超管）的流程

1. 登录 → 自动进入 `/admin/super.html`
2. 点 **"+ 新建客户公司"**
   - 公司名（中文）：例 `北京东方童`
   - slug：英文短码，3-32 字符，可含 `-`，唯一，例 `dongfangtong`
   - 座位数：这家公司一共能给多少员工开 license
3. 创建后在 **"管理"** 弹窗里点 **"添加管理员"**
   - 用户名 / 初始密码（≥8 位）/ 显示名（如"王经理"）
4. 把 URL + 用户名 + 初始密码三件套发给客户业务主管
5. 之后这家公司的所有员工开通由他们自己负责，你不再操心

要暂停某家公司？列表里点 **"暂停"** — 该公司所有员工的 NetClaw Agent 当下次心跳就会失败。要恢复？再点一下。

要调整座位上限？**"管理"** 弹窗里改"座位 quota"。

## 公司管理员的流程

1. 登录 → 自动进入 `/admin/tenant.html`
2. 顶部仪表盘看 **座位用量 / 剩余座位 / License 数 / 在线激活数**
3. 点 **"+ 为员工生成 License"**
   - 备注：填员工姓名 / 部门，方便区分（你能看到，员工看不到）
   - 有效期：1/3/6/12/24 个月
   - 座位数：通常 1（一人一座）
4. 生成后弹 NCLW-XXX key，**点"复制并关闭"**，把 key 发给员工
5. 员工在自己电脑装 NetClaw Agent，首次启动粘贴 key → 激活成功
6. 想看某 license 谁用了？**"查看激活"** 列出所有绑定机器（主机名/系统/最近验证时间）
7. 员工离职？点对应 seat 的 **"解绑"**（释放座位但不吊销 key），或对整张 license 点 **"吊销"**
8. License 快过期？**"续期"**

## API 速查（cookie 认证 + CSRF Origin guard）

```
POST /api/auth/login                                {username, password}
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/change-password                      {old_password, new_password}

# 超管
GET    /api/super/tenants
POST   /api/super/tenants                           {name, slug, seat_quota, notes?}
GET    /api/super/tenants/:tenant_id                → 含 admins + licenses
PATCH  /api/super/tenants/:tenant_id                {name?, seat_quota?, status?, notes?}
DELETE /api/super/tenants/:tenant_id                (有 license 时返回 400 tenant_has_licenses)
POST   /api/super/tenants/:tenant_id/admins         {username, password, display_name?}

# 公司管理员
GET   /api/tenant/dashboard
GET   /api/tenant/licenses
POST  /api/tenant/licenses                          {customer_name, months, seats?, plan?}
GET   /api/tenant/licenses/:license_key             → 含 seats
POST  /api/tenant/licenses/:license_key/renew       {months}
POST  /api/tenant/licenses/:license_key/revoke
PATCH /api/tenant/licenses/:license_key/seats       {seats}
POST  /api/tenant/licenses/:license_key/unbind      {fingerprint?}  // 不带 fp 则解绑全部
GET   /api/tenant/seats                             → 跨 license 的员工目录
```

CSRF：所有非 GET/HEAD 调用必须带 `Origin: http://120.55.247.72`（或 `ALLOWED_ORIGINS` 列出的 host）。

## 运维

```bash
# 跑全套测试
npm test

# 部署到 ECS（用 aliyun cli 走 Cloud Assistant，不需要 SSH）
# 见 memory: facts/netclaw-license-server.md

# 查看日志
ssh root@120.55.247.72 'pm2 logs netclaw-license --lines 50 --nostream'

# DB 备份
ssh root@120.55.247.72 'cp /opt/netclaw-license-server/data/netclaw-license.db /opt/netclaw-license-server/backups/netclaw-license-$(date +%Y%m%d-%H%M%S).db'

# 创建额外超管（命令行）
node scripts/bootstrap-super-admin.js
```

## 数据库迁移

新表：`tenants`、`tenant_admins`、`schema_version`；`licenses` 加 `tenant_id` 列。

存量 license（多租户改造前的）自动归入 `id='default'` 的"默认租户"（quota 9999），不影响现有 NCLW key 和员工激活。

迁移幂等，重复启动不会出错。schema_version 表跟踪已应用版本号。
