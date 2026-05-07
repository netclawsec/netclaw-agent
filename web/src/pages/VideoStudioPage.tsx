import { useEffect, useRef, useState } from "react";
import { Play, FileVideo, Plus, Search, Sparkles, Loader2, Square, X } from "lucide-react";
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
  path?: string;
}

const VIDEO_KEYWORDS = ["video", "manim", "movie", "shorts", "tiktok", "reel"];

function isVideoSkill(s: SkillSummary): boolean {
  const blob = `${s.name} ${s.description ?? ""} ${s.category ?? ""} ${s.domain ?? ""}`.toLowerCase();
  return VIDEO_KEYWORDS.some((k) => blob.includes(k));
}

export default function VideoStudioPage() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const [prompt, setPrompt] = useState("");
  const runner = useSkillRun();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => {
        const all: SkillSummary[] = d.skills || [];
        setSkills(all.filter(isVideoSkill));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const filtered = (skills ?? []).filter((s) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
  });

  function pickSkill(s: SkillSummary) {
    setSelected(s);
    runner.reset();
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function run() {
    if (!selected || !prompt.trim() || runner.running) return;
    runner.start(`请使用 skill「${selected.name}」生成视频。\n\n创作要求：${prompt.trim()}`);
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-xl">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>AI 视频工作室</CardTitle>
            <CardDescription>从 netclaw-agent skill 库（含 manim / video-* / shorts 模板）启动</CardDescription>
          </div>
          <Button onClick={() => setSelected(null)}>
            <Plus className="h-3.5 w-3.5" /> 新建项目
          </Button>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索模板…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {skills === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileVideo}
          title={skills.length === 0 ? "未识别到视频类 skill" : "没有匹配的模板"}
          description={
            skills.length === 0
              ? "/api/skills 返回的 skill 中没有命中视频关键词。可能需要安装 manim-video / video-content-analyzer 等。"
              : "试试别的关键词"
          }
          action={
            <Button size="sm" variant="outline">
              <Sparkles className="h-3 w-3" /> 浏览全部 skills
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <Card
              key={s.name}
              className={`rounded-xl group hover:border-primary/40 transition-colors ${selected?.name === s.name ? "border-primary" : ""}`}
            >
              <CardContent className="space-y-3">
                <div className="aspect-video rounded-lg bg-gradient-to-br from-primary/20 via-accent to-secondary flex items-center justify-center">
                  <FileVideo className="h-8 w-8 text-primary/70" />
                </div>
                <div className="space-y-1">
                  <div className="font-display font-semibold text-sm truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                    {s.description || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.category && <Badge variant="outline">{s.category}</Badge>}
                  {s.domain && <Badge variant="outline">{s.domain}</Badge>}
                  <Button
                    size="sm"
                    className="ml-auto"
                    variant={selected?.name === s.name ? "default" : "outline"}
                    onClick={() => pickSkill(s)}
                  >
                    <Play className="h-3 w-3" /> {selected?.name === s.name ? "已选" : "选中"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div ref={panelRef}>
        <RunnerPanel
          skill={selected}
          prompt={prompt}
          onPromptChange={setPrompt}
          onRun={run}
          onCancel={runner.cancel}
          onClose={() => {
            setSelected(null);
            runner.reset();
            setPrompt("");
          }}
          runner={runner}
        />
      </div>
    </div>
  );
}

interface RunnerPanelProps {
  skill: SkillSummary | null;
  prompt: string;
  onPromptChange: (v: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onClose: () => void;
  runner: ReturnType<typeof useSkillRun>;
}

function RunnerPanel({ skill, prompt, onPromptChange, onRun, onCancel, onClose, runner }: RunnerPanelProps) {
  if (!skill) {
    return (
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>启动一个视频任务</CardTitle>
          <CardDescription>先选一个 skill，再描述要生成的内容</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={FileVideo}
            title="还没选择 skill"
            description="点上面任意一个模板的「选中」按钮"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate">运行 skill：{skill.name}</CardTitle>
          <CardDescription className="line-clamp-1">{skill.description || "—"}</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="h-3.5 w-3.5" /> 关闭
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-y"
          placeholder="例：30 秒抖音竖版视频，主题是「秋季新款扫地机器人开箱」，节奏快，结尾留 CTA 引流到主页"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          disabled={runner.running}
        />
        <div className="flex items-center gap-2">
          {runner.running ? (
            <Button onClick={onCancel} variant="outline">
              <Square className="h-3.5 w-3.5" /> 停止
            </Button>
          ) : (
            <Button onClick={onRun} disabled={!prompt.trim()}>
              <Play className="h-3.5 w-3.5" /> 启动
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {runner.running ? "Agent 正在执行…" : runner.sessionId ? `已完成 · session ${runner.sessionId.slice(0, 8)}` : "调用 /api/session/new + /api/chat/start + SSE"}
          </span>
        </div>

        {runner.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            执行失败：{runner.error}
          </div>
        )}

        {(runner.output || runner.running) && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 max-h-72 overflow-auto">
            <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground mb-1.5 uppercase tracking-[0.1em]">
              {runner.running && <Loader2 className="h-3 w-3 animate-spin" />}
              Assistant 输出
            </div>
            <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground">
              {runner.output || "等待第一个 token…"}
            </pre>
          </div>
        )}

        {runner.media.length > 0 && (
          <div className="space-y-2">
            <div className="text-[0.7rem] text-muted-foreground uppercase tracking-[0.1em]">产物（从输出中提取的文件路径）</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {runner.media.map((m) => (
                <div key={m.url} className="rounded-lg border border-border bg-card overflow-hidden">
                  {m.kind === "video" ? (
                    <video src={m.url} controls className="w-full aspect-video bg-black" />
                  ) : (
                    <img src={m.url} alt={m.rawPath} className="w-full aspect-video object-cover bg-muted" />
                  )}
                  <div className="px-2.5 py-1.5 text-[0.7rem] text-muted-foreground truncate">{m.rawPath}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
