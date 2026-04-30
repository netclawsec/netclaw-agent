(function () {
  const { $, api, escape, dt, relTime, openModal, closeModal, formatErr, copy } = window.NC;

  // Builds whose status is one of these get polled. Once everyone has settled
  // we cancel the poll loop so the page doesn't burn CPU forever.
  const ACTIVE_STATUSES = new Set(['pending', 'building']);

  let pollHandle = null;

  function statusBadge(status) {
    if (status === 'succeeded') return '<span class="badge badge-green">已完成</span>';
    if (status === 'failed') return '<span class="badge badge-red">失败</span>';
    if (status === 'building') return '<span class="badge badge-blue">构建中</span>';
    return '<span class="badge badge-slate">排队中</span>';
  }

  function renderRow(b) {
    const tenantSlug = b.bundle_json?.tenant_slug || '—';
    const numDepts = (b.bundle_json?.departments || []).length;
    const ageInfo = b.completed_at
      ? `${dt(b.requested_at)} · 用时 ${formatDuration(b.requested_at, b.completed_at)}`
      : `${dt(b.requested_at)} · ${relTime(b.requested_at)}`;
    const downloadCell = (() => {
      if (b.status === 'succeeded' && b.download_url) {
        return `
          <button data-act="copy-installer-url" data-id="${escape(b.id)}" class="text-indigo-600 hover:text-indigo-700 text-sm">复制链接</button>
          <a href="${escape(b.download_url)}" target="_blank" rel="noopener" class="ml-2 text-sm text-slate-500 hover:text-slate-700">↗ 直接打开</a>
        `;
      }
      if (b.status === 'failed') {
        return `<button data-act="show-installer-error" data-id="${escape(b.id)}" class="text-red-600 hover:text-red-700 text-sm">查看错误</button>`;
      }
      return '<span class="text-xs text-slate-400">等待构建...</span>';
    })();
    return `
      <tr data-build-id="${escape(b.id)}">
        <td class="px-4 py-3 font-mono text-xs text-slate-600">${escape(b.id.slice(0, 8))}…</td>
        <td class="px-4 py-3 text-sm">
          <div class="font-medium">${escape(tenantSlug)}</div>
          <div class="text-xs text-slate-400">${numDepts} 个部门</div>
        </td>
        <td class="px-4 py-3">${statusBadge(b.status)}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${ageInfo}</td>
        <td class="px-4 py-3">${downloadCell}</td>
      </tr>
    `;
  }

  function formatDuration(startIso, endIso) {
    const ms = new Date(endIso) - new Date(startIso);
    if (!isFinite(ms) || ms < 0) return '—';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
  }

  // Cache the most recent list so handleAction (e.g. "show error" click) can
  // pull error/download_url without a fresh fetch.
  let lastBuilds = [];

  async function loadBuilds() {
    const { json } = await api('GET', '/api/tenant/installer/builds?limit=50');
    const tbody = $('builds-tbody');
    if (!tbody) return;
    lastBuilds = json.builds || [];
    if (lastBuilds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-12 text-center text-slate-400">还没有构建记录，点右上角"构建专属安装包"开始</td></tr>';
      stopPolling();
      return;
    }
    tbody.innerHTML = lastBuilds.map(renderRow).join('');
    const hasActive = lastBuilds.some((b) => ACTIVE_STATUSES.has(b.status));
    if (hasActive) startPolling();
    else stopPolling();
  }

  function startPolling() {
    if (pollHandle) return;
    // Poll every 5s while any build is pending/building. Stops itself once
    // the last active row settles.
    pollHandle = setInterval(() => {
      // If the user navigated away from the installers tab, suspend the poll
      // (the next mount() will restart it).
      if (!document.getElementById('tab-installers')?.classList.contains('active')) {
        stopPolling();
        return;
      }
      loadBuilds().catch((err) => console.error('poll failed', err));
    }, 5000);
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  function openCreate() {
    openModal(`
      <h3 class="text-lg font-semibold mb-4">构建专属安装包</h3>
      <div class="space-y-3 text-sm text-slate-700">
        <p>这会把当前所有 <strong>使用中</strong> 的部门 + 公司信息打包进一个 Windows 安装包，员工拿到后直接装即可，不用手填激活码。</p>
        <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-1 text-xs text-slate-600">
          <div><strong>构建时间</strong>：3-10 分钟（取决于队列）</div>
          <div><strong>下载链接</strong>：完成后这里会出现一个 24 小时签名 URL</div>
          <div><strong>历史版本</strong>：仍然可下载（90 天后自动清理）</div>
        </div>
        <details class="text-xs text-slate-500">
          <summary class="cursor-pointer hover:text-slate-700">高级：自定义 license server URL</summary>
          <div class="mt-2 space-y-1">
            <input id="ib-license-server" placeholder="https://license.netclawsec.com.cn (默认)" class="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono" />
            <p class="text-xs text-slate-400">留空走默认。这个 URL 会写进 bundle.json，员工客户端启动时调用。</p>
          </div>
        </details>
        <div id="ib-err" class="hidden text-sm text-red-600"></div>
      </div>
      <div class="flex justify-end gap-2 pt-4">
        <button type="button" id="ib-cancel" class="px-4 py-2 text-slate-600 hover:text-slate-900">取消</button>
        <button type="button" id="ib-submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">开始构建</button>
      </div>
    `);
    $('ib-cancel').onclick = closeModal;
    $('ib-submit').onclick = async () => {
      $('ib-submit').disabled = true;
      $('ib-submit').textContent = '提交中...';
      const body = {};
      const overrideUrl = $('ib-license-server').value.trim();
      if (overrideUrl) body.license_server = overrideUrl;
      const { status, json } = await api('POST', '/api/tenant/installer/builds', body);
      if (status >= 400) {
        $('ib-err').textContent = formatErr(json);
        $('ib-err').classList.remove('hidden');
        $('ib-submit').disabled = false;
        $('ib-submit').textContent = '开始构建';
        return;
      }
      closeModal();
      await loadBuilds();
    };
  }

  function showError(id) {
    const build = lastBuilds.find((b) => b.id === id);
    if (!build) return;
    openModal(`
      <h3 class="text-lg font-semibold mb-3">构建失败</h3>
      <div class="text-xs text-slate-500 mb-2 font-mono">${escape(build.id)}</div>
      <pre class="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700 max-h-96 overflow-auto whitespace-pre-wrap">${escape(build.error || '(没有错误信息)')}</pre>
      <div class="flex justify-end gap-2 pt-4">
        <button type="button" id="err-close" class="px-4 py-2 text-slate-600 hover:text-slate-900">关闭</button>
        <button type="button" id="err-retry" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">重新构建</button>
      </div>
    `);
    $('err-close').onclick = closeModal;
    $('err-retry').onclick = async () => {
      closeModal();
      // Re-enqueue without the override URL so the retry uses current defaults.
      const { status, json } = await api('POST', '/api/tenant/installer/builds', {});
      if (status >= 400) {
        alert('重试失败：' + formatErr(json));
        return;
      }
      await loadBuilds();
    };
  }

  async function copyUrl(id, btn) {
    const build = lastBuilds.find((b) => b.id === id);
    if (!build || !build.download_url) return;
    await copy(build.download_url, btn);
  }

  async function handleAction(act, btn) {
    const id = btn.dataset.id;
    if (act === 'copy-installer-url') return copyUrl(id, btn);
    if (act === 'show-installer-error') return showError(id);
  }

  window.NC.installers = {
    mount: async () => loadBuilds(),
    openCreate,
    handleAction
  };
})();
