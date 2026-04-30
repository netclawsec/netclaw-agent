const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = './login.html'; throw new Error('unauthenticated'); }
  return { status: res.status, json };
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const dt = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

async function loadMe() {
  const { json } = await api('GET', '/api/auth/me');
  if (!json.success || json.admin.role !== 'super') {
    window.location.href = './tenant.html';
    return;
  }
  $('me-label').textContent = `${json.admin.username} · 超管`;
}

async function loadTenants() {
  const { json } = await api('GET', '/api/super/tenants');
  const tbody = $('tenants-tbody');
  if (!json.tenants?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-12 text-center text-slate-400">暂无客户公司，点右上角新建</td></tr>';
    return;
  }
  tbody.innerHTML = json.tenants.map((t) => `
    <tr>
      <td class="px-4 py-3 font-medium">${escape(t.name)}</td>
      <td class="px-4 py-3 text-slate-500 font-mono text-xs">${escape(t.slug)}</td>
      <td class="px-4 py-3"><span class="${t.seats_used >= t.seat_quota ? 'text-red-600' : 'text-slate-700'}">${t.seats_used}/${t.seat_quota}</span></td>
      <td class="px-4 py-3">${t.license_count}</td>
      <td class="px-4 py-3">${t.status === 'active'
        ? '<span class="text-green-700 bg-green-50 px-2 py-0.5 rounded text-xs">活跃</span>'
        : '<span class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs">已暂停</span>'}</td>
      <td class="px-4 py-3 text-slate-500 text-xs">${dt(t.created_at)}</td>
      <td class="px-4 py-3 space-x-3 text-sm">
        <button data-act="manage" data-id="${t.id}" class="text-indigo-600 hover:text-indigo-700">管理</button>
        <button data-act="toggle" data-id="${t.id}" data-status="${t.status}" class="text-slate-600 hover:text-slate-900">${t.status === 'active' ? '暂停' : '恢复'}</button>
      </td>
    </tr>
  `).join('');
}

