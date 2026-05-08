/**
 * Open a URL in the user's default system browser.
 *
 * Inside the packaged Mac/Win app the SPA runs in pywebview, where
 * `window.open(url)` for cross-origin URLs is a no-op. pywebview exposes a
 * Python bridge via `window.pywebview.api.open_external(url)` that calls
 * `webbrowser.open()` server-side.
 *
 * In a regular browser (dev / pnpm dev) we just call window.open as usual.
 */

interface PyWebviewApi {
  open_external?: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    pywebview?: { api?: PyWebviewApi };
  }
}

export function openExternal(url: string): void {
  if (!url) return;
  // Try the pywebview bridge first.
  const bridge = window.pywebview?.api?.open_external;
  if (typeof bridge === "function") {
    void bridge(url).catch(() => {
      // Fall back if the bridge errors out at runtime.
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return;
  }
  // Regular browser path.
  window.open(url, "_blank", "noopener,noreferrer");
}
