import { useEffect, useState } from "react";
import {
  Calendar, ListChecks, Folder, Search, MessageSquareReply, Plus, Loader2, Send,
  AlertTriangle, CheckCircle2, RefreshCw, ExternalLink,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Types matching webui/api/social.py response shapes
// ─────────────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  title: string;
  platform: string;
  video_path: string;
  caption: string;
  scheduled_at: string;
  status: string;
  created_at: number;
}

interface SearchResult {
  rank: number;
  aweme_id?: string;
  note_id?: string;
  feed_id?: string;
  title: string;
  author: string;
  likes: string;
  url: string;
}

interface CommentItem {
  rank: number;
  comment_id: string;
  author: string;
  text: string;
  likes: string;
  created_at: string;
}

interface ReplyTemplate {
  id: string;
  name: string;
  text: string;
  created_at: number;
}

interface OpencliResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  stdout?: string;
  stderr?: string;
}

const TABS = [
  { id: "calendar", label: "发布日历", icon: Calendar },
  { id: "queue", label: "内容队列", icon: ListChecks },
  { id: "library", label: "素材库", icon: Folder },
  { id: "intercept", label: "截流 / Search", icon: Search },
  { id: "replies", label: "回复模板", icon: MessageSquareReply },
] as const;

type TabId = (typeof TABS)[number]["id"];

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
  return res.json();
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function SocialPage() {
  const [active, setActive] = useState<TabId>("calendar");

  return (
    <div className="space-y-4">
      <Tabs defaultValue="calendar">
        {(_a, _set) => (
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                active={active === t.id}
                onClick={() => setActive(t.id)}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
      </Tabs>

      {active === "calendar" && <CalendarPanel />}
      {active === "queue" && <QueuePanel />}
      {active === "library" && <LibraryPanel />}
      {active === "intercept" && <InterceptPanel />}
      {active === "replies" && <ReplyTemplatesPanel />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 发布日历 — visual schedule grid
// ─────────────────────────────────────────────────────────────────────────

function CalendarPanel() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  useEffect(() => {
    getJSON<{ queue: QueueItem[] }>("/api/social/queue")
      .then((r) => setQueue(r.queue || []))
      .catch(() => undefined);
  }, []);

  const days = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>未来 14 天发布日历</CardTitle>
        <CardDescription>队列中已排期的任务渲染在对应日期下</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            const items = queue.filter((q) => q.scheduled_at?.startsWith(key));
            return (
              <div key={key} className="rounded-lg border border-border bg-muted/20 p-2 min-h-[88px]">
                <div className="text-xs text-muted-foreground mb-1">
                  {d.getMonth() + 1}/{d.getDate()}
                </div>
                {items.length === 0 ? (
                  <div className="text-[0.65rem] text-muted-foreground/60">空</div>
                ) : (
                  items.map((it) => (
                    <div key={it.id} className="text-[0.65rem] bg-primary/10 text-primary rounded px-1.5 py-0.5 mb-0.5 truncate">
                      {it.title}
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 内容队列 — list + add
// ─────────────────────────────────────────────────────────────────────────

function QueuePanel() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    platform: "douyin",
    video_path: "",
    caption: "",
    scheduled_at: "",
  });

  const reload = () =>
    getJSON<{ queue: QueueItem[] }>("/api/social/queue")
      .then((r) => setQueue(r.queue || []))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    reload();
  }, []);

  async function uploadNow(item: QueueItem) {
    setError(null);
    try {
      const r = await postJSON<OpencliResponse>("/api/social/upload", {
        video_path: item.video_path,
        title: item.title,
        caption: item.caption,
        visibility: "public",
        schedule_at: item.scheduled_at || undefined,
      });
      if (!r.ok) {
        setError(r.error || "上传失败");
      } else {
        await reload();
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function addQueueItem() {
    setSubmitting(true);
    setError(null);
    try {
      await postJSON<QueueItem>("/api/social/queue", form);
      setDrawerOpen(false);
      setForm({ title: "", platform: "douyin", video_path: "", caption: "", scheduled_at: "" });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>内容队列</CardTitle>
          <CardDescription>排队中的发布任务（本地 ~/.netclaw/web/social_queue.json）</CardDescription>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> 加入队列
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error && <div className="px-4 py-2 text-xs text-destructive border-b border-border">{error}</div>}
        {queue === null ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : queue.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="队列为空"
            description="点 加入队列 添加首个发布任务"
            action={<Button size="sm" onClick={() => setDrawerOpen(true)}>添加</Button>}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>平台</TableHead>
                <TableHead>计划时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.title}</TableCell>
                  <TableCell><Badge variant="outline">{it.platform}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs">{it.scheduled_at || "—"}</TableCell>
                  <TableCell>
                    <Badge>{it.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => uploadNow(it)}>
                      <Send className="h-3 w-3" /> 立即发
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="加入发布队列">
        <div className="space-y-3">
          <Input placeholder="标题（≤30 字）" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input placeholder="本地视频路径 /path/to/video.mp4" value={form.video_path} onChange={(e) => setForm({ ...form, video_path: e.target.value })} />
          <Input placeholder="正文 / Caption（可空）" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
          <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button className="flex-1" onClick={addQueueItem} disabled={submitting || !form.title}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null} 加入队列
            </Button>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            目前仅支持本地文件路径，且抖音平台。其他平台 / 上传 OSS 后续接入。
          </p>
        </div>
      </Drawer>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 素材库 — placeholder ish (browse local files / future OSS)
// ─────────────────────────────────────────────────────────────────────────

function LibraryPanel() {
  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>素材库</CardTitle>
        <CardDescription>本地路径 + 未来阿里云 OSS 索引（待接入）</CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={Folder}
          title="素材库尚未接入"
          description="目前用「内容队列」直接给视频本地路径。后续会接 ~/.netclaw/library 索引 + OSS。"
        />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 截流 — search → comments → reply via opencli
// ─────────────────────────────────────────────────────────────────────────

function InterceptPanel() {
  const [platform, setPlatform] = useState<"douyin" | "xhs" | "shipinhao">("douyin");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyTarget, setReplyTarget] = useState<CommentItem | null>(null);
  const [doctorState, setDoctorState] = useState<"unknown" | "ok" | "fail">("unknown");

  useEffect(() => {
    getJSON<{ ok: boolean }>("/api/social/doctor")
      .then((r) => setDoctorState(r.ok ? "ok" : "fail"))
      .catch(() => setDoctorState("fail"));
  }, []);

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setComments(null);
    setSelected(null);
    try {
      const r = await postJSON<OpencliResponse<SearchResult[]>>("/api/intercept/search", {
        platform,
        query,
        limit: 20,
      });
      if (!r.ok) {
        setError(r.error || r.stderr || "search failed");
      } else {
        setResults(r.data || []);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function pickResult(r: SearchResult) {
    setSelected(r);
    setComments(null);
    setError(null);
    const target = platform === "douyin" ? r.aweme_id : platform === "xhs" ? r.note_id : r.feed_id;
    if (!target) {
      setError("未拿到目标 ID（搜索结果可能解析失败）");
      return;
    }
    try {
      const resp = await postJSON<OpencliResponse<CommentItem[]>>("/api/intercept/comments", {
        platform,
        target_id: target,
        limit: 30,
      });
      if (!resp.ok) {
        setError(resp.error || resp.stderr || "comments failed");
      } else {
        setComments(resp.data || []);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function sendReply(dryRun = false) {
    if (!selected || !replyText.trim()) return;
    const target = platform === "douyin" ? selected.aweme_id : platform === "xhs" ? selected.note_id : selected.feed_id;
    if (!target) return;
    setError(null);
    try {
      const r = await postJSON<OpencliResponse>("/api/intercept/reply", {
        platform,
        target_id: target,
        text: replyText,
        reply_to: replyTarget?.comment_id,
        dry_run: dryRun,
      });
      if (!r.ok) {
        setError(r.error || r.stderr || "reply failed");
      } else {
        setReplyText("");
        setReplyTarget(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-xl">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>截流 / Intercept</CardTitle>
            <CardDescription>关键词搜索 → 抓评 → 发评，全部通过 opencli 在你真实 Chrome 里跑</CardDescription>
          </div>
          <DoctorBadge state={doctorState} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as "douyin" | "xhs" | "shipinhao")}
            >
              <option value="douyin">抖音 / Douyin</option>
              <option value="xhs">小红书 / XHS</option>
              <option value="shipinhao">视频号 / Shipinhao</option>
            </select>
            <Input
              className="flex-1 min-w-[200px]"
              placeholder="搜索关键词"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
            <Button onClick={runSearch} disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              搜索
            </Button>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {results && (
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>搜索结果（{results.length}）</CardTitle>
            <CardDescription>点击任一条进入抓评</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {results.length === 0 ? (
              <EmptyState icon={Search} title="无结果" description="换个关键词或检查登录态" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead>作者</TableHead>
                    <TableHead>赞</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.url} className={cn(selected?.url === r.url ? "bg-accent/30" : "cursor-pointer")} onClick={() => pickResult(r)}>
                      <TableCell className="text-muted-foreground">{r.rank}</TableCell>
                      <TableCell className="max-w-[400px] truncate">{r.title}</TableCell>
                      <TableCell>{r.author || "—"}</TableCell>
                      <TableCell>{r.likes || "—"}</TableCell>
                      <TableCell className="text-right">
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary text-xs hover:underline" onClick={(e) => e.stopPropagation()}>
                          打开 <ExternalLink className="h-3 w-3 ml-0.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>评论 — {selected.title.slice(0, 60)}</CardTitle>
            <CardDescription>选中评论后下方输入回评</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {comments === null ? (
              <Skeleton className="h-32 w-full" />
            ) : comments.length === 0 ? (
              <EmptyState icon={MessageSquareReply} title="未抓到评论" description="可能没有评论或选择器需要更新" />
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {comments.map((c) => (
                  <li
                    key={c.comment_id || `${c.rank}-${c.author}`}
                    className={cn(
                      "rounded-lg border border-border px-3 py-2 cursor-pointer transition-colors",
                      replyTarget?.comment_id === c.comment_id ? "bg-accent border-accent-foreground/20" : "bg-muted/20 hover:bg-muted/40",
                    )}
                    onClick={() => setReplyTarget((cur) => (cur?.comment_id === c.comment_id ? null : c))}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.author || "(匿名)"}</span>
                      <span>·</span>
                      <span>{c.created_at || "—"}</span>
                      <span>·</span>
                      <span>👍 {c.likes || 0}</span>
                    </div>
                    <div className="text-sm mt-0.5">{c.text}</div>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs text-muted-foreground">
                {replyTarget ? `回复 @${replyTarget.author}` : "一级评论"}
              </div>
              <textarea
                className="w-full min-h-[68px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                placeholder="写点什么…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => sendReply(true)} disabled={!replyText.trim()}>
                  Dry Run
                </Button>
                <Button size="sm" onClick={() => sendReply(false)} disabled={!replyText.trim()}>
                  <Send className="h-3 w-3" /> 真发送
                </Button>
                {replyTarget && (
                  <Button variant="ghost" size="sm" onClick={() => setReplyTarget(null)}>
                    取消回复
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DoctorBadge({ state }: { state: "unknown" | "ok" | "fail" }) {
  if (state === "ok") {
    return <Badge variant="outline" className="text-success border-success/30"><CheckCircle2 className="h-3 w-3 mr-1" /> opencli OK</Badge>;
  }
  if (state === "fail") {
    return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" /> opencli 不可用</Badge>;
  }
  return <Badge variant="outline"><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> 检测中</Badge>;
}

// ─────────────────────────────────────────────────────────────────────────
// 回复模板 — CRUD-lite (list + add)
// ─────────────────────────────────────────────────────────────────────────

function ReplyTemplatesPanel() {
  const [templates, setTemplates] = useState<ReplyTemplate[] | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    getJSON<{ templates: ReplyTemplate[] }>("/api/social/reply-templates")
      .then((r) => setTemplates(r.templates || []))
      .catch((e) => setError(String(e)));

  useEffect(() => { reload(); }, []);

  async function add() {
    if (!text.trim()) return;
    setError(null);
    try {
      await postJSON<ReplyTemplate>("/api/social/reply-templates", { name: name || undefined, text });
      setName("");
      setText("");
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>回复模板</CardTitle>
        <CardDescription>常用回评话术，截流面板可直接调用（后续）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2">
          <Input placeholder="名称（可选）" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="模板文本" value={text} onChange={(e) => setText(e.target.value)} />
          <Button onClick={add} disabled={!text.trim()}>
            <Plus className="h-3.5 w-3.5" /> 添加
          </Button>
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        {templates === null ? (
          <Skeleton className="h-12 w-full" />
        ) : templates.length === 0 ? (
          <EmptyState icon={MessageSquareReply} title="还没有模板" description="先添加几条常用回评" />
        ) : (
          <ul className="space-y-1.5">
            {templates.map((t) => (
              <li key={t.id} className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">{t.name}</div>
                <div className="text-sm">{t.text}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
