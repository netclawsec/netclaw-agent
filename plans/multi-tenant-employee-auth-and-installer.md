# 多租户员工账号 + per-company installer + WebUI 响应式重构

**作者**: crawford / Claude
**日期**: 2026-04-30
**状态**: Draft, 等待评审

---

## 1. 目标

让 NetClaw Agent 从"单机激活码工具"演进到"多租户企业 SaaS"形态：

1. **per-company installer** — 每个客户公司一个专属安装包，预置 tenant 信息 + 部门列表 + license server URL，员工拿到包就只对应自己公司
2. **员工账号体系** — 员工首次启动时自助注册（部门下拉 + 用户名 + 密码），未登录不能用客户端
3. **双重门禁** — 公司级 NCLW license（到期=全公司软件失效）+ 员工级账号（未登录=该员工无法使用）
4. **1:1 机器绑定** — 一员工绑一台机器
5. **WebUI 响应式重构** — 默认最大化 + 大窗口下卡片合理拉伸 + 字体缩放友好

---

## 2. 锁定的产品决策（用户已确认）

| 维度 | 决策 |
|---|---|
| 部门结构 | 扁平（不嵌套），字段：中文名 + 英文缩写 |
| 员工激活 | 第一次启动**自助注册**，username 服务端改写为 `<dept-abbrev>-<username>` |
| License vs Account | **正交**：license 控公司软件可用性，account 控个人登录 |
| 机器绑定 | 1 员工 ↔ 1 机器（首次注册即绑） |
| 离职 | tenant admin 删账号 → 解绑 + 座位回收 |
| 部门维护 | tenant admin 自助管理（不是超管管） |
| 老租户 | `default` 和 `mvp-mac-test` 删除，全新开始 |

---

## 3. 待最终确认的小决策

> **请评审 → 确认 → 锁定**

### 3.1 NCLW license key 跟 tenant 的关系
- **A（推荐）**: 一个 tenant 一个 NCLW key，作为"公司级总开关"。到期=该公司全员软件失效。
- B: 多个 NCLW key（按部门 / 按批次发）。

### 3.2 License server 地址
- **A（推荐）**: bundle.json 写 `https://license.netclawsec.com.cn`，DNS 临时指向 120.55.247.72。备案下来切到正式 IP/CNAME，老 installer 不失效。
- B: 直接写 IP `http://120.55.247.72`。备案后老 installer 永久指错。

### 3.3 username 唯一性范围
- **A（推荐）**: tenant 内唯一（同一公司里 `dev-zhangsan` 唯一；不同公司可同名）。
- B: 全平台唯一（运维简单，但客户公司间撞名）。

### 3.4 员工注册要不要 invite code
- **A（推荐）**: 要。tenant admin 在 `/admin/tenant.html` 点"加员工" → 生成 6-8 位一次性 invite code → 发给员工 → 员工注册时填。防陌生人猜到 server + tenant_id 后乱注册。
- B: 不要。靠 license seat quota 兜底，谁先注册谁占座。

### 3.5 密码强度策略
- **A（推荐）**: ≥ 8 位，至少含字母 + 数字。
- B: ≥ 6 位，无复杂度要求。

### 3.6 离职是否区分"删除 vs 禁用"
- **A（推荐）**: tenant admin 有两个动作：禁用（保留账号但不能登录，机器解绑，座位回收）+ 删除（彻底清账号）。审计友好。
- B: 只有删除。简单粗暴。

### 3.7 一台机器若卡死要不要支持"换机"
- **A（推荐）**: tenant admin 可手动 unbind 某员工的当前机器 → 员工可在新机器重新注册（用回原 username + 老密码 OR 走"忘记密码"流程）。
- B: 不支持，员工的机器丢了就只能 tenant admin 删账号重建。

### 3.8 build 流水线
- **阶段 1（推荐）**: 半自动 — tenant admin 点"生成安装包" → 服务端记请求 → 你 macOS 上 Parallels VM 跑 build → 上传 OSS → URL 给 tenant admin
- **阶段 2（理想态）**: GH Actions Windows runner 自动跑 build_dispatch
- 这次先实现阶段 1，预留 hook 后期换成阶段 2

---

## 4. 总体架构

