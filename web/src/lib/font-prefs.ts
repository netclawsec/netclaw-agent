/**
 * Font + size preferences — persisted via localStorage, applied to <html>
 * via inline CSS custom properties. The app's `font-sans` Tailwind utility
 * resolves to `--font-sans` so changing this propagates everywhere.
 *
 * 20 commonly-available font stacks. The first entry of each stack is the
 * primary face; subsequent entries are fallbacks. We intentionally avoid
 * fonts that require @font-face downloads at runtime — every option here
 * either ships in macOS/Windows by default, or falls back gracefully.
 */

import { useEffect, useSyncExternalStore } from "react";

export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family stack. */
  stack: string;
  /** Roughly which OS / class this font lives in. */
  group: "Chinese" | "System" | "Web" | "Mono" | "Display";
}

export const FONT_OPTIONS: FontOption[] = [
  // ── Chinese-first, ship on macOS/Windows ──
  { id: "system", label: "系统默认", stack: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", group: "System" },
  { id: "pingfang", label: "苹方 (PingFang SC)", stack: '"PingFang SC", "Heiti SC", "Microsoft YaHei", sans-serif', group: "Chinese" },
  { id: "yahei", label: "微软雅黑 (Microsoft YaHei)", stack: '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif', group: "Chinese" },
  { id: "songti", label: "宋体 (Songti SC)", stack: '"Songti SC", SimSun, "宋体", serif', group: "Chinese" },
  { id: "kaiti", label: "楷体 (Kaiti SC)", stack: '"Kaiti SC", KaiTi, "楷体", serif', group: "Chinese" },
  { id: "fangsong", label: "仿宋", stack: '"FangSong", "仿宋", "STFangsong", serif', group: "Chinese" },
  { id: "hiragino-sans", label: "Hiragino Sans GB", stack: '"Hiragino Sans GB", "PingFang SC", sans-serif', group: "Chinese" },
  { id: "noto-sans-sc", label: "思源黑体 (Noto Sans SC)", stack: '"Noto Sans SC", "Source Han Sans SC", sans-serif', group: "Chinese" },
  { id: "noto-serif-sc", label: "思源宋体 (Noto Serif SC)", stack: '"Noto Serif SC", "Source Han Serif SC", serif', group: "Chinese" },
  // ── Latin-first, system or web-safe ──
  { id: "sf-pro", label: "SF Pro Display", stack: '"SF Pro Display", "SF Pro", -apple-system, sans-serif', group: "System" },
  { id: "helvetica", label: "Helvetica Neue", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', group: "System" },
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif", group: "System" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif", group: "System" },
  { id: "inter", label: "Inter", stack: "Inter, system-ui, sans-serif", group: "Web" },
  { id: "roboto", label: "Roboto", stack: "Roboto, system-ui, sans-serif", group: "Web" },
  { id: "open-sans", label: "Open Sans", stack: '"Open Sans", system-ui, sans-serif', group: "Web" },
  { id: "lato", label: "Lato", stack: "Lato, system-ui, sans-serif", group: "Web" },
  // ── Mono / display ──
  { id: "courier-prime", label: "Courier Prime (内置)", stack: '"Courier Prime", "Courier New", monospace', group: "Mono" },
  { id: "mondwest", label: "Mondwest (品牌字体)", stack: 'Mondwest, "PingFang SC", sans-serif', group: "Display" },
  { id: "menlo-mono", label: "Menlo / Mono", stack: 'Menlo, Monaco, "Courier New", monospace', group: "Mono" },
];

export interface SizePreset {
  id: string;
  label: string;
  /** Base body font-size in px. Tailwind's text-xs ... text-2xl scales off this. */
  basePx: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: "compact", label: "紧凑", basePx: 14 },
  { id: "default", label: "标准", basePx: 16 },
  { id: "comfortable", label: "舒适", basePx: 17 },
  { id: "large", label: "放大", basePx: 18 },
  { id: "xl", label: "超大", basePx: 20 },
];

export interface FontPrefs {
  fontId: string;
  sizeId: string;
}

const STORAGE_KEY = "netclaw-font-prefs";
const DEFAULT_PREFS: FontPrefs = { fontId: "system", sizeId: "default" };

function readPrefs(): FontPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      fontId: typeof parsed.fontId === "string" ? parsed.fontId : DEFAULT_PREFS.fontId,
      sizeId: typeof parsed.sizeId === "string" ? parsed.sizeId : DEFAULT_PREFS.sizeId,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: FontPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort
  }
}

/** Apply prefs to <html> CSS custom properties. */
export function applyFontPrefs(prefs: FontPrefs): void {
  const font = FONT_OPTIONS.find((f) => f.id === prefs.fontId) ?? FONT_OPTIONS[0];
  const size = SIZE_PRESETS.find((s) => s.id === prefs.sizeId) ?? SIZE_PRESETS[1];
  const root = document.documentElement;
  root.style.setProperty("--font-sans", font.stack);
  // Also override --font-display so the display headings respect the user
  // choice (otherwise Mondwest stays everywhere). Display fonts in the option
  // list keep the brand font; everything else resolves to the chosen stack.
  if (font.group !== "Display") {
    root.style.setProperty("--font-display", font.stack);
  } else {
    root.style.removeProperty("--font-display");
  }
  root.style.setProperty("font-size", `${size.basePx}px`);
}

// ── Pub/sub so React components react to changes from anywhere ──
const listeners = new Set<() => void>();
let cached: FontPrefs = DEFAULT_PREFS;

function notify(): void {
  for (const fn of listeners) fn();
}

export function setFontPrefs(next: Partial<FontPrefs>): void {
  cached = { ...cached, ...next };
  writePrefs(cached);
  applyFontPrefs(cached);
  notify();
}

export function getFontPrefs(): FontPrefs {
  return cached;
}

export function useFontPrefs(): FontPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cached,
    () => cached,
  );
}

/**
 * Mount this hook once (e.g. in main.tsx or a top-level provider) so initial
 * prefs are read from localStorage and applied to :root before first paint.
 */
export function useApplyFontPrefsOnMount(): void {
  useEffect(() => {
    cached = readPrefs();
    applyFontPrefs(cached);
    notify();
  }, []);
}

/** Bootstrap synchronously before React mounts. Call from main.tsx. */
export function bootstrapFontPrefs(): void {
  cached = readPrefs();
  applyFontPrefs(cached);
}
