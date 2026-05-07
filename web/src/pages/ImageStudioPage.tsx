import { useEffect, useState } from "react";
import { Image as ImageIcon, Search, Sparkles, Send, Loader2 } from "lucide-react";
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
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("");

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
    if (!prompt.trim()) return;
    setSubmitting(true);
    // TODO: real wiring to /api/session/new + /api/chat/stream with selected skill
    setTimeout(() => setSubmitting(false), 800);
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
                    onClick={() => setStyle(s)}
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
            <Button className="w-full" onClick={generate} disabled={!prompt.trim() || submitting}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              生成
            </Button>
            <p className="text-[0.7rem] text-muted-foreground">
              当前为前端 stub。下版接 /api/session/new + /api/chat/stream，从 skill 流回的附件渲染到右侧。
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="rounded-xl">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>图像 Skill 库</CardTitle>
              <CardDescription>从 /api/skills 自动识别图像类技能</CardDescription>
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
                    className="rounded-xl border border-border bg-card hover:border-primary/40 p-3 text-left transition-colors"
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

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>历史记录</CardTitle>
            <CardDescription>本会话生成过的图像（待接入 sessions）</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState icon={ImageIcon} title="无历史" description="生成首张图像后会出现在这里" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
