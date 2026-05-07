import { useEffect, useState } from "react";
import { Image as ImageIcon, Search, Sparkles, Send, Loader2, Square, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkillRun } from "@/lib/skill-run";

interface SkillSummary {
  name: string;
  description?: string;
  category?: string;
  domain?: string;
}

const IMAGE_KEYWORDS = ["image", "photo", "design", "art", "draw", "diagram", "logo", "poster", "icon"];

function isImageSkill(s: SkillSummary): boolean {
  const blob = `${s.name} ${s.description ?? ""} ${s.category ?? ""} ${s.domain ?? ""}`.toLowerCase();
  return IMAGE_KEYWORDS.some((k) => blob.includes(k));
}

const SIZES = [
  { label: "1:1 (1024)", value: "1024x1024" },
  { label: "16:9 (1920)", value: "1920x1080" },
  { label: "9:16 (1080)", value: "1080x1920" },
];

const STYLES = ["写实 / Photo", "插画 / Illustration", "国风 / Chinese", "赛博 / Cyber", "极简 / Minimal"];

export default function ImageStudioPage() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [style, setStyle] = useState(STYLES[0]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const runner = useSkillRun();

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        const all: SkillSummary[] = d.skills || [];
        setSkills(all.filter(isImageSkill));
      })
      .catch(() => setSkills([]));
  }, []);

  const filtered = (skills ?? []).filter((s) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
  });

  function generate() {
    if (!prompt.trim() || runner.running) return;
    const skillHint = selected ? `请使用 skill「${selected.name}」生成图像。` : "请生成图像。";
    const message = `${skillHint}\n\n要求：${prompt.trim()}\n尺寸：${size}\n风格：${style}`;
    runner.start(message);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      <div className="space-y-4">
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>Prompt</CardTitle>
            <CardDescription>用自然语言描述要生成的图像</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full min-h-[110px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-y"
              placeholder="例：紫色城市夜景，霓虹灯反射，赛博朋克风格…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={runner.running}
            />
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">尺寸 / Size</div>
              <div className="flex flex-wrap gap-1.5">
                {SIZES.map((s) => (
                  <Button
                    key={s.value}
                    size="sm"
                    variant={size === s.value ? "default" : "outline"}
                    onClick={() => setSize(s.value)}
                    disabled={runner.running}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">风格 / Style</div>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <Badge
                    key={s}
                    variant={style === s ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => !runner.running && setStyle(s)}
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
            {selected && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Skill:</span>
                <Badge variant="default" className="font-mono">{selected.name}</Badge>
                <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setSelected(null)} disabled={runner.running}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            {runner.running ? (
              <Button className="w-full" variant="outline" onClick={runner.cancel}>
                <Square className="h-3.5 w-3.5" /> 停止
              </Button>
            ) : (
              <Button className="w-full" onClick={generate} disabled={!prompt.trim()}>
                <Send className="h-3.5 w-3.5" /> 生成
              </Button>
            )}
            <p className="text-[0.7rem] text-muted-foreground">
              接 /api/session/new + /api/chat/start + SSE。Agent 输出里出现的 .png/.jpg 路径会自动渲染到右侧。
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {(runner.output || runner.running || runner.error) && (
          <Card className="rounded-xl">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>生成结果</CardTitle>
                <CardDescription>
                  {runner.running ? "Agent 正在执行…" : runner.sessionId ? `已完成 · session ${runner.sessionId.slice(0, 8)}` : "等待"}
                </CardDescription>
              </div>
              {runner.running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </CardHeader>
            <CardContent className="space-y-3">
              {runner.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  执行失败：{runner.error}
                </div>
              )}
              {runner.media.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {runner.media.map((m) => (
                    <div key={m.url} className="rounded-lg border border-border bg-card overflow-hidden">
                      {m.kind === "video" ? (
                        <video src={m.url} controls className="w-full aspect-square bg-black" />
                      ) : (
                        <img src={m.url} alt={m.rawPath} className="w-full aspect-square object-cover bg-muted" />
                      )}
                      <div className="px-2 py-1 text-[0.65rem] text-muted-foreground truncate">{m.rawPath}</div>
                    </div>
                  ))}
                </div>
              )}
              {runner.output && (
                <details className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Agent 输出（点开查看）</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-foreground">{runner.output}</pre>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="rounded-xl">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>图像 Skill 库</CardTitle>
              <CardDescription>从 /api/skills 自动识别图像类技能 · 选中后生成时会带 skill 名</CardDescription>
            </div>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8" placeholder="搜索 skill…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent>
            {skills === null ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ImageIcon}
                title={skills.length === 0 ? "未识别到图像类 skill" : "没有匹配模板"}
                description="可装 stitch-design / canvas-design / popular-web-designs 等"
                action={<Button size="sm" variant="outline"><Sparkles className="h-3 w-3" /> 全部 skills</Button>}
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filtered.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setSelected(selected?.name === s.name ? null : s)}
                    disabled={runner.running}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      selected?.name === s.name
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    } ${runner.running ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <div className="aspect-square rounded-lg bg-gradient-to-br from-primary/20 to-accent flex items-center justify-center mb-2">
                      <ImageIcon className="h-6 w-6 text-primary/70" />
                    </div>
                    <div className="font-display text-xs font-semibold truncate">{s.name}</div>
                    <div className="text-[0.7rem] text-muted-foreground line-clamp-2 mt-0.5">{s.description || "—"}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
