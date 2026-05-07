import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowUpRight, MessageCircle, Send, Cpu, Sparkles, TrendingUp,
  CheckCircle2, XCircle, Layers, Zap,
} from "lucide-react";
import { api, type SessionInfo, type StatusResponse, type AnalyticsResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart, type LineSeries } from "@/components/charts/Line";
import { BarChart } from "@/components/charts/Bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface SkillsResp {
  skills: { name: string; description?: string; category?: string; domain?: string }[];
}

interface Recommendation {
  id: string;
  icon: typeof Sparkles;
  title: string;
  detail: string;
  cta: string;
  href: string;
}

const RECS: Recommendation[] = [
  {
    id: "publish",
    icon: Send,
    title: "今日待发内容",
    detail: "队列里有内容未审核，建议优先处理",
    cta: "去发布",
    href: "/social",
  },
  {
    id: "video",
    icon: Sparkles,
    title: "试试 AI 视频脚本",
    detail: "用 manim/video skill 一键生成脚本草稿",
    cta: "AI 视频",
    href: "/studio/video",
  },
  {
    id: "wechat",
    icon: MessageCircle,
    title: "微信消息待回复",
    detail: "客户咨询，AI 已起草回复，等审核",
    cta: "WeChat",
    href: "/wechat",
  },
];

