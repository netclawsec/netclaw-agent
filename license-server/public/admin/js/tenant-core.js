// Shared core for tenant admin tabs. Exposes window.NC.* utilities; never
// touches DOM beyond the modal helpers. Each tab module owns its own DOM.
window.NC = window.NC || {};

const NC = window.NC;

NC.$ = (id) => document.getElementById(id);

NC.api = async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = './login.html';
    throw new Error('unauth');
  }
  return { status: res.status, json };
};

NC.escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

NC.dt = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
NC.dateOnly = (iso) => iso ? new Date(iso).toLocaleDateString('zh-CN') : '—';

NC.relTime = (iso) => {
  if (!iso) return '—';
  const diffMs = new Date(iso) - new Date();
  const absMin = Math.abs(diffMs) / 60000;
  if (absMin < 1) return diffMs >= 0 ? '<1分钟' : '刚刚';
  if (absMin < 60) return `${Math.round(absMin)}分钟${diffMs >= 0 ? '后' : '前'}`;
  if (absMin < 60 * 24) return `${Math.round(absMin / 60)}小时${diffMs >= 0 ? '后' : '前'}`;
  return `${Math.round(absMin / 60 / 24)}天${diffMs >= 0 ? '后' : '前'}`;
};

NC.openModal = (html) => {
  NC.$('modal-card').innerHTML = html;
  NC.$('modal').classList.remove('hidden');
};

NC.closeModal = () => NC.$('modal').classList.add('hidden');

NC.copy = async (text, btn) => {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => (btn.textContent = orig), 1200);
    }
  } catch {
    if (btn) btn.textContent = '复制失败';
  }
};

NC.errToast = (msg) => alert(msg);

NC.formatErr = (json) => {
  if (!json) return '请求失败';
  const code = json.error || 'unknown_error';
  return json.message ? `${code}：${json.message}` : code;
};

// Cached resources shared across tabs (so dept dropdowns don't flicker every
// time a tab is mounted). Tabs that mutate departments call NC.invalidate('departments').
NC.cache = { departments: null };

NC.getDepartments = async function getDepartments({ force = false } = {}) {
  if (NC.cache.departments && !force) return NC.cache.departments;
  const { json } = await NC.api('GET', '/api/tenant/departments');
  NC.cache.departments = json.departments || [];
  return NC.cache.departments;
};

NC.invalidate = (key) => { NC.cache[key] = null; };