function openModal(html) {
  $('modal-card').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

$('open-create-tenant').addEventListener('click', () => {
  openModal(`
    <h3 class="text-lg font-semibold mb-4">新建客户公司</h3>
    <form id="create-tenant-form" class="space-y-3">
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">公司名（中文）</label>
        <input id="ct-name" required class="w-full border border-slate-300 rounded px-3 py-2" placeholder="北京东方童" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">slug（英文短码，3-32 字符，可含 - ）</label>
        <input id="ct-slug" required pattern="^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$" class="w-full border border-slate-300 rounded px-3 py-2 font-mono text-xs" placeholder="dongfangtong" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">座位数（quota）</label>
        <input id="ct-quota" type="number" min="1" required class="w-full border border-slate-300 rounded px-3 py-2" placeholder="50" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-700 mb-1">备注（可选）</label>
        <textarea id="ct-notes" rows="2" class="w-full border border-slate-300 rounded px-3 py-2" placeholder="销售联系人 / 合同号 等"></textarea>
      </div>
      <div id="ct-err" class="hidden text-sm text-red-600"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="ct-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
        <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">创建</button>
      </div>
    </form>
  `);
  $('ct-cancel').onclick = closeModal;
  $('create-tenant-form').onsubmit = async (e) => {
    e.preventDefault();
    const { status, json } = await api('POST', '/api/super/tenants', {
      name: $('ct-name').value.trim(),
      slug: $('ct-slug').value.trim(),
      seat_quota: Number($('ct-quota').value),
      notes: $('ct-notes').value.trim() || undefined
    });
    if (status >= 400) {
      $('ct-err').textContent = json.error + (json.message ? '：' + json.message : '');
      $('ct-err').classList.remove('hidden');
      return;
    }
    closeModal();
    await loadTenants();
    openManageModal(json.tenant.id);
  };
});

async function openManageModal(tenant_id) {
  const { json } = await api('GET', `/api/super/tenants/${tenant_id}`);
  if (!json.success) return;
  const t = json.tenant;
  const adminsHtml = json.admins.length
    ? json.admins.map((a) => `
      <tr>
        <td class="px-3 py-2 font-mono text-xs">${escape(a.username)}</td>
        <td class="px-3 py-2 text-slate-500 text-xs">${escape(a.display_name || '—')}</td>
        <td class="px-3 py-2"><span class="text-xs ${a.status === 'active' ? 'text-green-700' : 'text-slate-400'}">${a.status === 'active' ? '活跃' : '禁用'}</span></td>
        <td class="px-3 py-2 text-xs text-slate-500">${dt(a.last_login_at)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400 text-sm">暂无管理员</td></tr>';

  openModal(`
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold">${escape(t.name)} <span class="font-mono text-xs text-slate-400">${escape(t.slug)}</span></h3>
      <button id="mg-close" class="text-slate-400 hover:text-slate-600">✕</button>
    </div>

    <div class="grid grid-cols-3 gap-2 mb-4 text-center text-sm">
      <div class="bg-slate-50 rounded py-2"><div class="text-xs text-slate-500">座位用量</div><div class="font-semibold">${t.seats_used}/${t.seat_quota}</div></div>
      <div class="bg-slate-50 rounded py-2"><div class="text-xs text-slate-500">License 数</div><div class="font-semibold">${json.licenses.length}</div></div>
      <div class="bg-slate-50 rounded py-2"><div class="text-xs text-slate-500">状态</div><div class="font-semibold">${t.status === 'active' ? '活跃' : '已暂停'}</div></div>
    </div>

    <h4 class="text-sm font-semibold mt-4 mb-2 text-slate-700">公司管理员</h4>
    <div class="border border-slate-200 rounded overflow-hidden">
      <table class="w-full text-sm"><thead class="bg-slate-50 text-slate-600 text-xs"><tr>
        <th class="px-3 py-2 text-left font-medium">用户名</th>
        <th class="px-3 py-2 text-left font-medium">显示名</th>
        <th class="px-3 py-2 text-left font-medium">状态</th>
        <th class="px-3 py-2 text-left font-medium">最近登录</th>
      </tr></thead><tbody class="divide-y divide-slate-100">${adminsHtml}</tbody></table>
    </div>

    <form id="add-admin-form" class="mt-4 bg-slate-50 rounded p-3 space-y-2">
      <div class="text-sm font-medium text-slate-700">添加管理员</div>
      <div class="grid grid-cols-2 gap-2">
        <input id="aa-user" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_.\\-]+" class="border border-slate-300 rounded px-2 py-1 text-sm" placeholder="用户名 (3-32)" />
        <input id="aa-pass" required minlength="8" type="text" class="border border-slate-300 rounded px-2 py-1 text-sm" placeholder="初始密码 (≥8)" />
        <input id="aa-name" maxlength="100" class="border border-slate-300 rounded px-2 py-1 text-sm col-span-2" placeholder="显示名（可选，如：王经理）" />
      </div>
      <div id="aa-err" class="hidden text-xs text-red-600"></div>
      <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-sm">添加</button>
    </form>

    <h4 class="text-sm font-semibold mt-4 mb-2 text-slate-700">配额</h4>
    <form id="quota-form" class="flex items-center gap-2">
      <input id="qf-quota" type="number" min="0" value="${t.seat_quota}" class="border border-slate-300 rounded px-2 py-1 text-sm w-32" />
      <button type="submit" class="bg-slate-700 hover:bg-slate-900 text-white px-3 py-1 rounded text-sm">更新座位上限</button>
      <span id="qf-msg" class="text-xs text-slate-500"></span>
    </form>
  `);
  $('mg-close').onclick = closeModal;
  $('add-admin-form').onsubmit = async (e) => {
    e.preventDefault();
    const { status, json: r } = await api('POST', `/api/super/tenants/${tenant_id}/admins`, {
      username: $('aa-user').value.trim(),
      password: $('aa-pass').value,
      display_name: $('aa-name').value.trim() || undefined
    });
    if (status >= 400) {
      $('aa-err').textContent = r.error + (r.message ? '：' + r.message : '');
      $('aa-err').classList.remove('hidden');
      return;
    }
    openManageModal(tenant_id);
  };
  $('quota-form').onsubmit = async (e) => {
    e.preventDefault();
    const { status } = await api('PATCH', `/api/super/tenants/${tenant_id}`, {
      seat_quota: Number($('qf-quota').value)
    });
    $('qf-msg').textContent = status < 400 ? '已更新' : '更新失败';
    setTimeout(() => loadTenants(), 200);
  };
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'manage') {
    openManageModal(id);
  } else if (btn.dataset.act === 'toggle') {
    const next = btn.dataset.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`确定要${next === 'suspended' ? '暂停' : '恢复'}这个租户吗？暂停会让所有员工立即失去访问权限。`)) return;
    await api('PATCH', `/api/super/tenants/${id}`, { status: next });
    loadTenants();
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout');
  window.location.href = './login.html';
});

(async () => { await loadMe(); await loadTenants(); })();