```
┌──────────────────── License Server (120.55.247.72) ─────────────────────┐
│                                                                          │
│  super_admin ── tenant ── tenant_admin                                  │
│                    │                                                     │
│                    ├── licenses (NCLW-XXXXX-...)  ── seats (machines)   │
│                    ├── departments (NEW)                                │
│                    └── tenant_employees (NEW)                           │
│                          └── invite_codes (NEW, optional)               │
│                                                                          │
│  /admin/super.html       — you (super) 建公司、给 quota                  │
│  /admin/tenant.html      — tenant admin 管部门 / 员工 / installer        │
│  /api/employee/*         — agent 客户端调，员工注册/登录/改密            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ HTTPS
                                   │
┌──────────────── Per-Company Installer (built per tenant) ───────────────┐
│                                                                          │
│  NetClaw-Agent-Setup-<tenant-slug>-<ver>.exe                             │
│       └─ NetClaw Agent.exe + bundle.json                                 │
│           bundle.json:                                                   │
│             tenant_id: "abc-123"                                         │
│             tenant_slug: "acme"                                          │
│             tenant_name: "Acme 软件"                                     │
│             license_server: "https://license.netclawsec.com.cn"          │
│             departments: [                                               │
│               {name:"研发部", abbrev:"dev"},                             │
│               {name:"市场部", abbrev:"mkt"}                              │
│             ]                                                            │
│             require_invite_code: true                                    │
│                                                                          │
│  首次启动 → 注册/登录 wizard 读 bundle.json → 接 license_server         │
│           → 注册成功后落 ~/.netclaw/auth.json (machine binding + JWT)   │
│  后续启动 → 用 auth.json 静默续期 JWT → 进 WebUI                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 数据模型（License Server 端）

### 5.1 新增表

```sql
-- 部门（扁平，每个 tenant 自治）
CREATE TABLE departments (
  id            TEXT PRIMARY KEY,           -- uuid
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,              -- "研发部"
  abbrev        TEXT NOT NULL,              -- "dev"，[a-z0-9]{2,8}
  status        TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at    INTEGER NOT NULL,
  created_by    TEXT,                       -- tenant_admin id
  UNIQUE (tenant_id, abbrev),
  UNIQUE (tenant_id, name)
);

-- 员工账号
CREATE TABLE tenant_employees (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id        TEXT NOT NULL REFERENCES departments(id),
  username             TEXT NOT NULL,        -- "dev-zhangsan"（已含前缀）
  raw_username         TEXT NOT NULL,        -- "zhangsan"（员工输入的原文，便于 admin 看）
  password_hash        TEXT NOT NULL,        -- PBKDF2-SHA256 600k
  display_name         TEXT,
  status               TEXT NOT NULL DEFAULT 'active',  -- active | suspended | deleted
  machine_fingerprint  TEXT,                 -- 1:1 绑定的机器 hash
  bound_at             INTEGER,
  last_login_at        INTEGER,
  password_changed_at  INTEGER,
  created_at           INTEGER NOT NULL,
  created_by           TEXT,                 -- tenant_admin id (走 invite code 路径时也记录)
  UNIQUE (tenant_id, username)
);

-- Invite codes（如果 §3.4 选 A）
CREATE TABLE invite_codes (
  code           TEXT PRIMARY KEY,            -- 6-8 位 [A-Z0-9]
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id  TEXT NOT NULL REFERENCES departments(id),
  raw_username   TEXT NOT NULL,              -- 预设的 username（admin 加员工时填）
  display_name   TEXT,
  used_at        INTEGER,                    -- NULL = 未使用
  used_by_employee_id  TEXT,
  expires_at     INTEGER NOT NULL,           -- 默认 created_at + 7 天
  created_at     INTEGER NOT NULL,
  created_by     TEXT
);

-- Per-company installer build 请求（半自动 build pipeline）
CREATE TABLE installer_builds (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,              -- pending | building | succeeded | failed
  bundle_json    TEXT NOT NULL,              -- 序列化的 bundle.json
  download_url   TEXT,                       -- OSS URL，succeeded 后填
  error          TEXT,
  requested_by   TEXT NOT NULL,
  requested_at   INTEGER NOT NULL,
  completed_at   INTEGER
);
```

### 5.2 现有表改动

```sql
-- licenses 表已经有 tenant_id（多租户改造时加的）。
-- 新增几个字段：
ALTER TABLE licenses ADD COLUMN tier TEXT DEFAULT 'company';  -- 预留：company | dept | personal
ALTER TABLE seats ADD COLUMN employee_id TEXT REFERENCES tenant_employees(id);
-- seats 现在记 employee + machine 双绑（旧记录 employee_id 为 NULL，向后兼容）
```

### 5.3 Migration 顺序
1. `0006_create_departments.sql`
2. `0007_create_tenant_employees.sql`
3. `0008_create_invite_codes.sql`（看 §3.4）
4. `0009_alter_seats_add_employee.sql`
5. `0010_create_installer_builds.sql`

每个 migration 文件保持 ≤ 50 行，进 `schema_version` 表跟踪。

---

## 6. API 路线（License Server 端）

### 6.1 公司管理员侧（cookie + CSRF guard，已有的中间件复用）

```
GET    /api/tenant/departments              列出本租户所有部门
POST   /api/tenant/departments              创建部门（name + abbrev）
PATCH  /api/tenant/departments/:id          改部门名 / abbrev / status
DELETE /api/tenant/departments/:id          删部门（前提：无活动员工）

