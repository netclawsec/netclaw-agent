import { useEffect, useState } from "react";
import { TrendingUp, Hash, DollarSign } from "lucide-react";
import { api, type AnalyticsResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart, type LineSeries } from "@/components/charts/Line";
import { BarChart } from "@/components/charts/Bar";
import { DonutChart } from "@/components/charts/Donut";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PERIODS = [
  { label: "7天", days: 7 },
  { label: "30天", days: 30 },
  { label: "90天", days: 90 },
] as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

const MODEL_PALETTE = ["#7C3AED", "#F472B6", "#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#6366F1", "#06B6D4"];

export default function AnalyticsNewPage() {
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.getAnalytics(period)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const dailySorted = data ? [...data.daily].sort((a, b) => a.day.localeCompare(b.day)) : [];
  const labels = dailySorted.map((d) => d.day.slice(5)); // MM-DD
  const series: LineSeries[] = data
    ? [
        { name: "Input", color: "#7C3AED", data: dailySorted.map((d) => d.input_tokens) },
        { name: "Output", color: "#10B981", data: dailySorted.map((d) => d.output_tokens) },
        { name: "Cache", color: "#F59E0B", data: dailySorted.map((d) => d.cache_read_tokens) },
      ]
    : [];

  const modelDonut = data
    ? data.by_model.slice(0, 8).map((m, i) => ({
        label: m.model || "—",
        value: m.input_tokens + m.output_tokens,
        color: MODEL_PALETTE[i % MODEL_PALETTE.length],
      }))
    : [];

  const sessionsByDay = dailySorted.map((d) => ({ label: d.day.slice(5), value: d.sessions }));

  const totalCost = data?.totals.total_estimated_cost ?? 0;
  const totalSessions = data?.totals.total_sessions ?? 0;
  const totalInput = data?.totals.total_input ?? 0;
  const totalOutput = data?.totals.total_output ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">观察期 / Period</div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <Button
              key={p.days}
              variant={period === p.days ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Sessions" value={String(totalSessions)} icon={TrendingUp} trend={dailySorted.map((d) => d.sessions)} color="#7C3AED" loading={!data} />
        <Kpi label="Input tokens" value={formatTokens(totalInput)} icon={Hash} trend={dailySorted.map((d) => d.input_tokens)} color="#10B981" loading={!data} />
        <Kpi label="Output tokens" value={formatTokens(totalOutput)} icon={Hash} trend={dailySorted.map((d) => d.output_tokens)} color="#F59E0B" loading={!data} />
        <Kpi label="Estimated cost" value={formatCost(totalCost)} icon={DollarSign} trend={dailySorted.map((d) => d.estimated_cost)} color="#EF4444" loading={!data} />
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-xl lg:col-span-2">
          <CardHeader>
            <CardTitle>Token 趋势 / Token Trend</CardTitle>
            <CardDescription>近 {period} 天每日 input/output/cache</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? (
              <>
                <LineChart series={series} labels={labels} height={240} />
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {series.map((s) => (
                    <span key={s.name} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <Skeleton className="h-60 w-full" />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>模型分布 / Model Mix</CardTitle>
            <CardDescription>token 总量 (input+output)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {data ? (
              <>
                <DonutChart
                  data={modelDonut}
                  centerLabel={
                    <div>
                      <div className="text-base font-display font-bold">{data.by_model.length}</div>
                      <div className="text-[0.65rem] text-muted-foreground">模型</div>
                    </div>
                  }
                />
                <ul className="w-full text-xs space-y-1">
                  {modelDonut.map((m) => (
                    <li key={m.label} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
                      <span className="flex-1 truncate">{m.label}</span>
                      <span className="text-muted-foreground">{formatTokens(m.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Skeleton className="h-60 w-full" />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>每日会话数 / Sessions per Day</CardTitle>
          </CardHeader>
          <CardContent>{data ? <BarChart data={sessionsByDay} height={200} /> : <Skeleton className="h-52 w-full" />}</CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>模型成本 / Model Cost</CardTitle>
            <CardDescription>按 estimated_cost 排序</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead>会话</TableHead>
                    <TableHead>Input</TableHead>
                    <TableHead>Output</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.by_model.slice(0, 10).map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-medium">{m.model || "—"}</TableCell>
                      <TableCell>{m.sessions}</TableCell>
                      <TableCell>{formatTokens(m.input_tokens)}</TableCell>
                      <TableCell>{formatTokens(m.output_tokens)}</TableCell>
                      <TableCell>{formatCost(m.estimated_cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

interface KpiProps {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  trend: number[];
  color: string;
  loading?: boolean;
}

function Kpi({ label, value, icon: Icon, trend, color, loading }: KpiProps) {
  if (loading) return <Skeleton className={cn("h-28 rounded-xl")} />;
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl font-display font-bold">{value}</div>
          <Sparkline data={trend.length ? trend : [0]} width={70} height={28} stroke={color} fill={color} />
        </div>
      </CardContent>
    </Card>
  );
}