export default function CommandCenter() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [skillsCount, setSkillsCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.getStatus(),
      api.getSessions(20, 0),
      api.getAnalytics(7),
      fetch("/api/skills").then((r) => r.json() as Promise<SkillsResp>),
    ]).then((results) => {
      if (cancelled) return;
      const [s, sess, ana, sk] = results;
      if (s.status === "fulfilled") setStatus(s.value);
      if (sess.status === "fulfilled") setSessions(sess.value.sessions);
      else setSessions([]);
      if (ana.status === "fulfilled") setAnalytics(ana.value);
      if (sk.status === "fulfilled") setSkillsCount(sk.value.skills?.length ?? 0);
      const errs = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
      if (errs.length === results.length) setError(errs.join(" / "));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dailySorted = analytics ? [...analytics.daily].sort((a, b) => a.day.localeCompare(b.day)) : [];
  const sessionTrend = dailySorted.map((d) => d.sessions);
  const inputTrend = dailySorted.map((d) => d.input_tokens);
  const outputTrend = dailySorted.map((d) => d.output_tokens);

  const channels = status ? Object.entries(status.gateway_platforms ?? {}) : [];
  const activeChannels = channels.filter(([, ps]) => ps.state === "connected" || ps.state === "running" || ps.state === "ready");

  // Engagement-style synthesis (real data only — derived from analytics totals)
  const totalMsgs = sessions ? sessions.reduce((a, s) => a + (s.message_count ?? 0), 0) : 0;
  const avgPerSession = sessions && sessions.length > 0 ? Math.round(totalMsgs / sessions.length * 10) / 10 : 0;

  const tokenSeries: LineSeries[] = [
    { name: "Input", color: "#7C3AED", data: inputTrend },
    { name: "Output", color: "#10B981", data: outputTrend },
  ];
  const tokenLabels = dailySorted.map((d) => d.day.slice(5));

  const engagementBars = dailySorted.slice(-5).map((d) => ({ label: d.day.slice(5), value: d.sessions, color: "#7C3AED" }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            数据接口都失败：{error}
          </div>
        )}

        {/* Top KPI tiles — operational metrics from real APIs */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi
            label="活跃会话"
            sub="Active Sessions"
            icon={MessageCircle}
            value={sessions ? String(sessions.filter((s) => s.is_active).length) : null}
            trend={sessionTrend}
            loading={sessions === null}
            color="#7C3AED"
          />
          <Kpi
            label="已连通道"
            sub="Channels"
            icon={Send}
            value={status ? String(activeChannels.length) : null}
            trend={[]}
            loading={status === null}
            color="#10B981"
            secondary={status ? `共 ${channels.length}` : ""}
          />
          <Kpi
            label="近 7 日消息"
            sub="Messages 7d"
            icon={Activity}
            value={sessions ? compact(totalMsgs) : null}
            trend={sessionTrend}
            loading={sessions === null}
            color="#F59E0B"
          />
          <Kpi
            label="Token 输入"
            sub="Input tokens 7d"
            icon={Cpu}
            value={analytics ? compact(analytics.totals.total_input) : null}
            trend={inputTrend}
            loading={analytics === null}
            color="#3B82F6"
          />
          <Kpi
            label="预估成本"
            sub="Cost 7d"
            icon={ArrowUpRight}
            value={analytics ? `$${analytics.totals.total_estimated_cost.toFixed(2)}` : null}
            trend={dailySorted.map((d) => d.estimated_cost)}
            loading={analytics === null}
            color="#EF4444"
          />
        </section>

        {/* Token trend (real, big chart) */}
        <Card className="rounded-xl">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>AI 自动化输出 / AI Automation Output</CardTitle>
              <CardDescription>近 7 天 token 输入/输出（按天聚合，来自 /api/analytics/usage）</CardDescription>
            </div>
            <Badge variant="outline" className="hidden sm:flex">7 days</Badge>
          </CardHeader>
          <CardContent>
            {analytics === null ? (
              <Skeleton className="h-56 w-full" />
            ) : dailySorted.length === 0 ? (
              <EmptyState icon={Activity} title="还没有 token 流量" description="跑一次 Agent 任务即有数据" />
            ) : (
              <>
                <LineChart series={tokenSeries} labels={tokenLabels} height={220} />
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {tokenSeries.map((s) => (
                    <span key={s.name} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Channel health + Recent activity */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>渠道健康 / Channel Health</CardTitle>
              <CardDescription>来自 gateway watcher</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {status === null ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-7" /><Skeleton className="h-7" /><Skeleton className="h-7" />
                </div>
              ) : channels.length === 0 ? (
                <EmptyState icon={Send} title="暂无已连通道" description="先在 Settings → Runtime → Config 配置一个" />
              ) : (
                channels.slice(0, 8).map(([name, ps]) => (
                  <div key={name} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/40">
                    <ChannelStatus state={ps.state} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ps.state || "—"}{ps.error_message ? ` · ${ps.error_message}` : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>最近会话 / Recent Sessions</CardTitle>
                <CardDescription>来自 /api/sessions</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/agent-chat")}>
                查看全部 <ArrowUpRight className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {sessions === null ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" />
                </div>
              ) : sessions.length === 0 ? (
                <EmptyState icon={Activity} title="还没有会话" description="去 Agent Chat 发起一次任务" />
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/40">
                      <div className="font-mono text-xs text-muted-foreground w-16 truncate">{s.id.slice(0, 8)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{s.title || "(untitled)"}</div>
                        <div className="text-xs text-muted-foreground">{s.message_count} 条 · {s.model || "—"}</div>
                      </div>
                      <Badge variant="outline">{s.is_active ? "active" : "ended"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Engagement bars + Skills */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-xl lg:col-span-2">
            <CardHeader>
              <CardTitle>内容互动趋势 / Engagement Trend</CardTitle>
              <CardDescription>近 5 天会话数（按天）</CardDescription>
            </CardHeader>
            <CardContent>
              {dailySorted.length === 0 ? (
                <EmptyState icon={TrendingUp} title="暂无数据" description="跑几次 agent 后会出现" />
              ) : (
                <BarChart data={engagementBars} height={160} />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>已安装 Skills</CardTitle>
              <CardDescription>来自 ~/.netclaw/skills</CardDescription>
            </CardHeader>
            <CardContent>
              {skillsCount === null ? (
                <Skeleton className="h-12 w-1/3" />
              ) : (
                <div className="flex items-end justify-between gap-2">
                  <div className="font-display text-3xl font-bold">{skillsCount}</div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/settings/runtime/skills")}>
                    管理 <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {sessions && sessions.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground">
                  平均每会话 {avgPerSession} 条消息
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Right rail — Agent Recommendations */}
      <aside className="space-y-3">
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Agent 智能推荐
            </CardTitle>
            <CardDescription>来自当前 KPI / 队列状态的建议</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {RECS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(r.href)}
                className="w-full text-left rounded-lg border border-border bg-card hover:border-primary/40 transition-colors p-3"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                    <r.icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.detail}</div>
                    <span className="inline-flex items-center gap-1 text-[0.7rem] text-primary mt-1">
                      {r.cta} <ArrowUpRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>系统状态</CardTitle>
            <CardDescription>Agent / Gateway / License</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <SystemRow label="Agent" ok={status !== null} value={status ? `v${status.version}` : "—"} />
            <SystemRow
              label="Gateway"
              ok={status?.gateway_running ?? false}
              value={status?.gateway_state ?? "—"}
            />
            <SystemRow label="License" ok={true} value="license.netclawsec.com.cn" />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface KpiProps {
  label: string;
  sub?: string;
  icon: typeof Activity;
  value: string | null;
  trend: number[];
  color: string;
  loading?: boolean;
  secondary?: string;
}

function Kpi({ label, sub, icon: Icon, value, trend, color, loading, secondary }: KpiProps) {
  if (loading) return <Skeleton className="h-24 rounded-xl" />;
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground uppercase tracking-[0.06em]">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="font-display text-xl font-bold tabular-nums">{value ?? "—"}</div>
          {trend.length > 1 && (
            <Sparkline data={trend} className="text-primary" fill={color} stroke={color} width={56} height={20} />
          )}
        </div>
        <div className="text-[0.6rem] text-muted-foreground flex items-center justify-between">
          <span>{sub}</span>
          {secondary && <span>{secondary}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelStatus({ state }: { state?: string | null }) {
  const ok = state === "connected" || state === "running" || state === "ready";
  const fail = state === "failed" || state === "error" || state === "down";
  if (ok) return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
  if (fail) return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <Layers className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function SystemRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        {ok ? <CheckCircle2 className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-destructive" />}
        <span className="font-mono">{value}</span>
      </span>
    </div>
  );
}