GET    /api/tenant/employees                列出本租户员工（带过滤：部门、状态）
POST   /api/tenant/employees                加员工 → 生成 invite_code（如果走 §3.4 A 路径）
                                              body: { department_id, raw_username, display_name }
                                              return: { invite_code, expires_at }
PATCH  /api/tenant/employees/:id            改 display_name / department_id（admin 改，不能改 username）
POST   /api/tenant/employees/:id/suspend    禁用（解绑机器、座位回收）
POST   /api/tenant/employees/:id/unbind     仅解绑机器（员工换机用）
DELETE /api/tenant/employees/:id            硬删除

POST   /api/tenant/installer/build          请求构建专属安装包
                                              body: { } （部门列表从 DB 取最新）
                                              return: { build_id, status: 'pending' }
GET    /api/tenant/installer/builds         查历史 build（最近 N 条）
GET    /api/tenant/installer/builds/:id     单条 build 状态 + download_url
```

### 6.2 员工侧（agent 客户端调，无 cookie，走 employee JWT）

```
POST   /api/employee/register                员工注册
                                                body: {
                                                  tenant_id,        -- 来自 bundle.json
                                                  invite_code,      -- 如果 §3.4 A
                                                  raw_username,     -- "zhangsan"
                                                  password,
                                                  machine_fingerprint
                                                }
                                                return: { employee_id, username, jwt, expires_at }

POST   /api/employee/login                   登录
                                                body: { tenant_id, username, password, machine_fingerprint }
                                                return: { employee_id, jwt, expires_at }

POST   /api/employee/logout                  登出（注销 JWT）
GET    /api/employee/me                      当前员工信息（验 JWT）
POST   /api/employee/change-password         改密（带 old + new）
POST   /api/employee/refresh                 刷 JWT（机器 fingerprint 校验）
```

### 6.3 Internal build worker 端（半自动 build pipeline 用）

```
GET    /api/internal/build-queue              拉一个 pending build（要 worker token）
POST   /api/internal/build-queue/:id/claim    标记 building
POST   /api/internal/build-queue/:id/upload   上传产物 → 写 download_url、status=succeeded
POST   /api/internal/build-queue/:id/fail     标记 failed + error
```

---

## 7. License Server 前端改动

### 7.1 `/admin/tenant.html` 加 3 个 tab

```
[ 概览 ] [ License | 部门 | 员工 | 安装包 | 设置 ]
            └ 已有       └ 新   └ 新   └ 新     └ 已有（改密）

部门 tab：
  - 表格：中文名 / 英文缩写 / 员工数 / 状态 / 创建时间 / 操作
  - "+ 新增部门" 弹窗

员工 tab：
  - 过滤器：部门 / 状态 / 关键字
  - 表格：username / display_name / 部门 / 状态 / 绑定机器 / 上次登录 / 操作
  - "+ 加员工" 弹窗 → 选部门 + 输 raw_username → 生成 invite code 弹窗（含复制按钮）
  - 单条操作：禁用 / 解绑机器 / 删除 / 改 display_name / 调部门

安装包 tab：
  - 表格：build_id / 状态 / 构建时间 / 下载链接 / 操作
  - "构建专属安装包" 按钮 → 弹窗确认部门 snapshot → 创建 build 任务 → 轮询状态
