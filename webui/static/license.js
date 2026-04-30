// NetClaw Agent — license pane widget (WebUI)
// Renders into #licensePaneBody inside Settings → License.
// Talks to /api/license (GET / activate / deactivate / verify).

const _LICENSE = { info: null, loading: false, error: null };

function _licenseEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _licenseFormatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch { return String(iso); }
}

function _licenseRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function _licensePill(text, variant) {
  const palette = {
    ok:    'background:rgba(52,211,153,0.15);color:#34d399;border:1px solid rgba(52,211,153,0.35)',
    warn:  'background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.35)',
    bad:   'background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.35)',
    muted: 'background:rgba(148,163,184,0.12);color:var(--muted);border:1px solid var(--border2)'
  };
  const style = palette[variant] || palette.muted;
  return `<span style="${style};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">${_licenseEscape(text)}</span>`;
}

function _licenseDaysPill(days) {
  if (days == null) return _licensePill('unknown', 'muted');
  if (days < 0)    return _licensePill(`expired ${Math.abs(days)}d ago`, 'bad');
  if (days <= 7)   return _licensePill(`${days} 天剩余`, 'warn');
  return _licensePill(`${days} 天剩余`, 'ok');
}

function _licenseProgress(days, totalDays) {
  if (days == null || days < 0 || !totalDays || totalDays <= 0) return '';
  const pct = Math.max(0, Math.min(100, Math.round((days / totalDays) * 100)));
  const fillColor = days <= 7 ? '#f59e0b' : '#34d399';
  return `
    <div style="background:var(--code-bg);height:6px;border-radius:3px;overflow:hidden;margin-top:6px">
      <div style="width:${pct}%;height:100%;background:${fillColor};transition:width 200ms"></div>
    </div>
  `;
}

