import { useCallback, useEffect, useRef, useState } from "react";
import { runChat, type RunChatHandle } from "./chat";

export interface MediaItem {
  url: string;
  rawPath: string;
  ext: string;
  kind: "image" | "video";
}

const MEDIA_EXT = ["mp4", "webm", "mov", "png", "jpg", "jpeg", "gif", "webp"];
// Conservative matcher — only paths beginning with one of:
//   /tmp/, /var/folders/  (system tmp on macOS / linux)
//   ~/.netclaw/, ~/.hermes/  (agent home)
//   /Users/<name>/.netclaw/, /Users/<name>/.hermes/  (absolute form of the same)
// Any other absolute path is ignored client-side so we never construct a
// /api/media?path=... URL pointing at e.g. /etc/passwd or ~/.ssh/. The backend
// independently enforces allowed_roots; this is a defense-in-depth.
const ALLOWED_PREFIXES = [
  /^\/tmp\//,
  /^\/var\/folders\//,
  /^~\/\.netclaw\//,
  /^~\/\.hermes\//,
  /^\/Users\/[^/]+\/\.netclaw\//,
  /^\/Users\/[^/]+\/\.hermes\//,
  /^\/home\/[^/]+\/\.netclaw\//,
  /^\/home\/[^/]+\/\.hermes\//,
];

const PATH_REGEX = new RegExp(
  `(~?/[^\\s'"<>\`)\\]]+\\.(?:${MEDIA_EXT.join("|")}))`,
  "gi",
);

function isVideoExt(ext: string): boolean {
  return ["mp4", "webm", "mov"].includes(ext);
}

function isAllowedPath(raw: string): boolean {
  return ALLOWED_PREFIXES.some((re) => re.test(raw));
}

export function extractMediaFromText(text: string): MediaItem[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const match of text.matchAll(PATH_REGEX)) {
    const raw = match[1];
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (!isAllowedPath(raw)) continue;
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

  // Cancel any in-flight stream when the consumer unmounts.
  useEffect(() => {
    return () => {
      const h = handleRef.current;
      handleRef.current = null;
      if (h) void h.cancel();
    };
  }, []);

  const media = extractMediaFromText(output);
  return { output, running, error, sessionId, media, start, cancel, reset };
}
