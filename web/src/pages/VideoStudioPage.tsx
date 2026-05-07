import { useEffect, useState } from "react";
import { Play, FileVideo, Plus, Search, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

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

  return (
    <div className="space-y-4">
      <Card className="rounded-xl">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>AI 视频工作室</CardTitle>
            <CardDescription>从 netclaw-agent skill 库（含 manim / video-* / shorts 模板）启动</CardDescription>
          </div>
          <Button>
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
            <Card key={s.name} className="rounded-xl group hover:border-primary/40 transition-colors">
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
                  <Button size="sm" className="ml-auto" variant="default">
                    <Play className="h-3 w-3" /> 启动
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>下一步：执行链路</CardTitle>
          <CardDescription>启动 = 创建 session → /api/chat/stream → 渲染产物 → 下载</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            点 启动 当前为 stub。下版会调 /api/session/new + /api/chat/stream 并把附件渲染到下方时间轴。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