async function _licenseFetch(path, body) {
  const opts = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(path, opts);
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

async function licenseRefresh() {
  _LICENSE.loading = true;
  _LICENSE.error = null;
  renderLicensePane();
  const { ok, data } = await _licenseFetch('api/license');
  _LICENSE.loading = false;
  if (!ok) {
    _LICENSE.error = data.error || 'fetch_failed';
  } else {
    _LICENSE.info = data;
  }
  renderLicensePane();
}

async function licenseActivate() {
  const input = document.getElementById('licenseKeyInput');
  const key = (input && input.value ? input.value : '').trim();
  if (!key) {
    _LICENSE.error = 'license_key is required';
    renderLicensePane();
    return;
  }
  _LICENSE.loading = true;
  renderLicensePane();
  const { ok, data } = await _licenseFetch('api/license/activate', { license_key: key });
  _LICENSE.loading = false;
  if (!ok) {
    _LICENSE.error = data.error || 'activation_failed';
  } else {
    _LICENSE.info = data;
    _LICENSE.error = null;
  }
  renderLicensePane();
}

async function licenseDeactivate() {
  if (!confirm('Deactivate this machine? The seat will be released and you will need to re-activate to use the agent.')) return;
  _LICENSE.loading = true;
  renderLicensePane();
  const { ok, data } = await _licenseFetch('api/license/deactivate', {});
  _LICENSE.loading = false;
  if (!ok) {
    _LICENSE.error = data.error || 'deactivation_failed';
  } else {
    _LICENSE.info = data;
    _LICENSE.error = null;
  }
  renderLicensePane();
}

async function licenseVerify() {
  _LICENSE.loading = true;
  renderLicensePane();
  const { ok, data } = await _licenseFetch('api/license/verify', {});
  _LICENSE.loading = false;
  if (!ok) {
    _LICENSE.error = data.error || 'verify_failed';
  } else {
    _LICENSE.info = data;
    _LICENSE.error = null;
  }
  renderLicensePane();
}

function _renderActivateForm(showError) {
  const errBlock = showError && _LICENSE.error
    ? `<div style="color:#ef4444;font-size:12px;margin-top:8px">${_licenseEscape(_LICENSE.error)}</div>`
    : '';
  return `
    <div style="padding:16px;border:1px dashed var(--border2);border-radius:10px;background:rgba(255,255,255,0.02)">
      <div style="font-weight:600;margin-bottom:6px">未激活 · No license installed</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
        粘贴 <code style="background:var(--code-bg);padding:1px 4px;border-radius:3px">NCLW-XXXXX-XXXXX-XXXXX-XXXXX</code> 激活码激活本机。
      </div>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input id="licenseKeyInput" type="text" placeholder="NCLW-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false"
               style="flex:1;background:var(--code-bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:8px 10px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
        <button class="cron-btn run" onclick="licenseActivate()" style="padding:6px 14px">Activate</button>
      </div>
      ${errBlock}
    </div>
  `;
}

function renderLicensePane() {
  const host = document.getElementById('licensePaneBody');
  if (!host) return;
  if (_LICENSE.loading && !_LICENSE.info) {
    host.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading...</div>';
    return;
  }

  const info = _LICENSE.info;
  if (!info) {
    host.innerHTML = _renderActivateForm(true);
    return;
  }

  if (info.status === 'unlicensed') {
    host.innerHTML = _renderActivateForm(true);
    return;
  }

  const days = info.days_remaining;
  let totalDays = null;
  if (info.activated_at && info.license_expires_at) {
    const span = (new Date(info.license_expires_at).getTime() - new Date(info.activated_at).getTime()) / 86400000;
    totalDays = span > 0 ? Math.round(span) : null;
  }
  const progress = _licenseProgress(days, totalDays);
  const plan = info.plan || 'unknown';
  const seats = info.seats != null ? info.seats : 1;
  const key = info.license_key || '';
  const displayKey = key.length > 16 ? key.slice(0, 9) + '…' + key.slice(-5) : key;
  const graceMark = info.within_offline_grace ? _licensePill('online', 'ok') : _licensePill('grace expired', 'bad');

  const errBlock = _LICENSE.error
    ? `<div style="color:#ef4444;font-size:12px;margin:8px 0">${_licenseEscape(_LICENSE.error)}</div>`
    : '';

  host.innerHTML = `
    ${errBlock}
    <div style="border:1px solid var(--border2);border-radius:12px;padding:16px;background:rgba(255,255,255,0.02)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;gap:8px;align-items:center">
          ${_licensePill('active', 'ok')}
          ${_licensePill(plan, 'muted')}
          ${_licensePill(`${seats} seats`, 'muted')}
        </div>
        ${_licenseDaysPill(days)}
      </div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted);margin-bottom:4px">
        ${_licenseEscape(displayKey)}
      </div>
      <div style="font-size:12px;color:var(--muted)">
        到期：${_licenseEscape(_licenseFormatDate(info.license_expires_at))}
      </div>
      ${progress}
    </div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px;font-size:12px">
      <div><div style="color:var(--muted);margin-bottom:2px">Activated</div><div>${_licenseEscape(_licenseFormatDate(info.activated_at))}</div></div>
      <div><div style="color:var(--muted);margin-bottom:2px">Last verified</div><div>${_licenseEscape(_licenseFormatDate(info.last_verified_at))} <span style="color:var(--muted)">(${_licenseEscape(_licenseRelative(info.last_verified_at))})</span></div></div>
      <div><div style="color:var(--muted);margin-bottom:2px">Fingerprint</div><div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px">${_licenseEscape((info.fingerprint || '').slice(0, 16))}…</div></div>
      <div><div style="color:var(--muted);margin-bottom:2px">Connectivity</div><div>${graceMark}</div></div>
    </div>

    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="cron-btn run" onclick="licenseVerify()" style="padding:6px 14px">Re-verify now</button>
      <button class="cron-btn" onclick="licenseDeactivate()" style="padding:6px 14px">Deactivate this seat</button>
    </div>
  `;
}

// ─── Top-bar chip ─────────────────────────────────────────────────────────
// Always-visible badge in the main UI topbar showing "网钳科技 · 剩余 N 天".
// Clicking it opens Settings → License. Refreshes on load + every 5 minutes.

const LICENSE_VENDOR = '网钳科技';

function _renderLicenseChip(info) {
  const chip = document.getElementById('licenseChip');
  const text = document.getElementById('licenseChipText');
  if (!chip || !text) return;

  chip.style.display = 'inline-flex';

  if (!info || info.status === 'unlicensed') {
    text.innerHTML = `<span style="opacity:.85">${LICENSE_VENDOR}</span> · <span style="color:#f59e0b">未激活</span>`;
    chip.style.borderColor = 'rgba(245,158,11,0.35)';
    chip.style.background = 'rgba(245,158,11,0.08)';
    chip.title = '未激活 · 点击输入激活码';
    return;
  }

  const days = info.days_remaining;
  let label, borderColor, bgColor;
  if (days == null) {
    label = `<span style="color:var(--muted)">状态未知</span>`;
    borderColor = 'var(--border2)';
    bgColor = 'transparent';
  } else if (days < 0) {
    label = `<span style="color:#ef4444">已过期 ${Math.abs(days)} 天</span>`;
    borderColor = 'rgba(239,68,68,0.4)';
    bgColor = 'rgba(239,68,68,0.08)';
  } else if (days <= 7) {
    label = `<span style="color:#f59e0b">剩余 ${days} 天</span>`;
    borderColor = 'rgba(245,158,11,0.4)';
    bgColor = 'rgba(245,158,11,0.08)';
  } else {
    label = `<span style="color:#34d399">剩余 ${days} 天</span>`;
    borderColor = 'rgba(52,211,153,0.35)';
    bgColor = 'rgba(52,211,153,0.06)';
  }

  const plan = info.plan ? ` · ${_licenseEscape(info.plan)}` : '';
  text.innerHTML = `<span style="opacity:.85">${LICENSE_VENDOR}</span>${plan} · ${label}`;
  chip.style.borderColor = borderColor;
  chip.style.background = bgColor;
  chip.title = `授权方：${LICENSE_VENDOR}\n到期：${info.license_expires_at || '(未知)'}\n点击打开 License 面板`;
}

async function licenseSyncChip() {
  try {
    const { ok, data } = await _licenseFetch('api/license');
    if (!ok) {
      _renderLicenseChip(null);
      return;
    }
    _LICENSE.info = data;
    _renderLicenseChip(data);
  } catch {
    _renderLicenseChip(null);
  }
}

function openLicensePane() {
  if (typeof toggleSettings === 'function') {
    const overlay = document.getElementById('settingsOverlay');
    const isHidden = !overlay || overlay.style.display === 'none';
    if (isHidden) toggleSettings();
  }
  if (typeof switchSettingsSection === 'function') {
    switchSettingsSection('license');
  }
}

// Keep chip in sync after any pane mutation
const _origRender = renderLicensePane;
renderLicensePane = function () {
  _origRender();
  if (_LICENSE.info) _renderLicenseChip(_LICENSE.info);
};

// Auto-sync on boot + every 5 min
(function _scheduleLicenseChipSync() {
  const boot = () => {
    licenseSyncChip();
    setInterval(licenseSyncChip, 5 * 60 * 1000);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// Export for settings panel bootstrap
window.licenseRefresh = licenseRefresh;
window.licenseActivate = licenseActivate;
window.licenseDeactivate = licenseDeactivate;
window.licenseVerify = licenseVerify;
window.renderLicensePane = renderLicensePane;
window.licenseSyncChip = licenseSyncChip;
window.openLicensePane = openLicensePane;
