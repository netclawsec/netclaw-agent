/**
 * Thin wrapper around fetch() that:
 *   - Always sends/parses JSON
 *   - Returns a typed { ok, data, error, status } envelope (never throws on
 *     HTTP errors, only on network failure)
 *   - Keeps non-200 errors readable for the caller (so pages can show a
 *     real error toast instead of silently rendering empty state)
 *
 * Migrating from raw fetch:
 *   const r = await fetch("/api/foo");
 *   if (!r.ok) return;
 *   const data = await r.json();
 *
 * becomes:
 *   const { ok, data, error } = await fetchJson<FooData>("/api/foo");
 *   if (!ok) { showToast(error); return; }
 *   // use data
 */

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export interface FetchJsonOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Extra headers; Authorization etc. */
  headers?: Record<string, string>;
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<FetchJsonResult<T>> {
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
    signal: opts.signal,
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    const err = e as Error;
    return { ok: false, status: 0, data: null, error: err.message || "网络错误" };
  }

  let parsed: unknown = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      parsed = await resp.json();
    } catch {
      parsed = null;
    }
  } else {
    // Best-effort: read body as text so we can surface non-JSON errors
    try {
      const text = await resp.text();
      parsed = text ? { error: text.slice(0, 200) } : null;
    } catch {
      parsed = null;
    }
  }

  if (!resp.ok) {
    const errPayload = (parsed as { error?: string; detail?: string; message?: string }) || {};
    const error =
      errPayload.error || errPayload.detail || errPayload.message || `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, data: null, error };
  }

  return { ok: true, status: resp.status, data: (parsed as T) ?? null, error: null };
}

/** Convenience: throw on error. Use only when callers genuinely can't recover. */
export async function fetchJsonOrThrow<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const res = await fetchJson<T>(url, opts);
  if (!res.ok || res.data === null) {
    throw new Error(res.error || `request failed: ${url}`);
  }
  return res.data;
}
