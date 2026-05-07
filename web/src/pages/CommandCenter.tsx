import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowUpRight, MessageCircle, Send, Layers, CheckCircle2, XCircle, Cpu,
} from "lucide-react";
import { api, type SessionInfo, type StatusResponse, type AnalyticsResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart, type LineSeries } from "@/components/charts/Line";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface SkillsResp {
  skills: { name: string; description?: string; category?: string; domain?: string }[];
}

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

  // KPIs strictly from real APIs.
  const dailySorted = analytics ? [...analytics.daily].sort((a, b) => a.day.localeCompare(b.day)) : [];
  const sessionTrend = dailySorted.map((d) => d.sessions);
  const inputTrend = dailySorted.map((d) => d.input_tokens);
  const outputTrend = dailySorted.map((d) => d.output_tokens);
  const costTrend = dailySorted.map((d) => d.estimated_cost);

  const channels = status ? Object.entries(status.gateway_platforms ?? {}) : [];

  const tokenSeries: LineSeries[] = [
    { name: "Input", color: "#7C3AED", data: inputTrend },
    { name: "Output", color: "#10B981", data: outputTrend },
  ];
  const tokenLabels = dailySorted.map((d) => d.day.slice(5));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          所有数据接口都失败：{error}
        </div>
      )}

      {/* KPI tiles — every value is from a live endpoint */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="活跃会话 / Active sessions"
          icon={MessageCircle}
          value={sessions ? String(sessions.filter((s) => s.is_active).length) : null}
          trend={sessionTrend}
          loading={sessions === null}
          color="#7C3AED"
        />
        <Kpi
          label="已连通道 / Channels"
          icon={Send}
          value={status ? String(channels.length) : null}
          trend={[]}
          loading={status === null}
          color="#10B981"
        />
        <Kpi
          label="近 7 天 token 输入"
          icon={Cpu}
          value={analytics ? formatTokens(analytics.totals.total_input) : null}
          trend={inputTrend}
          loading={analytics === null}
          color="#F59E0B"
        />
        <Kpi
          label="近 7 天预估成本"
          icon={ArrowUpRight}
          value={analytics ? `$${analytics.totals.total_estimated_cost.toFixed(2)}` : null}
          trend={costTrend}
          loading={analytics === null}
          color="#EF4444"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Token trend (real, from /api/analytics/usage?days=7) */}
        <Card className="rounded-xl lg:col-span-2">
          <CardHeader>
            <CardTitle>Token 趋势 / 近 7 天</CardTitle>
            <CardDescription>按天聚合的 input/output（真实数据，无填充）</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics === null ? (
              <Skeleton className="h-56 w-full" />
            ) : dailySorted.length === 0 ? (
              <EmptyState icon={Activity} title="还没有 token 流量" description="跑一次 Agent 任务就有数据" />
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

        {/* Channels (real, from /api/status.gateway_platforms) */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>渠道 / Channels</CardTitle>
            <CardDescription>来自 gateway watcher</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {status === null ? (
              <div className="space-y-2"><Skeleton className="h-7" /><Skeleton className="h-7" /><Skeleton className="h-7" /></div>
            ) : channels.length === 0 ? (
              <EmptyState icon={Send} title="暂无已连通道" description="先在 Settings → Runtime → Config 配置一个" />
            ) : (
              channels.slice(0, 8).map(([name, ps]) => (
                <div key={name} className="flex items-center gap-2.5">
                  <ChannelStatus state={ps.state} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">{ps.state || "—"}{ps.error_message ? ` · ${ps.error_message}` : ""}</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Skills count (real, from /api/skills) */}
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
                <div className="text-3xl font-display font-bold">{skillsCount}</div>
                <Button variant="outline" size="sm" onClick={() => navigate("/settings/runtime/skills")}>
                  管理 <ArrowUpRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent sessions (real) */}
        <Card className="rounded-xl lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>最近会话</CardTitle>
              <CardDescription>来自 /api/sessions</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/agent-chat")}>
              查看全部
              <ArrowUpRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {sessions === null ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-9 w-full" /> <Skeleton className="h-9 w-full" />
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="还没有会话"
                description="去 Agent Chat 发起一次任务"
                action={<Button size="sm" onClick={() => navigate("/agent-chat")}>开始对话</Button>}
              />
            ) : (
              <ul className="divide-y divide-border">
                {sessions.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <div className="font-mono text-xs text-muted-foreground w-20 truncate">
                      {s.id.slice(0, 8)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.title || "(untitled)"}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.message_count} 条 · {s.model || "—"}
                      </div>
                    </div>
                    <Badge variant="outline">{s.is_active ? "active" : "ended"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface KpiProps {
  label: string;
  icon: typeof Activity;
  value: string | null;
  trend: number[];
  color: string;
  loading?: boolean;
}

function Kpi({ label, icon: Icon, value, trend, color, loading }: KpiProps) {
  if (loading) {
    return <Skeleton className="h-28 rounded-xl" />;
  }
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl font-display font-bold">{value ?? "—"}</div>
          {trend.length > 1 && (
            <Sparkline data={trend} className="text-primary" fill={color} stroke={color} width={70} height={28} />
          )}
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
