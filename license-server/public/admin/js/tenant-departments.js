(function () {
  const { $, api, escape, dt, openModal, closeModal, formatErr, invalidate } = window.NC;

  function statusBadge(status) {
    return status === 'archived'
      ? '<span class="badge badge-slate">已归档</span>'
      : '<span class="badge badge-green">使用中</span>';
  }

  async function loadDepartments() {
    const { json } = await api('GET', '/api/tenant/departments');
    invalidate('departments');
    const tbody = $('depts-tbody');
    if (!json.departments?.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-12 text-center text-slate-400">还没有部门，先建一个吧</td></tr>';
      return;
    }
    tbody.innerHTML = json.departments.map((d) => `
      <tr>
        <td class="px-4 py-3 font-medium">${escape(d.name)}</td>
        <td class="px-4 py-3 font-mono text-xs">${escape(d.abbrev)}</td>
        <td class="px-4 py-3">${statusBadge(d.status)}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${dt(d.created_at)}</td>
        <td class="px-4 py-3 space-x-2 text-sm">
          <button data-act="edit-dept" data-id="${escape(d.id)}" class="text-indigo-600 hover:text-indigo-700">编辑</button>
          ${d.status === 'active'
            ? `<button data-act="archive-dept" data-id="${escape(d.id)}" class="text-amber-600 hover:text-amber-700">归档</button>`
            : `<button data-act="activate-dept" data-id="${escape(d.id)}" class="text-green-600 hover:text-green-700">启用</button>`}
          <button data-act="delete-dept" data-id="${escape(d.id)}" class="text-red-600 hover:text-red-700">删除</button>
        </td>
      </tr>
    `).join('');
  }

  function openCreate() {
    openModal(`
      <h3 class="text-lg font-semibold mb-4">新增部门</h3>
      <form id="dc-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">中文名</label>
          <input id="dc-name" required maxlength="40" class="w-full border border-slate-300 rounded px-3 py-2" placeholder="研发部" />
          <p class="text-xs text-slate-500 mt-1">≤ 40 字符，租户内不可重名</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">英文缩写</label>
          <input id="dc-abbrev" required class="w-full border border-slate-300 rounded px-3 py-2 font-mono" placeholder="dev" pattern="[a-z0-9]{2,8}" />
          <p class="text-xs text-slate-500 mt-1">2-8 位小写字母/数字。会用作 username 前缀（<code class="bg-slate-100 px-1 rounded">dev-zhangsan</code>）</p>
        </div>
        <div id="dc-err" class="hidden text-sm text-red-600"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="dc-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">创建</button>
        </div>
      </form>
    `);
    $('dc-cancel').onclick = closeModal;
    $('dc-form').onsubmit = async (e) => {
      e.preventDefault();
      const { status, json } = await api('POST', '/api/tenant/departments', {
        name: $('dc-name').value.trim(),
        abbrev: $('dc-abbrev').value.trim()
      });
      if (status >= 400) {
        $('dc-err').textContent = formatErr(json);
        $('dc-err').classList.remove('hidden');
        return;
      }
      closeModal();
      await loadDepartments();
    };
  }

  async function openEdit(id) {
    const { json } = await api('GET', '/api/tenant/departments');
    const dept = (json.departments || []).find((d) => d.id === id);
    if (!dept) { alert('部门不存在'); return; }
    openModal(`
      <h3 class="text-lg font-semibold mb-4">编辑部门</h3>
      <form id="de-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">中文名</label>
          <input id="de-name" maxlength="40" value="${escape(dept.name)}" class="w-full border border-slate-300 rounded px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">英文缩写</label>
          <input id="de-abbrev" pattern="[a-z0-9]{2,8}" value="${escape(dept.abbrev)}" class="w-full border border-slate-300 rounded px-3 py-2 font-mono" />
          <p class="text-xs text-amber-600 mt-1">⚠️ 改缩写不会重命名已存在员工的 username（保持原样）。</p>
        </div>
        <div id="de-err" class="hidden text-sm text-red-600"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="de-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">保存</button>
        </div>
      </form>
    `);
    $('de-cancel').onclick = closeModal;
    $('de-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = {};
      const newName = $('de-name').value.trim();
      const newAbbrev = $('de-abbrev').value.trim();
      if (newName !== dept.name) body.name = newName;
      if (newAbbrev !== dept.abbrev) body.abbrev = newAbbrev;
      if (Object.keys(body).length === 0) { closeModal(); return; }
      const { status, json: resp } = await api('PATCH', `/api/tenant/departments/${id}`, body);
      if (status >= 400) {
        $('de-err').textContent = formatErr(resp);
        $('de-err').classList.remove('hidden');
        return;
      }
      closeModal();
      await loadDepartments();
    };
  }

  async function setStatus(id, status) {
    const { status: s, json } = await api('PATCH', `/api/tenant/departments/${id}`, { status });
    if (s >= 400) alert('操作失败：' + formatErr(json));
    await loadDepartments();
  }

  async function deleteDept(id) {
    if (!confirm('确定删除这个部门？\n\n如果还有任何员工记录或未使用的邀请码挂在这个部门下，删除会被拒绝。')) return;
    const { status, json } = await api('DELETE', `/api/tenant/departments/${id}`);
    if (status >= 400) {
      alert('删除失败：' + formatErr(json));
      return;
    }
    await loadDepartments();
  }

  async function handleAction(act, btn) {
    const id = btn.dataset.id;
    if (act === 'edit-dept') return openEdit(id);
    if (act === 'archive-dept') return setStatus(id, 'archived');
    if (act === 'activate-dept') return setStatus(id, 'active');
    if (act === 'delete-dept') return deleteDept(id);
  }

  window.NC.departments = {
    mount: async () => loadDepartments(),
    openCreate,
    handleAction
  };
})();