```

### 7.2 已有页面无需大改
- `/admin/super.html`：超管页面不改
- `/admin/login.html`：tenant admin / super 登录复用

---

## 8. NetClaw Agent 客户端改动

### 8.1 启动流程改造（[packaging/windows/app_launcher_gui.py](../packaging/windows/app_launcher_gui.py)）

```python
def main():
    # 已有：单例锁、env 设置、port 等待
    bundle = _read_bundle_json()              # 新增：从 _MEIPASS / install dir 读 bundle.json
    auth_state = _load_auth_state()            # ~/.netclaw/auth.json

    if not bundle:
        # 通用包（本地开发 / non-installer）→ 走旧 NCLW 流程
        ...
    elif not auth_state.is_valid():
        # 第一次启动 OR JWT 过期 → 弹注册/登录 wizard
        # wizard 不进 WebUI，直接 native 窗口（pywebview 单页）
        wizard_url = f"http://{host}:{port}/static/employee-auth.html"
        # 走完后在 ~/.netclaw/auth.json 落 jwt + employee_id + machine_fp
    else:
        # 正常进 WebUI
        ...
```

### 8.2 新增 [webui/static/employee-auth.html](../webui/static/employee-auth.html)

两态切换：

- **首次（注册）**：选部门下拉（来自 bundle.json）+ invite code 输入框 + raw_username + password + confirm password
- **已注册（登录）**：username（已含前缀，灰色不可改）+ password + "忘记密码"

注册成功 → 调 `/api/employee/register` → 拿 JWT → 写 auth.json → reload 到主 WebUI

### 8.3 [hermes_cli/license.py](../hermes_cli/license.py) 改造

现在 `netclaw license activate <NCLW>` 是 machine-bound。新加：
- `netclaw login <username>` (prompt password) → 走 `/api/employee/login`
- `netclaw logout`
- `netclaw whoami`
- `netclaw change-password`

兼容性：如果 bundle.json 不存在，全部命令走旧 NCLW machine-bound 流程（现有单机用户不受影响）。

### 8.4 WebUI 添加身份徽章

[webui/static/ui.js](../webui/static/ui.js) 顶部加：
- 当前员工 username + 部门
- 退出登录按钮 → 清 auth.json + 重启 wizard

### 8.5 bundle.json schema

```jsonc
{
  "schema_version": 1,
  "tenant_id": "01HXXXX...",          // ULID
  "tenant_slug": "acme",
  "tenant_name": "Acme 软件",
  "license_server": "https://license.netclawsec.com.cn",
  "require_invite_code": true,
  "departments": [
    { "id": "01HXXXX...", "name": "研发部", "abbrev": "dev" },
    { "id": "01HYYYY...", "name": "市场部", "abbrev": "mkt" }
  ],
  "built_at": "2026-04-30T12:34:56Z",
  "build_signature": "sha256:..."     // 防 bundle.json 被篡改：服务端用 license server 私钥签
}
```

bundle.json 嵌入 PyInstaller `--add-data` → 跟 `_internal/` 一起进 install dir。

---

## 9. Per-company installer build 流水线

### 9.1 `packaging/windows/build.ps1` 加参数

```powershell
.\packaging\windows\build.ps1 `
  -TenantId "01HXXXX..." `
  -TenantSlug "acme" `
  -BundleJson "C:\path\to\bundle.json" `
  -OutputName "NetClaw-Agent-Setup-acme-0.10.0.exe"
