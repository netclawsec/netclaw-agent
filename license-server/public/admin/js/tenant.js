const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = './login.html'; throw new Error('unauth'); }
  return { status: res.status, json };
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const dt = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
const dateOnly = (iso) => iso ? new Date(iso).toLocaleDateString('zh-CN') : '—';

function openModal(html) { $('modal-card').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }

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
}

async function loadLicenses() {
  const { json } = await api('GET', '/api/tenant/licenses');
  const tbody = $('licenses-tbody');
  if (!json.licenses?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-slate-400">还没有 License，点右上角为员工生成</td></tr>';
    return;
  }
  tbody.innerHTML = json.licenses.map((l) => {
    const expired = new Date(l.expires_at) < new Date();
    return `
    <tr>
      <td class="px-4 py-3 font-mono text-xs">
        <div class="flex items-center gap-2">
          <span>${escape(l.license_key)}</span>
          <button data-act="copy" data-key="${escape(l.license_key)}" class="text-indigo-600 hover:text-indigo-700 text-xs">复制</button>
        </div>
      </td>
      <td class="px-4 py-3">${escape(l.customer_name)}</td>
      <td class="px-4 py-3">${l.active_seats || 0}/${l.seats}</td>
      <td class="px-4 py-3">
        ${l.status === 'revoked'
          ? '<span class="text-red-700 bg-red-50 px-2 py-0.5 rounded text-xs">已吊销</span>'
          : expired
            ? '<span class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs">已过期</span>'
            : '<span class="text-green-700 bg-green-50 px-2 py-0.5 rounded text-xs">有效</span>'}
      </td>
      <td class="px-4 py-3 text-xs text-slate-500">${dateOnly(l.expires_at)}</td>
      <td class="px-4 py-3 space-x-2 text-sm">
        <button data-act="renew" data-key="${escape(l.license_key)}" class="text-indigo-600 hover:text-indigo-700">续期</button>
        ${l.status !== 'revoked' ? `<button data-act="revoke" data-key="${escape(l.license_key)}" class="text-red-600 hover:text-red-700">吊销</button>` : ''}
        <button data-act="seats" data-key="${escape(l.license_key)}" class="text-slate-600 hover:text-slate-900">查看激活</button>
      </td>
    </tr>`;
  }).join('');
}

$('open-create-license').addEventListener('click', () => {
  openModal(`
    <h3 class="text-lg font-semibold mb-4">为员工生成 License</h3>
    <form id="cl-form" class="space-y-3">
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">备注/员工姓名</label>
        <input id="cl-name" required maxlength="100" class="w-full border border-slate-300 rounded px-3 py-2" placeholder="王五（市场部）" />
        <p class="text-xs text-slate-500 mt-1">这个备注只你能看到，方便区分给了谁</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">有效期</label>
          <select id="cl-months" class="w-full border border-slate-300 rounded px-3 py-2">
            <option value="1">1 个月</option>
            <option value="3">3 个月</option>
            <option value="6" selected>6 个月</option>
            <option value="12">12 个月</option>
            <option value="24">24 个月</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">座位数</label>
          <input id="cl-seats" type="number" min="1" max="100" value="1" class="w-full border border-slate-300 rounded px-3 py-2" />
          <p class="text-xs text-slate-500 mt-1">通常一人一座</p>
        </div>
      </div>
      <div id="cl-err" class="hidden text-sm text-red-600"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="cl-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
        <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">生成</button>
      </div>
    </form>
  `);
  $('cl-cancel').onclick = closeModal;
  $('cl-form').onsubmit = async (e) => {
    e.preventDefault();
    const { status, json } = await api('POST', '/api/tenant/licenses', {
      customer_name: $('cl-name').value.trim(),
      months: Number($('cl-months').value),
      seats: Number($('cl-seats').value)
    });
    if (status >= 400) {
      $('cl-err').textContent = json.error + (json.message ? '：' + json.message : '');
      $('cl-err').classList.remove('hidden');
      return;
    }
    openModal(`
      <h3 class="text-lg font-semibold mb-3">License 已生成 ✓</h3>
      <p class="text-sm text-slate-600 mb-2">复制下面的 key 发给员工，让他在 NetClaw Agent 首次启动时粘贴：</p>
      <div class="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-sm break-all">${escape(json.license.license_key)}</div>
      <div class="flex justify-end gap-2 pt-4">
        <button id="ok-copy" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">复制并关闭</button>
      </div>
    `);
    $('ok-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(json.license.license_key); } catch {}
      closeModal();
      await loadDashboard();
      await loadLicenses();
    };
  };
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const key = btn.dataset.key;
  const act = btn.dataset.act;
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(key); btn.textContent = '已复制'; setTimeout(() => (btn.textContent = '复制'), 1200); } catch {}
  } else if (act === 'renew') {
    const months = prompt('续期多少个月？', '6');
    if (!months) return;
    const { status, json } = await api('POST', `/api/tenant/licenses/${key}/renew`, { months: Number(months) });
    if (status >= 400) alert('续期失败：' + (json.error || ''));
    await loadLicenses();
  } else if (act === 'revoke') {
    if (!confirm('确定吊销？被吊销后员工电脑会立即失去访问权限。')) return;
    const { status } = await api('POST', `/api/tenant/licenses/${key}/revoke`);
    if (status >= 400) alert('吊销失败');
    await loadDashboard();
    await loadLicenses();
  } else if (act === 'seats') {
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
  } else if (act === 'unbind-seat') {
    if (!confirm('确定解绑这台机器？员工的 NetClaw Agent 将失去激活状态。')) return;
    const { status } = await api('POST', `/api/tenant/licenses/${key}/unbind`, { fingerprint: btn.dataset.fp });
    if (status >= 400) alert('解绑失败');
    await loadDashboard();
    closeModal();
    await loadLicenses();
  }
});

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
      $('pw-err').textContent = json.error || '修改失败';
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

(async () => { await loadMe(); await loadDashboard(); await loadLicenses(); })();
