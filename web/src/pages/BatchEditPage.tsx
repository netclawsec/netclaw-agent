import { useCallback, useEffect, useState } from "react";
import {
  Plus, Loader2, Trash2, Film, Music, Type, Maximize2, Gauge,
  CheckCircle2, AlertCircle, Clock, RefreshCw, Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectOption } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetchJson";
import { PublishBatchDialog } from "@/components/PublishBatchDialog";

// Reference: ffmpeg-skill / video-editing-skill expose 18+ natural-language
// commands (cut/merge/compress/subtitle/GIF/watermark/speed/stabilize/
// jump-cut/text-overlay/caption/silence-removal). This page surfaces the
// subset most useful for one-click 短视频 batch assembly: aspect (scale+pad),
// merge (concat list), top text overlay (drawtext), speed (setpts/atempo),
// BGM mix (amix). Output count drives N parallel renders sharing the same
// inputs/options — equivalent to looping `ffmpeg-skill render` N times.

interface BatchTask {
  id: string;
  state: "queued" | "running" | "done" | "failed";
  progress: string;
  count: number;
  inputs: string[];
  options: BatchOptions;
  outputs: Array<{ ok: boolean; output_path?: string; error?: string }>;
  created_at: number;
  error?: string;
}

interface BatchOptions {
  aspect: "9:16" | "16:9" | "1:1";
  speed: number;
  top_title: string;
  bgm_path: string;
}

function statusBadge(state: BatchTask["state"]) {
  if (state === "done")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" /> 完成
      </Badge>
    );
  if (state === "failed")
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <AlertCircle className="h-3 w-3" /> 失败
      </Badge>
    );
  if (state === "running")
    return (
      <Badge variant="outline" className="border-primary/40 text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> 渲染中
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Clock className="h-3 w-3" /> 排队中
    </Badge>
  );
}

