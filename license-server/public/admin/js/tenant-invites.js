(function () {
  const { $, api, escape, dt, formatErr, copy } = window.NC;

  let allInvites = [];
  let stale = true;
  let filterStatus = '';
  let filtersBound = false;

  function inviteState(inv) {
    if (inv.used_by_employee_id) return 'used';
    if (inv.used_at && !inv.used_by_employee_id) return 'revoked';
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return 'expired';
    return 'pending';
  }

  function stateBadge(state) {
    if (state === 'pending')  return '<span class="badge badge-indigo">未使用</span>';
    if (state === 'used')     return '<span class="badge badge-green">已使用</span>';
    if (state === 'revoked')  return '<span class="badge badge-red">已撤销</span>';
    if (state === 'expired')  return '<span class="badge badge-amber">已过期</span>';
    return `<span class="badge badge-slate">${escape(state)}</span>`;
  }

  function render() {
    const tbody = $('invs-tbody');
    const rows = filterStatus
      ? allInvites.filter((i) => inviteState(i) === filterStatus)
      : allInvites;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-12 text-center text-slate-400">${
        allInvites.length === 0 ? '还没有邀请码记录。在"员工" tab 点"加员工"会自动生成。' : '没有匹配的邀请码'
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((i) => {
      const state = inviteState(i);
      const previewUsername = `${i.department_abbrev}-${i.raw_username}`;
      return `
      <tr>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <code class="font-mono font-semibold tracking-wider">${escape(i.code)}</code>
            ${state === 'pending' ? `<button data-act="copy-inv" data-code="${escape(i.code)}" class="text-indigo-600 hover:text-indigo-700 text-xs">复制</button>` : ''}
          </div>
        </td>
        <td class="px-4 py-3 text-sm">${escape(i.department_name || '—')} <span class="text-xs text-slate-400">(${escape(i.department_abbrev || '')})</span></td>
        <td class="px-4 py-3 font-mono text-xs">${escape(previewUsername)}</td>
        <td class="px-4 py-3">${stateBadge(state)}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${dt(i.created_at)}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${dt(i.expires_at)}</td>
        <td class="px-4 py-3 text-sm">
          ${state === 'pending' ? `<button data-act="revoke-inv" data-code="${escape(i.code)}" class="text-red-600 hover:text-red-700">撤销</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  async function loadInvites() {
    const { json } = await api('GET', '/api/tenant/invite-codes');
    allInvites = json.invite_codes || [];
    stale = false;
    render();
  }

  async function handleAction(act, btn) {
    if (act === 'copy-inv') {
      await copy(btn.dataset.code, btn);
    } else if (act === 'revoke-inv') {
      if (!confirm(`确定撤销邀请码 ${btn.dataset.code}？\n\n撤销后该码无法再用于注册。`)) return;
      const { status, json } = await api('POST', `/api/tenant/invite-codes/${btn.dataset.code}/revoke`);
      if (status >= 400) {
        alert('撤销失败：' + formatErr(json));
        return;
      }
      await loadInvites();
    }
  }

  function bindFilters() {
    $('inv-filter-status').addEventListener('change', (e) => { filterStatus = e.target.value; render(); });
  }

  window.NC.invites = {
    mount: async () => {
      if (!filtersBound) { bindFilters(); filtersBound = true; }
      if (stale) await loadInvites();
    },
    markStale: () => { stale = true; },
    handleAction
  };
})();
