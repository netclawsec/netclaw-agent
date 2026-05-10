import { useEffect, useState } from "react";
import { X, Send, Loader2, Image as ImageIcon, Hash, Eye, MapPin } from "lucide-react";
import { BrandIcon, type BrandSlug } from "@/components/BrandIcon";
import { cn } from "@/lib/utils";

interface PlatformChoice {
  id: "douyin" | "xhs" | "shipinhao";
  brand: BrandSlug;
  name: string;
}

const PLATFORMS: PlatformChoice[] = [
  { id: "douyin", brand: "tiktok", name: "抖音" },
  { id: "xhs", brand: "xiaohongshu", name: "小红书" },
  { id: "shipinhao", brand: "wechat", name: "视频号" },
];

// Visibility options shared across the 3 platforms. AiToEarn uses
// 0=public / 1=private / 2=friends (douyin) or 4=friends (xhs); we keep
// the user-facing labels uniform and let the backend worker translate.
type Visibility = "public" | "friends" | "private";
const VISIBILITY_OPTS: { id: Visibility; label: string }[] = [
  { id: "public", label: "公开" },
  { id: "friends", label: "好友可见" },
  { id: "private", label: "仅自己" },
];

export interface PublishBatchDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the video path (e.g. from an OSS render). */
  defaultVideoPath?: string;
  onSuccess?: (count: number) => void;
}

export function PublishBatchDialog({
  open,
  onClose,
  defaultVideoPath = "",
  onSuccess,
}: PublishBatchDialogProps) {
  const [title, setTitle] = useState("");
  const [videoPath, setVideoPath] = useState(defaultVideoPath);
  const [caption, setCaption] = useState("");
  const [cover, setCover] = useState("");
  const [topicsRaw, setTopicsRaw] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [poiName, setPoiName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selected, setSelected] = useState<Set<PlatformChoice["id"]>>(new Set(["douyin", "xhs"]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync videoPath when the parent passes a new defaultVideoPath after
  // the dialog has already been mounted (e.g. user picks "发布" on a fresh
  // ffmpeg render). Without this useEffect the field would stay blank
  // because state was initialised on first mount only.
  useEffect(() => {
    if (open) setVideoPath(defaultVideoPath);
  }, [open, defaultVideoPath]);

  if (!open) return null;

  const toggle = (id: PlatformChoice["id"]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("标题必填");
      return;
    }
    if (!videoPath.trim()) {
      setError("视频路径必填");
      return;
    }
    if (selected.size === 0) {
      setError("至少选一个平台");
      return;
    }
    setSubmitting(true);
    try {
      const targets = Array.from(selected).map((p) => ({ platform: p }));
      const topics = topicsRaw
        .split(/[,，\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, 10);
      const res = await fetch("/api/social/publish-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          video_path: videoPath.trim(),
          caption: caption.trim(),
          cover: cover.trim(),
          topics,
          visibility,
          poi_name: poiName.trim(),
          scheduled_at: scheduledAt.trim(),
          targets,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      onSuccess?.(body?.count ?? 0);
      onClose();
    } catch (e) {
      setError((e as Error).message || "请求失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40">
      <div className="w-[560px] max-w-[92vw] rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="text-base font-semibold">聚合发布</div>
            <div className="text-xs text-muted-foreground">勾选平台后一次入队，每平台一条独立任务</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-1">标题 <span className="text-destructive">*</span></div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={30}
              placeholder="≤30 字"
              className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-1">视频本地路径（mp4 / mov）</div>
            <input
              type="text"
              value={videoPath}
              onChange={(e) => setVideoPath(e.target.value)}
              placeholder="/Users/yourname/Movies/clip.mp4"
              className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-1">正文</div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder="可选，平台共用一份文案"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <ImageIcon className="h-3 w-3" /> 封面 URL / 路径
              </div>
              <input
                type="text"
                value={cover}
                onChange={(e) => setCover(e.target.value)}
                placeholder="可选"
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="block">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <MapPin className="h-3 w-3" /> 位置（POI）
              </div>
              <input
                type="text"
                value={poiName}
                onChange={(e) => setPoiName(e.target.value)}
                placeholder="可选，如 上海浦东"
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
          </div>

          <label className="block">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
              <Hash className="h-3 w-3" /> 话题（逗号或空格分隔，前缀 # 可省）
            </div>
            <input
              type="text"
              value={topicsRaw}
              onChange={(e) => setTopicsRaw(e.target.value)}
              placeholder="新手化妆, 平价彩妆"
              className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <Eye className="h-3 w-3" /> 可见性
              </div>
              <div className="flex gap-2">
                {VISIBILITY_OPTS.map((opt) => {
                  const active = visibility === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setVisibility(opt.id)}
                      className={cn(
                        "flex-1 h-9 rounded-xl border text-xs transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background hover:bg-muted text-muted-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <div className="text-[11px] text-muted-foreground mb-1">定时发布</div>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
          </div>

          <div>
            <div className="text-[11px] text-muted-foreground mb-2">目标平台</div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const active = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background hover:bg-muted text-muted-foreground",
                    )}
                  >
                    <BrandIcon
                      slug={p.brand}
                      className="h-4 w-4"
                      color={p.brand === "tiktok" ? "currentColor" : undefined}
                    />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded-xl border border-border hover:bg-muted disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            发布
          </button>
        </footer>
      </div>
    </div>
  );
}