export default function BatchEditPage() {
  const [inputs, setInputs] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [opts, setOpts] = useState<BatchOptions>({
    aspect: "9:16",
    speed: 1.0,
    top_title: "",
    bgm_path: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetchJson<{ tasks?: BatchTask[] }>("/api/studio/batch-edit");
    if (res.ok) {
      setTasks(res.data?.tasks ?? []);
      setError(null);
    } else {
      // Surface the failure so users don't stare at a stale list thinking
      // everything is fine. Keep tasks as-is (the previous payload).
      setError(`刷新失败：${res.error}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const addInput = async () => {
    const r = await fetch("/api/files/choose-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensions: ["mp4", "mov", "m4v", "webm"] }),
    }).catch(() => null);
    const body = await r?.json().catch(() => null);
    if (body?.ok && body?.path) {
      setInputs((prev) => [...prev, body.path]);
    }
  };

  const pickBgm = async () => {
    const r = await fetch("/api/files/choose-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensions: ["mp3", "m4a", "wav", "aac"] }),
    }).catch(() => null);
    const body = await r?.json().catch(() => null);
    if (body?.ok && body?.path) {
      setOpts((p) => ({ ...p, bgm_path: body.path }));
    }
  };

  const submit = async () => {
    setError(null);
    if (inputs.length === 0) {
      setError("至少添加一个素材");
      return;
    }
    setSubmitting(true);
    const res = await fetchJson<unknown>("/api/studio/batch-edit", {
      method: "POST",
      body: { inputs, count, options: opts },
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || "提交失败");
      return;
    }
    void refresh();
  };

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_360px]">
      {/* Left: editor + recent tasks */}
      <div className="flex flex-col gap-4 min-w-0">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Film className="h-4 w-4" /> 素材
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {inputs.map((p, i) => (
                <div
                  key={`${p}-${i}`}
                  className="group relative h-24 rounded-xl border border-border bg-muted/30 p-2 text-[11px] font-mono break-all overflow-hidden"
                >
                  <span className="line-clamp-3">{p}</span>
                  <button
                    type="button"
                    onClick={() => setInputs((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 rounded-full bg-foreground/60 text-background p-0.5 opacity-0 group-hover:opacity-100 transition"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addInput}
                className="h-24 rounded-xl border border-dashed border-border bg-muted/10 text-muted-foreground text-xs flex flex-col items-center justify-center gap-1 hover:bg-muted/30 transition"
              >
                <Plus className="h-4 w-4" />
                添加素材
              </button>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              建议每段 ≥ 10 秒。会按顺序拼接到一条视频，渲染 {count} 条共享同一组素材。
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">基础设置</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <Maximize2 className="h-3 w-3" /> 比例
              </div>
              <Select value={opts.aspect} onValueChange={(v) => setOpts((p) => ({ ...p, aspect: v as BatchOptions["aspect"] }))}>
                <SelectOption value="9:16">9:16 竖版（短视频）</SelectOption>
                <SelectOption value="16:9">16:9 横版</SelectOption>
                <SelectOption value="1:1">1:1 方版</SelectOption>
              </Select>
            </label>
            <label className="block">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <Gauge className="h-3 w-3" /> 速度（0.5×–2×）
              </div>
              <Input
                type="number"
                min={0.5}
                max={2}
                step={0.1}
                value={opts.speed}
                onChange={(e) => setOpts((p) => ({ ...p, speed: Math.max(0.5, Math.min(2, Number(e.target.value) || 1)) }))}
              />
            </label>
            <label className="block sm:col-span-2">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <Type className="h-3 w-3" /> 顶部标题
              </div>
              <Input
                placeholder="可选，叠加到画面顶部"
                value={opts.top_title}
                onChange={(e) => setOpts((p) => ({ ...p, top_title: e.target.value }))}
              />
            </label>
            <label className="block sm:col-span-2">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <Music className="h-3 w-3" /> 背景音乐
              </div>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="点右侧浏览选 mp3/m4a/wav"
                  value={opts.bgm_path}
                  onChange={(e) => setOpts((p) => ({ ...p, bgm_path: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={pickBgm}
                  className="px-3 h-9 rounded-xl border border-input text-xs hover:bg-muted whitespace-nowrap"
                >
                  浏览…
                </button>
              </div>
            </label>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">高级设置</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 items-end">
            <label className="block">
              <div className="text-[11px] text-muted-foreground mb-1">预生成条数</div>
              <Input
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 h-9 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 text-sm font-medium"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              开始渲染
            </button>
          </CardContent>
        </Card>

        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>

      {/* Right: tasks panel */}
      <Card className="rounded-2xl lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-9rem)]">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">渲染任务</CardTitle>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">还没有任务</div>
          ) : (
            tasks.map((t) => {
              const firstOutput = t.outputs.find((o) => o.ok)?.output_path;
              return (
                <div key={t.id} className="rounded-xl border border-border p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-2">
                    {statusBadge(t.state)}
                    <span className="font-mono text-[10px] text-muted-foreground">{t.progress}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(t.created_at * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground line-clamp-1">
                    {t.options.aspect} · {t.count} 条 · 速度 {t.options.speed}×
                  </div>
                  {t.error && <div className="text-destructive text-[11px]">{t.error}</div>}
                  {t.state === "done" && (
                    <div className="flex flex-wrap gap-1">
                      {t.outputs.map((o, idx) => (
                        <span
                          key={idx}
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-mono",
                            o.ok ? "bg-emerald-500/10 text-emerald-700" : "bg-destructive/10 text-destructive",
                          )}
                          title={o.output_path || o.error}
                        >
                          {o.ok ? `clip_${idx + 1}.mp4` : "❌"}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.state === "done" && firstOutput && (
                    <button
                      type="button"
                      onClick={() => setPublishOpen(firstOutput)}
                      className="mt-1 inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/15"
                    >
                      <Send className="h-3 w-3" />
                      发布
                    </button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <PublishBatchDialog
        open={!!publishOpen}
        onClose={() => setPublishOpen(null)}
        defaultVideoPath={publishOpen ?? ""}
      />
    </div>
  );
}
