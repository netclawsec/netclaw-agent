// Bootstrap + tab routing for /admin/tenant.html. Per-tab logic lives in
// tenant-{licenses,departments,employees,invites}.js and registers under
// window.NC.{name}.{ mount, openCreate, handleAction }.
(function () {
  const { $, api, openModal, closeModal, formatErr, invalidate } = window.NC;

  const tabs = {
    overview:    { mount: () => loadDashboard() },
    licenses:    () => window.NC.licenses,
    departments: () => window.NC.departments,
    employees:   () => window.NC.employees,
    invites:     () => window.NC.invites,
    installers:  () => window.NC.installers
  };

  function tabModule(name) {
    const t = tabs[name];
    if (typeof t === 'function') return t();
    return t;
  }

  let currentTab = 'overview';

  async function activateTab(name) {
    if (!tabs[name]) name = 'overview';
    currentTab = name;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
    const mod = tabModule(name);
    if (mod && mod.mount) {
      try { await mod.mount(); } catch (err) { console.error('tab mount failed', name, err); }
    }
    history.replaceState(null, '', `#${name}`);
  }

  // Mutations on departments/employees can break invite-tab caches. Provide a
  // central refresh hook that other tabs can poke after a mutating action.
  window.NC.tabs = {
    refreshOverview: () => loadDashboard(),
    invalidateDepartments: () => invalidate('departments')
  };

  async function loadMe() {
    const { json } = await api('GET', '/api/auth/me');
    if (!json.success) { window.location.href = './login.html'; return; }
    if (json.admin.role !== 'tenant_admin') { window.location.href = './super.html'; return; }
    $('me-label').textContent = `${json.admin.username}${json.admin.display_name ? ' · ' + json.admin.display_name : ''}`;
    $('tenant-name-badge').textContent = json.tenant ? json.tenant.name : '';
  }

  async function loadDashboard() {
    const { json } = await api('GET', '/api/tenant/dashboard');
    if (!json.success) return;
    const d = json.tenant;
    const fillRate = d.seat_quota === 0 ? 0 : (d.seats_used / d.seat_quota * 100).toFixed(0);
    $('dashboard').innerHTML = `
      <div class="bg-white border border-slate-200 rounded-lg p-4">
        <div class="text-xs text-slate-500">座位用量</div>
        <div class="text-2xl font-semibold mt-1">${d.seats_used} <span class="text-sm text-slate-400">/ ${d.seat_quota}</span></div>
        <div class="mt-2 bg-slate-100 rounded h-1.5"><div class="bg-indigo-500 h-1.5 rounded" style="width:${Math.min(100, fillRate)}%"></div></div>
      </div>
      <div class="bg-white border border-slate-200 rounded-lg p-4">
        <div class="text-xs text-slate-500">剩余座位</div>
        <div class="text-2xl font-semibold mt-1 ${d.seats_remaining === 0 ? 'text-red-600' : ''}">${d.seats_remaining}</div>
      </div>
      <div class="bg-white border border-slate-200 rounded-lg p-4">
        <div class="text-xs text-slate-500">License 数</div>
        <div class="text-2xl font-semibold mt-1">${d.license_count}</div>
      </div>
      <div class="bg-white border border-slate-200 rounded-lg p-4">
        <div class="text-xs text-slate-500">在线激活数</div>
        <div class="text-2xl font-semibold mt-1">${d.active_seats}</div>
      </div>
    `;
    await loadOverviewExtras();
  }

  async function loadOverviewExtras() {
    const [{ json: deptResp }, { json: empResp }, { json: invResp }] = await Promise.all([
      api('GET', '/api/tenant/departments'),
      api('GET', '/api/tenant/employees'),
      api('GET', '/api/tenant/invite-codes')
    ]);
    const depts = deptResp.departments || [];
    const emps = empResp.employees || [];
    const invs = invResp.invite_codes || [];
    const activeDepts = depts.filter((d) => d.status === 'active').length;
    const activeEmps = emps.filter((e) => e.status === 'active').length;
    const suspendedEmps = emps.filter((e) => e.status === 'suspended').length;
    const pendingInvs = invs.filter((i) => !i.used_at && (!i.expires_at || new Date(i.expires_at) > new Date())).length;
    $('overview-extras').innerHTML = `
      <div class="bg-white border border-slate-200 rounded-lg p-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-slate-700">部门</div>
            <div class="text-xs text-slate-500 mt-1">${activeDepts} 个使用中 · 共 ${depts.length} 个</div>
          </div>
          <button class="text-sm text-indigo-600 hover:text-indigo-700" data-goto="departments">管理 →</button>
        </div>
      </div>
      <div class="bg-white border border-slate-200 rounded-lg p-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-slate-700">员工</div>
            <div class="text-xs text-slate-500 mt-1">${activeEmps} 在职${suspendedEmps ? ` · ${suspendedEmps} 已禁用` : ''} · 共 ${emps.length} 人</div>
          </div>
          <button class="text-sm text-indigo-600 hover:text-indigo-700" data-goto="employees">管理 →</button>
        </div>
      </div>
      <div class="bg-white border border-slate-200 rounded-lg p-4 md:col-span-2">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-slate-700">未使用邀请码</div>
            <div class="text-xs text-slate-500 mt-1">${pendingInvs} 个待员工注册${invs.length ? ` · 共 ${invs.length} 条历史` : ''}</div>
          </div>
          <button class="text-sm text-indigo-600 hover:text-indigo-700" data-goto="invites">管理 →</button>
        </div>
      </div>
    `;
  }

  // Tab navigation
  $('tab-nav').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    await activateTab(btn.dataset.tab);
  });

  // Cross-tab "go to" buttons in the overview cards
  document.addEventListener('click', async (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { await activateTab(goto.dataset.goto); return; }
  });

  // "+ 新增" buttons per tab dispatch to that tab's openCreate
  // open-create-license button removed — license create/renew lives in
  // super-side UI now. Tenant license tab is read-only (revoke/seats only).
  $('open-create-dept').addEventListener('click',     () => window.NC.departments?.openCreate?.());
  $('open-create-emp').addEventListener('click',      () => window.NC.employees?.openCreate?.());
  $('open-build-installer').addEventListener('click', () => window.NC.installers?.openCreate?.());

  // Global delegated row-action handler — dispatches by data-act prefix to the
  // right tab module. Keeps each tab's per-row JS self-contained.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act.endsWith('-lic') || act === 'unbind-seat') return window.NC.licenses?.handleAction?.(act, btn);
    if (act.endsWith('-dept'))                          return window.NC.departments?.handleAction?.(act, btn);
    if (act.endsWith('-emp'))                           return window.NC.employees?.handleAction?.(act, btn);
    if (act.endsWith('-inv'))                           return window.NC.invites?.handleAction?.(act, btn);
    if (act.endsWith('-installer-url') ||
        act.endsWith('-installer-error'))               return window.NC.installers?.handleAction?.(act, btn);
  });

  // Change password
  $('change-pw-btn').addEventListener('click', () => {
    openModal(`
      <h3 class="text-lg font-semibold mb-4">修改密码</h3>
      <form id="pw-form" class="space-y-3">
        <input id="pw-old" type="password" required class="w-full border border-slate-300 rounded px-3 py-2" placeholder="当前密码" />
        <input id="pw-new" type="password" minlength="8" required class="w-full border border-slate-300 rounded px-3 py-2" placeholder="新密码（≥8 位）" />
        <div id="pw-err" class="hidden text-sm text-red-600"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="pw-cancel" class="px-4 py-2 text-slate-600">取消</button>
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">保存</button>
        </div>
      </form>
    `);
    $('pw-cancel').onclick = closeModal;
    $('pw-form').onsubmit = async (e) => {
      e.preventDefault();
      const { status, json } = await api('POST', '/api/auth/change-password', {
        old_password: $('pw-old').value,
        new_password: $('pw-new').value
      });
      if (status >= 400) {
        $('pw-err').textContent = formatErr(json);
        $('pw-err').classList.remove('hidden');
        return;
      }
      closeModal();
      alert('密码已更新');
    };
  });

  $('logout-btn').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout');
    window.location.href = './login.html';
  });

  // Boot — read deep-link tab from URL hash, default to overview.
  (async () => {
    await loadMe();
    const wanted = (location.hash || '').replace(/^#/, '');
    await activateTab(tabs[wanted] ? wanted : 'overview');
  })();
})();
