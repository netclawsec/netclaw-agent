(function () {
  const { $, api, escape, dt, openModal, closeModal, formatErr, getDepartments, copy } = window.NC;

  let allEmployees = [];
  let filterDept = '';
  let filterStatus = '';
  let filterQ = '';

  function statusBadge(status) {
    if (status === 'active')    return '<span class="badge badge-green">在职</span>';
    if (status === 'suspended') return '<span class="badge badge-amber">已禁用</span>';
    if (status === 'deleted')   return '<span class="badge badge-slate">已离职</span>';
    return `<span class="badge badge-slate">${escape(status)}</span>`;
  }

  function fpShort(fp) {
    if (!fp) return '<span class="text-slate-400">未绑定</span>';
    return `<code class="text-xs bg-slate-100 px-1 rounded" title="${escape(fp)}">${escape(fp.slice(0, 12))}…</code>`;
  }

  function applyFilters(emps) {
    const q = filterQ.trim().toLowerCase();
    return emps.filter((e) => {
      if (filterDept && e.department_id !== filterDept) return false;
      if (filterStatus && e.status !== filterStatus) return false;
      if (q) {
        const hay = `${e.username || ''} ${e.display_name || ''} ${e.raw_username || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    const tbody = $('emps-tbody');
    const rows = applyFilters(allEmployees);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-12 text-center text-slate-400">${
        allEmployees.length === 0 ? '还没有员工，点右上角加员工生成邀请码' : '没有匹配的员工'
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((e) => `
      <tr>
        <td class="px-4 py-3 font-mono text-xs">${escape(e.username)}</td>
        <td class="px-4 py-3">${escape(e.display_name || '—')}</td>
        <td class="px-4 py-3">${escape(e.department_name || '—')} <span class="text-xs text-slate-400">(${escape(e.department_abbrev || '')})</span></td>
        <td class="px-4 py-3">${statusBadge(e.status)}</td>
        <td class="px-4 py-3">${fpShort(e.machine_fingerprint)}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${dt(e.last_login_at)}</td>
        <td class="px-4 py-3 space-x-2 text-sm whitespace-nowrap">
          <button data-act="edit-emp" data-id="${escape(e.id)}" class="text-indigo-600 hover:text-indigo-700">编辑</button>
          ${e.status === 'active'
            ? `<button data-act="suspend-emp" data-id="${escape(e.id)}" class="text-amber-600 hover:text-amber-700">禁用</button>`
            : e.status === 'suspended'
              ? `<button data-act="reactivate-emp" data-id="${escape(e.id)}" class="text-green-600 hover:text-green-700">启用</button>`
              : ''}
          ${e.machine_fingerprint
            ? `<button data-act="unbind-emp" data-id="${escape(e.id)}" class="text-slate-600 hover:text-slate-900">解绑机器</button>`
            : ''}
          <button data-act="delete-emp" data-id="${escape(e.id)}" class="text-red-600 hover:text-red-700">删除</button>
        </td>
      </tr>
    `).join('');
  }

  async function loadEmployees() {
    const { json } = await api('GET', '/api/tenant/employees');
    allEmployees = json.employees || [];
    await refreshDeptFilterOptions();
    render();
  }

  async function refreshDeptFilterOptions() {
    const sel = $('emp-filter-dept');
    if (!sel) return;
    const cur = sel.value;
    const depts = await getDepartments();
    sel.innerHTML = '<option value="">所有部门</option>' +
      depts.map((d) => `<option value="${escape(d.id)}">${escape(d.name)} (${escape(d.abbrev)})</option>`).join('');
    sel.value = cur;
  }

  async function openCreate() {
    const depts = (await getDepartments()).filter((d) => d.status === 'active');
    if (depts.length === 0) {
      alert('请先在"部门" tab 创建至少一个部门，再加员工。');
      return;
    }
    openModal(`
      <h3 class="text-lg font-semibold mb-4">加员工（生成邀请码）</h3>
      <p class="text-xs text-slate-500 mb-3">生成的邀请码发给员工，员工首次启动 NetClaw Agent 时填这个码自助注册。注册时会用 <code class="bg-slate-100 px-1 rounded">部门缩写-raw_username</code> 作为最终 username。</p>
      <form id="ec-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">部门</label>
          <select id="ec-dept" required class="w-full border border-slate-300 rounded px-3 py-2">
            ${depts.map((d) => `<option value="${escape(d.id)}">${escape(d.name)} (${escape(d.abbrev)})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">raw_username</label>
          <input id="ec-username" required pattern="[a-z0-9._-]{2,32}" class="w-full border border-slate-300 rounded px-3 py-2 font-mono" placeholder="zhangsan" />
          <p class="text-xs text-slate-500 mt-1">2-32 位小写字母/数字/点/下划线/横线。最终 username 会变成 <code class="bg-slate-100 px-1 rounded" id="ec-preview">dev-zhangsan</code></p>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">显示名（可选）</label>
          <input id="ec-display" maxlength="100" class="w-full border border-slate-300 rounded px-3 py-2" placeholder="张三" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">邀请码有效期</label>
          <select id="ec-ttl" class="w-full border border-slate-300 rounded px-3 py-2">
            <option value="7" selected>7 天</option>
            <option value="14">14 天</option>
            <option value="30">30 天</option>
          </select>
        </div>
        <div id="ec-err" class="hidden text-sm text-red-600"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="ec-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">生成邀请码</button>
        </div>
      </form>
    `);
    const refreshPreview = () => {
      const dept = depts.find((d) => d.id === $('ec-dept').value);
      const raw = $('ec-username').value.trim();
      $('ec-preview').textContent = dept && raw ? `${dept.abbrev}-${raw}` : 'dev-zhangsan';
    };
    $('ec-dept').onchange = refreshPreview;
    $('ec-username').oninput = refreshPreview;
    $('ec-cancel').onclick = closeModal;
    $('ec-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        department_id: $('ec-dept').value,
        raw_username: $('ec-username').value.trim(),
        ttl_days: Number($('ec-ttl').value)
      };
      const display = $('ec-display').value.trim();
      if (display) body.display_name = display;
      const { status, json } = await api('POST', '/api/tenant/employees', body);
      if (status >= 400) {
        $('ec-err').textContent = formatErr(json);
        $('ec-err').classList.remove('hidden');
        return;
      }
      showInviteResult(json);
    };
  }

  function showInviteResult(payload) {
    const expiresLabel = payload.expires_at ? new Date(payload.expires_at).toLocaleString('zh-CN', { hour12: false }) : '永久';
    openModal(`
      <h3 class="text-lg font-semibold mb-3">邀请码已生成 ✓</h3>
      <p class="text-sm text-slate-600 mb-3">把下面的邀请码连同 NetClaw Agent 安装包一起发给员工，员工在 Agent 启动向导里粘贴邀请码即可完成注册。</p>
      <div class="space-y-2">
        <div class="bg-indigo-50 border border-indigo-200 rounded p-4 text-center">
          <div class="text-xs text-indigo-600 mb-1">邀请码</div>
          <div class="font-mono text-2xl font-bold tracking-widest text-indigo-900">${escape(payload.invite_code)}</div>
        </div>
        <div class="text-xs text-slate-500 grid grid-cols-2 gap-2 px-1">
          <div><span class="text-slate-400">部门</span> ${escape(payload.department.name)} (${escape(payload.department.abbrev)})</div>
          <div><span class="text-slate-400">预定 username</span> <code>${escape(payload.preview_username)}</code></div>
          <div class="col-span-2"><span class="text-slate-400">过期时间</span> ${escape(expiresLabel)}</div>
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-4">
        <button id="ir-copy" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">复制邀请码并关闭</button>
      </div>
    `);
    $('ir-copy').onclick = async () => {
      await copy(payload.invite_code);
      closeModal();
      await loadEmployees();
      // also refresh invites tab cache so user sees the new pending invite if they switch
      window.NC.invites?.markStale?.();
    };
  }

  async function openEdit(id) {
    const emp = allEmployees.find((e) => e.id === id);
    if (!emp) { alert('员工不存在'); return; }
    const depts = (await getDepartments()).filter((d) => d.status === 'active' || d.id === emp.department_id);
    openModal(`
      <h3 class="text-lg font-semibold mb-4">编辑员工</h3>
      <p class="text-xs text-slate-500 mb-3">username（<code>${escape(emp.username)}</code>）一旦确定无法修改。</p>
      <form id="ee-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">显示名</label>
          <input id="ee-display" maxlength="100" value="${escape(emp.display_name || '')}" class="w-full border border-slate-300 rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">部门</label>
          <select id="ee-dept" class="w-full border border-slate-300 rounded px-3 py-2">
            ${depts.map((d) => `<option value="${escape(d.id)}" ${d.id === emp.department_id ? 'selected' : ''}>${escape(d.name)} (${escape(d.abbrev)})${d.status !== 'active' ? ' [已归档]' : ''}</option>`).join('')}
          </select>
          <p class="text-xs text-amber-600 mt-1">⚠️ 调部门不会重命名 username（保持 <code>${escape(emp.username)}</code>）。</p>
        </div>
        <div id="ee-err" class="hidden text-sm text-red-600"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="ee-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">保存</button>
        </div>
      </form>
    `);
    $('ee-cancel').onclick = closeModal;
    $('ee-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = {};
      const newDisplay = $('ee-display').value.trim() || null;
      const newDept = $('ee-dept').value;
      if (newDisplay !== (emp.display_name || null)) body.display_name = newDisplay;
      if (newDept !== emp.department_id) body.department_id = newDept;
      if (Object.keys(body).length === 0) { closeModal(); return; }
      const { status, json } = await api('PATCH', `/api/tenant/employees/${id}`, body);
      if (status >= 400) {
        $('ee-err').textContent = formatErr(json);
        $('ee-err').classList.remove('hidden');
        return;
      }
      closeModal();
      await loadEmployees();
    };
  }

  async function callEmpAction(id, path, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const { status, json } = await api('POST', `/api/tenant/employees/${id}/${path}`);
    if (status >= 400) alert('操作失败：' + formatErr(json));
    await loadEmployees();
  }

  async function deleteEmp(id) {
    const emp = allEmployees.find((e) => e.id === id);
    const label = emp ? emp.username : id;
    if (!confirm(`确定彻底删除员工 ${label}？\n\n此操作不可逆。如果只是离职可考虑改为"禁用"。`)) return;
    const { status, json } = await api('DELETE', `/api/tenant/employees/${id}`);
    if (status >= 400) alert('删除失败：' + formatErr(json));
    await loadEmployees();
  }

  async function handleAction(act, btn) {
    const id = btn.dataset.id;
    if (act === 'edit-emp')       return openEdit(id);
    if (act === 'suspend-emp')    return callEmpAction(id, 'suspend', '禁用员工后他将无法登录，绑定的机器也会自动解绑。');
    if (act === 'reactivate-emp') return callEmpAction(id, 'reactivate');
    if (act === 'unbind-emp')     return callEmpAction(id, 'unbind', '解绑机器后员工下次登录时绑定到新机器。当前机器立即失去访问权限。');
    if (act === 'delete-emp')     return deleteEmp(id);
  }

  function bindFilters() {
    $('emp-filter-dept').addEventListener('change', (e) => { filterDept = e.target.value; render(); });
    $('emp-filter-status').addEventListener('change', (e) => { filterStatus = e.target.value; render(); });
    $('emp-filter-q').addEventListener('input', (e) => { filterQ = e.target.value; render(); });
  }

  let filtersBound = false;
  window.NC.employees = {
    mount: async () => {
      if (!filtersBound) { bindFilters(); filtersBound = true; }
      await loadEmployees();
    },
    openCreate,
    handleAction
  };
})();
