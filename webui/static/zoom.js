/* WebUI font-zoom — Ctrl/Cmd +/-/0 with localStorage persistence.
 *
 * Loaded synchronously in <head> so the saved font-size is applied
 * before first paint (no flash of un-zoomed content). The keydown
 * listener attaches at DOMContentLoaded.
 */
(function () {
  'use strict';

  var KEY = 'netclaw.zoomLevel';
  var MIN = 0.7;
  var MAX = 2.5;
  var STEP = 1.1;

  function readZoom() {
    try {
      var v = parseFloat(localStorage.getItem(KEY) || '1');
      if (!isFinite(v) || v <= 0) return 1;
      return Math.min(Math.max(v, MIN), MAX);
    } catch (e) {
      return 1;
    }
  }

  function applyZoom(z) {
    document.documentElement.style.fontSize = (z * 16) + 'px';
  }

  function writeZoom(z) {
    try { localStorage.setItem(KEY, String(z)); } catch (e) { /* ignore */ }
  }

  // Apply early so layout uses the saved size on first paint.
  applyZoom(readZoom());

  function onKey(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    // Avoid stealing keys when the user is typing into a contenteditable
    // (some Monaco/CodeMirror instances trap their own Ctrl+ shortcuts).
    var t = e.target;
    if (t && (t.isContentEditable === true)) return;

    var z = readZoom();
    var key = e.key;
    if (key === '=' || key === '+') {
      z = Math.min(z * STEP, MAX);
    } else if (key === '-' || key === '_') {
      z = Math.max(z / STEP, MIN);
    } else if (key === '0') {
      z = 1;
    } else {
      return;
    }
    e.preventDefault();
    writeZoom(z);
    applyZoom(z);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.addEventListener('keydown', onKey);
    });
  } else {
    window.addEventListener('keydown', onKey);
  }

  // Expose for tests + DevTools tinkering.
  window.NCZoom = { read: readZoom, apply: applyZoom, write: writeZoom };
})();
