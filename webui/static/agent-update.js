/* NetClaw Agent — installed-build self-update banner.
 *
 * Loads on every page render. Hits /api/agent-update/check; if a newer
 * version is published, renders a dismissible banner above the topbar
 * offering "Update now" / "Later". Force-update responses skip the
 * "Later" affordance and disable dismissal.
 *
 * No-op in dev mode / generic builds — the server returns
 * { available: false } and we render nothing.
 */
(function () {
  'use strict';

  var BANNER_ID = 'nc-update-banner';
  var DISMISS_KEY = 'netclaw.update.dismissed';
  var POLL_INTERVAL_MS = 30 * 60 * 1000; // re-check every 30 min while user is active

  function isDismissed(version) {
    try {
      return localStorage.getItem(DISMISS_KEY) === version;
    } catch (e) {
      return false;
    }
  }

  function setDismissed(version) {
    try { localStorage.setItem(DISMISS_KEY, version); } catch (e) { /* ignore */ }
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    var mb = bytes / 1024 / 1024;
    return mb < 100 ? mb.toFixed(1) + ' MB' : Math.round(mb) + ' MB';
  }

  function ensureBanner() {
    var existing = document.getElementById(BANNER_ID);
    if (existing) return existing;
    var div = document.createElement('div');
    div.id = BANNER_ID;
    div.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'z-index:9999',
      'background:linear-gradient(90deg,#0288A8,#03769C)',
      'color:#fff',
      'padding:10px 16px',
      'font-size:13px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:14px',
      'box-shadow:0 2px 6px rgba(0,0,0,.18)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    document.body.appendChild(div);
    return div;
  }

  function removeBanner() {
    var b = document.getElementById(BANNER_ID);
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function renderBanner(state) {
    var latest = state.latest || {};
    var ver = latest.version || '?';
    var size = fmtSize(latest.size_bytes);
    var changelog = (latest.changelog || '').slice(0, 120);

    var b = ensureBanner();
    b.innerHTML = '';

    var msg = document.createElement('div');
    msg.style.cssText = 'flex:1;text-align:center;line-height:1.4;';
    var headline = document.createElement('div');
    headline.innerHTML =
      '<strong>' + (state.force ? '需要立即更新' : '发现新版本') + ' v' +
      ver + '</strong>' + (size ? ' · ' + size : '');
    msg.appendChild(headline);
    if (changelog) {
      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:11px;opacity:.85;margin-top:2px;max-width:680px;margin-left:auto;margin-right:auto;';
      sub.textContent = changelog;
      msg.appendChild(sub);
    }
    b.appendChild(msg);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

    var update = document.createElement('button');
    update.textContent = '立刻更新';
    update.style.cssText = 'background:#fff;color:#0288A8;border:none;padding:6px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px;';
    update.onclick = function () { triggerUpdate(update); };
    actions.appendChild(update);

    if (!state.force) {
      var later = document.createElement('button');
      later.textContent = '稍后';
      later.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;';
      later.onclick = function () {
        setDismissed(ver);
        removeBanner();
      };
      actions.appendChild(later);
    }
    b.appendChild(actions);
  }

  function triggerUpdate(btn) {
    btn.disabled = true;
    btn.textContent = '正在下载...';
    fetch('/api/agent-update/apply', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json && json.ok) {
          // Server will exit shortly; show a holding screen.
          var b = document.getElementById(BANNER_ID);
          if (b) {
            b.innerHTML =
              '<div style="text-align:center;flex:1;">' +
              '<strong>正在安装新版本</strong> · 客户端会自动重启，约 30 秒。' +
              '</div>';
          }
          // Detect server going away; show a "click to relaunch" message.
          var probe = function () {
            fetch('/api/agent-update/check', { cache: 'no-cache' })
              .then(function () { setTimeout(probe, 2000); })
              .catch(function () {
                document.body.innerHTML =
                  '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;text-align:center;padding:40px;">' +
                  '<div><h2 style="margin-bottom:12px;">客户端正在更新</h2>' +
                  '<p style="color:#666;">大约 30 秒后窗口会自动重启。如果一分钟后还没重启，请手动启动 NetClaw Agent。</p>' +
                  '</div></div>';
              });
          };
          setTimeout(probe, 3000);
        } else {
          btn.disabled = false;
          btn.textContent = '立刻更新';
          alert('更新失败: ' + (json && json.error ? json.error : 'unknown'));
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = '立刻更新';
        alert('更新失败: ' + err);
      });
  }

  function check() {
    fetch('/api/agent-update/check', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (state) {
        if (!state || !state.available) {
          removeBanner();
          return;
        }
        if (!state.force && isDismissed(state.latest && state.latest.version)) {
          return;
        }
        renderBanner(state);
      })
      .catch(function () { /* offline / no license server — skip silently */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
  setInterval(check, POLL_INTERVAL_MS);
})();