```

实现：
1. 把 `BundleJson` 拷贝到 `$root/bundle.json`，spec 里 `Tree(... ['bundle.json'])` 包进 dist
2. ISCC 调用加 `/DTenantSlug=acme /DAppId=...`，让 .iss 模板用动态 AppId（防止两个公司装同一台机器互相覆盖）
3. 改 OutputBaseFilename 用 tenant_slug

### 9.2 半自动 worker（暂用）

macOS 上一个 cron / launchd job：
```bash
*/5 * * * * /Users/crawford/.local/bin/netclaw-build-worker
```

Worker 逻辑：
1. 调 `GET /api/internal/build-queue` 拉 pending
2. 找到任务 → `prlctl exec "Windows 11" --current-user "powershell -File X:\packaging\windows\build.ps1 -TenantId ..."`
3. 上传产物到阿里云 OSS（公开 bucket，objectKey = `installers/<tenant_slug>/NetClaw-Agent-Setup-<slug>-<ver>.exe`）
4. POST `/api/internal/build-queue/:id/upload` 回写 download_url

如果 build 失败 → POST `/api/internal/build-queue/:id/fail` + error 摘要。

### 9.3 阶段 2（GH Actions）保留接口

`installer_builds` 表里多加一列 `worker_kind`，让以后 GH Actions 也能拉队列。这次先不做。

---

## 10. WebUI 响应式重构

### 10.1 默认最大化（10 行改动）
[packaging/windows/app_launcher_gui.py](../packaging/windows/app_launcher_gui.py)：
```python
webview.create_window(
    "NetClaw Agent", url,
    width=1280, height=860,
    min_size=(900, 640),
    maximized=True,           # ← 新增
    resizable=True, ...
)
```

### 10.2 字号缩放持久化
在 [webui/static/ui.js](../webui/static/ui.js) 顶部：
```js
const ZOOM_KEY = 'netclaw.zoomLevel';
const savedZoom = parseFloat(localStorage.getItem(ZOOM_KEY) || '1');
document.documentElement.style.fontSize = `${savedZoom * 16}px`;

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  let z = parseFloat(localStorage.getItem(ZOOM_KEY) || '1');
  if (e.key === '=' || e.key === '+') z = Math.min(z * 1.1, 2.5);
  else if (e.key === '-') z = Math.max(z / 1.1, 0.7);
  else if (e.key === '0') z = 1;
  else return;
  e.preventDefault();
  localStorage.setItem(ZOOM_KEY, String(z));
  document.documentElement.style.fontSize = `${z * 16}px`;
});
```

### 10.3 卡片 / 侧栏响应式
重点改 [webui/static/style.css](../webui/static/style.css)：
- `.sidebar` 从 `width: 260px` 改成 `flex: 0 0 clamp(220px, 18vw, 360px)`
- `.main-content` 从固定 max-width 改成 `flex: 1; max-width: min(1600px, 92vw)`
- 卡片 grid 用 `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`
- @media `(min-width: 1600px)` → 内容区 padding 从 24px → 48px
- 字体单位从 px 全部改成 rem（配合 §10.2 的根字号控制）

工作量：~2-3 个 PR，触及 `style.css` 大部分类。建议拆成"骨架重构 + 卡片重构 + 表格重构"三轮。

---

## 11. 阶段拆分 + 估时

| 阶段 | 内容 | 估时 | 依赖 | 可并行 |
|---|---|---|---|---|
| 0 | 删 `default` + `mvp-mac-test` 老租户 | 5 min | — | — |
| 1 | License server schema + migrations | 0.5 天 | 0 | 与 5 并行 |
| 2 | License server API（dept / employee / invite / installer_build） | 1 天 | 1 | — |
| 3 | License server tests（覆盖 2 的所有路由） | 0.5 天 | 2 | — |
| 4 | `/admin/tenant.html` 前端 3 个 tab | 1 天 | 2 | — |
| 5 | WebUI 默认最大化 + 缩放持久化 | 0.5 天 | — | 与 1 并行 |
| 6 | WebUI 响应式 CSS 重构 | 1.5 天 | 5 | 与 1~4 并行 |
| 7 | netclaw-agent 端：bundle.json 读取 + employee-auth.html wizard | 1 天 | 2 | 与 4/6 并行 |
| 8 | netclaw-agent 端：login / logout / whoami CLI 命令 | 0.5 天 | 7 | — |
| 9 | per-company `build.ps1` 参数化 + ISCC AppId 模板 | 0.5 天 | 7 | — |
| 10 | 半自动 build worker（macOS launchd + Parallels driver） | 1 天 | 9 | — |
| 11 | 阿里云 OSS bucket 配置 + 上传脚本 | 0.5 天 | 10 | — |
| 12 | 端到端联调：你 → tenant → admin → invite → 员工注册 → 切机器 → 离职 | 1 天 | 全部 | — |
| 13 | 文档：tenant admin 操作手册 + 故障排查 | 0.5 天 | 12 | — |

**总计**: ~9.5 人日

按依赖串行的话最长路径约 **7 天**（阶段 1→2→3→4→7→8→9→10→11→12→13）。

---

## 12. 风险登记

| 风险 | 严重度 | 缓解 |
|---|---|---|
| bundle.json 被员工篡改改换 tenant | 高 | 用 license server 私钥签 `build_signature`，启动校验，校验失败拒启 |
| 半自动 build worker 挂了 / Parallels VM 关机 | 中 | 加超时 + 失败告警；installer_builds 表 status=building 超 30 min 自动 fail |
| 员工换电脑机器 fingerprint 变了 | 高 | tenant admin "解绑" 流程；员工原密码登录新机后重绑 |
| OSS bucket 被刷流量 | 低 | 走 OSS 防盗链 + 公开下载只对带签名 URL 有效（24h 过期） |
| license server 备案没下来 | 中 | bundle.json 写域名 + DNS 临时指 IP；备案后只切 DNS |
| 数据库 migration 出错 | 高 | 每次 migration 前 sqlite3 备份；migrations 走 `schema_version` 表跟踪；CI 跑回滚演练 |
| 员工注册时 invite code 泄漏 | 中 | invite code 7 天过期 + 一次性消费 + 调用频次限流 |
| 多租户 API 串数据 | **极高** | 每条 `/api/tenant/*` 路由强制 middleware 注入 `req.tenant_id`，业务代码不能跳过；写 60+ 单测专攻 cross-tenant 越权 |
| 离职员工 JWT 还在有效期内 | 中 | 服务端 `tenant_employees.status` 一变 `suspended`，下次 `/api/employee/refresh` 拒绝；JWT TTL 设 24h；管理员"立即踢"调 `/api/employee/:id/revoke-tokens` 把员工的 token jti 加黑名单 |

---

## 13. 测试矩阵

### 13.1 License server 单测（Node `node:test`）
- migrations apply / rollback
- departments CRUD（同 abbrev / 同 name 拒）
- employees CRUD + invite code 流程
- 跨租户越权（A 公司 admin 不能改 B 公司部门）
- machine fingerprint 1:1 校验
- license expire → employee login 全员拒
- tenant suspend → employee login 拒
- password 哈希 + change password old/new 校验
- installer build 队列状态机

### 13.2 netclaw-agent 单测（pytest）
- bundle.json 读取 + signature 校验
- ~/.netclaw/auth.json 落盘 + 加密
- machine fingerprint 生成稳定性（同机两次值一样）
- wizard 注册/登录提交 → API mock 验证 payload

### 13.3 端到端手动 checklist
- [ ] 你（super）建公司 Acme，quota 5 座位
- [ ] 公司管理员登录，建部门：研发部 / dev、市场部 / mkt
- [ ] 公司管理员加员工：研发部 zhangsan → 拿 invite code
- [ ] 公司管理员点"生成安装包" → 等几分钟拿到 OSS 下载链接
- [ ] 在 Parallels Win 上下载装包，第一次启动看到注册 wizard
- [ ] 用 invite code + 密码 abcd1234 注册 → 进入主 WebUI，顶部显示 dev-zhangsan / 研发部
- [ ] 关闭重开 → 直接进 WebUI（无需重登录）
- [ ] 退出登录 → 重启走登录页
- [ ] 改密 abcd1234 → ABCD5678 → 退出 → 老密码登录失败、新密码成功
- [ ] tenant admin 把这员工解绑机器 → 员工下次启动登录失败 → 重新注册
- [ ] tenant admin 删员工 → 员工被强制踢出
- [ ] license 调到 expired → 该公司所有员工启动后拒
- [ ] 在第 6 个员工注册时 quota_exceeded
- [ ] 用别的公司的 username 在 Acme 端尝试登录 → 拒

---

## 14. 上线 checklist

- [ ] License server 备份
- [ ] License server schema migrate（在测试 DB 跑一遍 + 回滚一遍）
- [ ] License server 部署（pm2 reload）
- [ ] 阿里云 OSS bucket 创建 + 防盗链 / 签名 URL
- [ ] DNS `license.netclawsec.com.cn` → 120.55.247.72（备案前临时）
- [ ] tenant admin 操作手册（截图版）
- [ ] 员工首次注册指引（一图流）
- [ ] 一个 demo 客户公司（你自己当客户，端到端走一遍）
- [ ] 老 NCLW key 用户兼容验证（v0.10.0 老包还能用）

---

## 15. 决策评审清单（你回我这几条就开干）

请逐条回我 A/B 或自己写：

1. **§3.1 NCLW key 数量**: A（一公司一 key）/ B（多 key）
2. **§3.2 server 地址**: A（域名）/ B（IP）
3. **§3.3 username 唯一性**: A（tenant 内）/ B（全平台）
4. **§3.4 invite code**: A（要）/ B（不要）
5. **§3.5 密码强度**: A（≥8 + 字母数字）/ B（≥6 无要求）
6. **§3.6 离职动作**: A（禁用 + 删除两档）/ B（只删除）
7. **§3.7 换机**: A（admin 解绑）/ B（不支持）
8. **§3.8 build pipeline 阶段**: 默认走半自动（阶段 1）你 OK 吗？
9. **阶段并行**: 我建议 1+5+6 同时开（独立无依赖），你 OK 吗？
10. **删老租户**: 我等你跑完 §阶段 0 再开干，还是你授权我直接帮你跑？
