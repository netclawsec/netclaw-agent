import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowUpRight, Sparkles, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, Users, Send, MessageCircle,
} from "lucide-react";
import { api, type SessionInfo, type StatusResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/Line";
import { BarChart } from "@/components/charts/Bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiTile {
  label: string;
  value: string;
  trend: number[];
  delta?: string;
  color?: string;
  icon?: typeof Activity;
}

const SAMPLE_TREND = [42, 45, 41, 48, 52, 50, 56, 60, 58, 65, 70, 72];

const RECOMMENDATIONS = [
  { title: "Wechat 切到晚 8 点发布", impact: "+18% 互动", priority: "high" as const },
  { title: "Douyin 短剧切 Hook v3", impact: "+24% 完播", priority: "high" as const },
  { title: "XHS 标题前 12 字加表情", impact: "+9% CTR", priority: "med" as const },
  { title: "重发上周失败的 3 条 IG 任务", impact: "覆盖损失", priority: "med" as const },
];

const SOCIAL_HEALTH = [
  { name: "Douyin", uptime: 99.4, status: "ok" as const },
  { name: "Xiaohongshu", uptime: 98.1, status: "ok" as const },
  { name: "Wechat", uptime: 100, status: "ok" as const },
  { name: "Instagram", uptime: 87.3, status: "warn" as const },
  { name: "TikTok", uptime: 0, status: "down" as const },
  { name: "YouTube", uptime: 99.9, status: "ok" as const },
];

const LINE_LABELS = ["1日", "5日", "10日", "15日", "20日", "25日", "30日"];
const LINE_SERIES = [
  { name: "Douyin", color: "#7C3AED", data: [40, 65, 55, 80, 95, 120, 140] },
  { name: "Xiaohongshu", color: "#F59E0B", data: [30, 35, 50, 60, 75, 88, 100] },
  { name: "Wechat", color: "#10B981", data: [60, 70, 65, 75, 85, 90, 95] },
];

const AUDIENCE_BARS = [
  { label: "Douyin", value: 1240, color: "#7C3AED" },
  { label: "XHS", value: 880, color: "#F472B6" },
  { label: "Wechat", value: 620, color: "#10B981" },
  { label: "YouTube", value: 410, color: "#EF4444" },
  { label: "X", value: 320, color: "#3B82F6" },
  { label: "LinkedIn", value: 180, color: "#6366F1" },
];

export default function CommandCenter() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getStatus(), api.getSessions()])
      .then(([s, paged]) => {
        if (cancelled) return;
        setStatus(s);
        setSessions(paged.sessions);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis: KpiTile[] = [
    {
      label: "活跃会话 / Active Sessions",
      value: String(sessions.length),
      trend: SAMPLE_TREND,
      delta: "+12%",
      color: "#7C3AED",
      icon: MessageCircle,
    },
    {
      label: "已连通道 / Channels",
      value: String(Object.keys(status?.gateway_platforms ?? {}).length),
      trend: SAMPLE_TREND.map((v) => v * 0.6),
      delta: "+3",
      color: "#10B981",
      icon: Send,
    },
    {
      label: "今日互动 / Engagements",
      value: "1,248",
      trend: SAMPLE_TREND.map((v) => v * 1.2),
      delta: "+18%",
      color: "#F59E0B",
      icon: Users,
    },
    {
      label: "互动率 / Engage Rate",
      value: "5.82%",
      trend: SAMPLE_TREND.map((v) => v * 0.8),
      delta: "+0.4pp",
      color: "#3B82F6",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          : kpis.map((kpi) => (
              <Card key={kpi.label} className="rounded-xl">
                <CardContent className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {kpi.icon && <kpi.icon className="h-3.5 w-3.5" />}
                    {kpi.label}
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="text-2xl font-display font-bold">{kpi.value}</div>
                      {kpi.delta && (
                        <div className="text-[0.7rem] text-success flex items-center gap-0.5">
                          <ArrowUpRight className="h-3 w-3" /> {kpi.delta}
                        </div>
                      )}
                    </div>
                    <Sparkline data={kpi.trend} className="text-primary" fill="currentColor" width={70} height={28} stroke={kpi.color} />
                  </div>
                </CardContent>
              </Card>
            ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-xl lg:col-span-2">
          <CardHeader>
            <CardTitle>渠道趋势 / Channel Trend</CardTitle>
            <CardDescription>近 30 天每日发布按渠道分组</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart series={LINE_SERIES} labels={LINE_LABELS} height={220} />
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              {LINE_SERIES.map((s) => (
                <span key={s.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>Agent 推荐 / Recommendations</CardTitle>
            <CardDescription>基于近 7 天数据自动产出</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {RECOMMENDATIONS.map((rec) => (
              <button
                key={rec.title}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left hover:bg-muted/60 transition-colors"
              >
                <Sparkles className={rec.priority === "high" ? "h-4 w-4 text-primary shrink-0" : "h-4 w-4 text-warning shrink-0"} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{rec.title}</div>
                  <div className="text-xs text-muted-foreground">预计 {rec.impact}</div>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>渠道健康 / Channel Health</CardTitle>
            <CardDescription>近 7 天连接状态</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {SOCIAL_HEALTH.map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                {c.status === "ok" && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
                {c.status === "warn" && <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                {c.status === "down" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">uptime {c.uptime}%</div>
                </div>
                <div className="flex h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${c.uptime}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-xl lg:col-span-2">
          <CardHeader>
            <CardTitle>互动量分布 / Audience Engagement</CardTitle>
            <CardDescription>过去 30 天</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart data={AUDIENCE_BARS} height={220} />
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="rounded-xl">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>最近会话 / Recent Sessions</CardTitle>
              <CardDescription>来自 Agent runtime</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/agent-chat")}>
              查看全部 <ArrowUpRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="还没有运行中的会话"
                description="启动一次 Agent 任务，这里会出现实时记录"
                action={
                  <Button size="sm" onClick={() => navigate("/agent-chat")}>
                    开始对话
                  </Button>
                }
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
