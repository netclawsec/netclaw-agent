import { useCallback, useRef, useState } from "react";
import { runChat, type RunChatHandle } from "./chat";

export interface MediaItem {
  url: string;
  rawPath: string;
  ext: string;
  kind: "image" | "video";
}

const MEDIA_EXT = ["mp4", "webm", "mov", "png", "jpg", "jpeg", "gif", "webp"];
// Match absolute POSIX paths or ~/... paths ending in a media extension. The
// match runs over assistant text, so we keep it conservative — quoted/whitespace
// boundaries on either side of the path.
const PATH_REGEX = new RegExp(
  `(~?/[^\\s'"<>\`)\\]]+\\.(?:${MEDIA_EXT.join("|")}))`,
  "gi",
);

function isVideoExt(ext: string): boolean {
  return ["mp4", "webm", "mov"].includes(ext);
}

export function extractMediaFromText(text: string): MediaItem[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const match of text.matchAll(PATH_REGEX)) {
    const raw = match[1];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const ext = (raw.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    out.push({
      rawPath: raw,
      url: `/api/media?path=${encodeURIComponent(raw)}`,
      ext,
      kind: isVideoExt(ext) ? "video" : "image",
    });
  }
  return out;
}

export interface UseSkillRunResult {
  output: string;
  running: boolean;
  error: string | null;
  sessionId: string | null;
  media: MediaItem[];
  /** Start a new run. Cancels any in-flight run first. */
  start: (message: string) => void;
  /** Best-effort cancel of an in-flight run. */
  cancel: () => void;
  /** Clear output/error/media so the panel becomes idle again. */
  reset: () => void;
}

export function useSkillRun(): UseSkillRunResult {
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const handleRef = useRef<RunChatHandle | null>(null);

  const cancel = useCallback(() => {
    const h = handleRef.current;
    handleRef.current = null;
    if (h) {
      void h.cancel();
    }
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setOutput("");
    setError(null);
    setSessionId(null);
  }, [cancel]);

  const start = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      // Tear down any previous run.
      const prev = handleRef.current;
      handleRef.current = null;
      if (prev) void prev.cancel();

      setOutput("");
      setError(null);
      setSessionId(null);
      setRunning(true);

      const handle = runChat({
        message: trimmed,
        onToken: (_token, total) => setOutput(total),
        onDone: (total, sid) => {
          setOutput(total);
          setSessionId(sid);
          setRunning(false);
          handleRef.current = null;
        },
        onError: (err) => {
          setError(err.message);
          setRunning(false);
          handleRef.current = null;
        },
      });
      handleRef.current = handle;
    },
    [],
  );

  const media = extractMediaFromText(output);
  return { output, running, error, sessionId, media, start, cancel, reset };
}
