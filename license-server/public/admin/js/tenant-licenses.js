(function () {
  const { $, api, escape, dt, dateOnly, openModal, closeModal, formatErr } = window.NC;

  async function loadLicenses() {
    const { json } = await api('GET', '/api/tenant/licenses');
    const tbody = $('licenses-tbody');
    if (!json.licenses?.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-slate-400">还没有 License — 联系超管发放</td></tr>';
      return;
    }
    tbody.innerHTML = json.licenses.map((l) => {
      const expired = new Date(l.expires_at) < new Date();
      return `
      <tr>
        <td class="px-4 py-3 font-mono text-xs">
          <div class="flex items-center gap-2">
            <span>${escape(l.license_key)}</span>
            <button data-act="copy-lic" data-key="${escape(l.license_key)}" class="text-indigo-600 hover:text-indigo-700 text-xs">复制</button>
          </div>
        </td>
        <td class="px-4 py-3">${escape(l.customer_name)}</td>
        <td class="px-4 py-3">${l.active_seats || 0}/${l.seats}</td>
        <td class="px-4 py-3">
          ${l.status === 'revoked'
            ? '<span class="badge badge-red">已吊销</span>'
            : expired
              ? '<span class="badge badge-amber">已过期</span>'
              : '<span class="badge badge-green">有效</span>'}
        </td>
        <td class="px-4 py-3 text-xs text-slate-500">${dateOnly(l.expires_at)}</td>
        <td class="px-4 py-3 space-x-2 text-sm">
          ${l.status !== 'revoked' ? `<button data-act="revoke-lic" data-key="${escape(l.license_key)}" class="text-red-600 hover:text-red-700">吊销</button>` : ''}
          <button data-act="seats-lic" data-key="${escape(l.license_key)}" class="text-slate-600 hover:text-slate-900">查看激活</button>
        </td>
      </tr>`;
    }).join('');
  }

  // openCreate is no longer wired — license create + renew moved to super.
  // Tenant admins can list / revoke / inspect seats / unbind seats but
  // can't issue or extend their own paid period.
  function openCreate() {
    alert('License Key 由超管发放 — 请联系平台。');
  }

  async function showSeats(key) {
    const { json } = await api('GET', `/api/tenant/licenses/${key}`);
    if (!json.success) return;
    const seatsHtml = json.seats.length
      ? json.seats.map((s) => `
        <tr>
          <td class="px-3 py-2 text-xs">${escape(s.hostname || '—')}</td>
          <td class="px-3 py-2 text-xs">${escape(s.platform || '—')}</td>
          <td class="px-3 py-2 text-xs text-slate-500">${dt(s.last_verified_at)}</td>
          <td class="px-3 py-2 text-xs">${s.deactivated_at ? '<span class="text-slate-400">已解绑</span>' : '<span class="text-green-700">在线</span>'}</td>
          <td class="px-3 py-2">${!s.deactivated_at ? `<button data-act="unbind-seat" data-key="${escape(key)}" data-fp="${escape(s.fingerprint)}" class="text-red-600 text-xs hover:text-red-700">解绑</button>` : ''}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="px-3 py-4 text-center text-slate-400 text-sm">还没有员工激活</td></tr>';
    openModal(`
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-semibold">激活记录</h3>
        <button id="seats-close" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <p class="text-xs text-slate-500 font-mono mb-3">${escape(key)}</p>
      <div class="border border-slate-200 rounded overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600 text-xs"><tr>
            <th class="px-3 py-2 text-left font-medium">主机名</th>
            <th class="px-3 py-2 text-left font-medium">系统</th>
            <th class="px-3 py-2 text-left font-medium">最近验证</th>
            <th class="px-3 py-2 text-left font-medium">状态</th>
            <th class="px-3 py-2 text-left font-medium"></th>
          </tr></thead>
          <tbody class="divide-y divide-slate-100">${seatsHtml}</tbody>
        </table>
      </div>
    `);
    $('seats-close').onclick = closeModal;
  }

  async function handleAction(act, btn) {
    const key = btn.dataset.key;
    if (act === 'copy-lic') {
      await window.NC.copy(key, btn);
    } else if (act === 'revoke-lic') {
      if (!confirm('确定吊销？被吊销后员工电脑会立即失去访问权限。')) return;
      const { status, json } = await api('POST', `/api/tenant/licenses/${key}/revoke`);
      if (status >= 400) alert('吊销失败：' + formatErr(json));
      await window.NC.tabs.refreshOverview?.();
      await loadLicenses();
    } else if (act === 'seats-lic') {
      await showSeats(key);
    } else if (act === 'unbind-seat') {
      if (!confirm('确定解绑这台机器？员工的 NetClaw Agent 将失去激活状态。')) return;
      const { status, json } = await api('POST', `/api/tenant/licenses/${key}/unbind`, { fingerprint: btn.dataset.fp });
      if (status >= 400) alert('解绑失败：' + formatErr(json));
      await window.NC.tabs.refreshOverview?.();
      closeModal();
      await loadLicenses();
    }
  }

  window.NC.licenses = {
    mount: async () => loadLicenses(),
    openCreate,
    handleAction
  };
})();
