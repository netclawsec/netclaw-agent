/**
 * Shared 3-step chat-stream flow:
 *   1. /api/session/new (create) — only if no session_id provided
 *   2. POST /api/chat/start { session_id, message } -> { stream_id, session_id }
 *   3. GET  /api/chat/stream?stream_id=... -> SSE accumulates assistant tokens
 *
 * Usage:
 *   const ctl = await runChat({ message, model, onToken, onDone, onError })
 *   ctl.cancel()  // optional mid-stream cancel via /api/chat/cancel
 */

export interface RunChatOptions {
  /** If omitted, a new session is created via /api/session/new. */
  sessionId?: string;
  /** Required prompt text. */
  message: string;
  /** Optional model override forwarded to /api/chat/start. */
  model?: string;
  /** Optional workspace dir override forwarded to /api/chat/start. */
  workspace?: string;
  /** Called for each accumulated chunk of text. */
  onToken?: (token: string, totalText: string) => void;
  /** Called when the stream ends cleanly. */
  onDone?: (totalText: string, sessionId: string, streamId: string) => void;
  /** Called on any error. */
  onError?: (err: Error) => void;
}

export interface RunChatHandle {
  cancel: () => Promise<void>;
  /** Resolves to the streamId once /api/chat/start has returned. */
  streamIdPromise: Promise<string>;
}

function extractStreamText(event: string): string {
  // SSE event = one or more lines; "data:" lines carry payload.
  const lines = event.split(/\r?\n/);
  let out = "";
  for (const line of lines) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m) continue;
    const payload = m[1];
    if (payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (typeof obj === "string") out += obj;
      else if (obj && typeof obj.delta === "string") out += obj.delta;
      else if (obj && typeof obj.text === "string") out += obj.text;
      else if (obj && typeof obj.content === "string") out += obj.content;
    } catch {
      out += payload;
    }
  }
  return out;
}

export function runChat(opts: RunChatOptions): RunChatHandle {
  let streamIdResolve: (id: string) => void = () => undefined;
  let streamIdReject: (err: Error) => void = () => undefined;
  const streamIdPromise = new Promise<string>((resolve, reject) => {
    streamIdResolve = resolve;
    streamIdReject = reject;
  });
  let cancelled = false;
  let assignedStreamId: string | null = null;

  (async () => {
    try {
      let sessionId = opts.sessionId;
      if (!sessionId) {
        const ns = await fetch("/api/session/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts.workspace ? { workspace: opts.workspace } : {}),
        });
        if (!ns.ok) throw new Error(`session/new HTTP ${ns.status}`);
        const data = await ns.json();
        sessionId = data?.session?.session_id || data?.session?.id;
        if (!sessionId) throw new Error("session/new returned no id");
      }

      const startRes = await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message: opts.message,
          model: opts.model,
          workspace: opts.workspace,
        }),
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err?.error || `chat/start HTTP ${startRes.status}`);
      }
      const { stream_id } = await startRes.json();
      if (!stream_id) throw new Error("chat/start returned no stream_id");
      assignedStreamId = stream_id;
      streamIdResolve(stream_id);

      if (cancelled) return;

      const sseRes = await fetch(`/api/chat/stream?stream_id=${encodeURIComponent(stream_id)}`);
      if (!sseRes.ok || !sseRes.body) throw new Error(`stream HTTP ${sseRes.status}`);

      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let totalText = "";
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const token = extractStreamText(event);
            if (!token) continue;
            totalText += token;
            opts.onToken?.(token, totalText);
          }
        }
      } finally {
        // Release the underlying reader so the connection can close cleanly,
        // even if cancelled mid-stream or the user navigated away.
        try {
          await reader.cancel();
        } catch {
          // best effort
        }
      }
      if (!cancelled) opts.onDone?.(totalText, sessionId, stream_id);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      streamIdReject(err);
      opts.onError?.(err);
    }
  })();

  return {
    streamIdPromise,
    async cancel() {
      cancelled = true;
      if (assignedStreamId) {
        try {
          await fetch(`/api/chat/cancel?stream_id=${encodeURIComponent(assignedStreamId)}`, { method: "GET" });
        } catch {
          // best effort
        }
      }
    },
  };
}
