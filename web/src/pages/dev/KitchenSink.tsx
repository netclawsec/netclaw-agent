import { useEffect, useRef, useState } from "react";
import {
  Activity, BarChart3, Calendar, FileVideo, Image as ImageIcon,
  MessageSquare, MessagesSquare, Settings, Share2, Sparkles, Plus, ArrowRight,
} from "lucide-react";
import { useTheme } from "@/themes";
import { AppShell } from "@/components/shell/AppShell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Sparkline } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/Line";
import { BarChart } from "@/components/charts/Bar";
import { DonutChart } from "@/components/charts/Donut";

const NAV: { path: string; label: string; icon: typeof Activity; badge?: string | number }[] = [
  { path: "/dev/kitchen-sink", label: "工作台 / Command Center", icon: Activity },
  { path: "/dev/social", label: "社交媒体自动发布", icon: Share2, badge: 3 },
  { path: "/dev/video", label: "AI 视频工作室", icon: FileVideo },
  { path: "/dev/image", label: "AI 图像工作室", icon: ImageIcon },
  { path: "/dev/wechat", label: "微信回复", icon: MessageSquare, badge: 12 },
  { path: "/dev/agent-chat", label: "Agent Chat", icon: MessagesSquare },
  { path: "/dev/analytics", label: "数据分析", icon: BarChart3 },
  { path: "/dev/settings", label: "设置", icon: Settings },
];

const KPI = [
  { label: "通道总数 / Channels", value: "156", trend: [40, 42, 41, 45, 48, 50, 52, 51, 55, 58, 60, 62] },
  { label: "活跃 Agent / Active", value: "312", trend: [80, 85, 82, 90, 95, 100, 98, 105, 110, 115, 118, 120] },
  { label: "今日发布 / Today", value: "1,248", trend: [10, 15, 12, 20, 28, 35, 42, 48, 55, 62, 70, 78] },
  { label: "互动率 / Engage", value: "5.82%", trend: [3, 3.2, 3.5, 4, 4.2, 4.8, 5.1, 5.3, 5.5, 5.7, 5.8, 5.82] },
];

const LINE_LABELS = ["1日", "5日", "10日", "15日", "20日", "25日", "30日"];
const LINE_SERIES = [
  { name: "Douyin", color: "#7C3AED", data: [40, 65, 55, 80, 95, 120, 140] },
  { name: "Xiaohongshu", color: "#F59E0B", data: [30, 35, 50, 60, 75, 88, 100] },
  { name: "Wechat", color: "#10B981", data: [60, 70, 65, 75, 85, 90, 95] },
];

const BAR_DATA = [
  { label: "Douyin", value: 1240, color: "#7C3AED" },
  { label: "XHS", value: 880, color: "#F472B6" },
  { label: "Wechat", value: 620, color: "#10B981" },
  { label: "YouTube", value: 410, color: "#EF4444" },
  { label: "X/Twitter", value: 320, color: "#3B82F6" },
  { label: "LinkedIn", value: 180, color: "#6366F1" },
];

const DONUT_DATA = [
  { label: "Posts", value: 45, color: "#7C3AED" },
  { label: "Stories", value: 28, color: "#F472B6" },
  { label: "Videos", value: 18, color: "#10B981" },
  { label: "Live", value: 9, color: "#F59E0B" },
];

const TABLE_ROWS = [
  { id: "TSK-1042", title: "9月秋季新品种草", channel: "Douyin", status: "已发布", at: "2025-09-15 10:30" },
  { id: "TSK-1041", title: "用户案例视频 v2", channel: "Xiaohongshu", status: "审核中", at: "2025-09-15 09:15" },
  { id: "TSK-1040", title: "活动落地页推广", channel: "Wechat", status: "排队中", at: "2025-09-15 08:00" },
  { id: "TSK-1039", title: "Q3 数据周报", channel: "LinkedIn", status: "失败", at: "2025-09-14 22:40" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "已发布": "default",
  "审核中": "secondary",
  "排队中": "outline",
  "失败": "destructive",
};

export default function KitchenSink() {
  const { setTheme, themeName } = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Capture theme name at mount via ref so the unmount cleanup uses the value
  // that existed before we forced "netclaw-light", not whatever's in scope.
  const previousThemeRef = useRef(themeName);

  // Force netclaw-light on mount, restore on unmount.
  useEffect(() => {
    const previous = previousThemeRef.current;
    setTheme("netclaw-light");
    return () => {
      if (previous && previous !== "netclaw-light") setTheme(previous);
    };
  }, [setTheme]);

  return (
    <AppShell
      brand="Netclaw"
      brandSubtitle="AI Marketing Agent"
      sidebarItems={NAV}
      user={{ name: "Katherine", subtitle: "Super Admin" }}
      topbarTitle="Kitchen Sink — Phase 0 Foundation"
      topbarSubtitle="Design system primitives + charts + shell"
      topbarBreadcrumbs={[{ label: "Dev" }, { label: "Kitchen Sink" }]}
      notifications={3}
      onSearch={() => undefined}
    >
      <div className="space-y-6">
        {/* KPI row */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {KPI.map((kpi) => (
            <Card key={kpi.label} className="rounded-xl">
              <CardContent className="space-y-2.5">
                <div className="text-xs text-muted-foreground">{kpi.label}</div>
                <div className="flex items-end justify-between gap-2">
                  <div className="text-2xl font-display font-bold">{kpi.value}</div>
                  <Sparkline data={kpi.trend} className="text-primary" fill="currentColor" width={64} height={24} />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Charts row */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-xl lg:col-span-2">
            <CardHeader>
              <CardTitle>渠道趋势 / Channel Trend</CardTitle>
              <CardDescription>近 30 天每日发布量按渠道分组</CardDescription>
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
              <CardTitle>内容类型 / Mix</CardTitle>
              <CardDescription>本月内容类型分布</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <DonutChart
                data={DONUT_DATA}
                centerLabel={
                  <div>
                    <div className="text-2xl font-display font-bold">100</div>
                    <div className="text-[0.65rem] text-muted-foreground">条</div>
                  </div>
                }
              />
              <ul className="w-full text-xs space-y-1.5">
                {DONUT_DATA.map((d) => (
                  <li key={d.label} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                    <span className="flex-1">{d.label}</span>
                    <span className="text-muted-foreground">{d.value}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* Bar chart + Form */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-xl lg:col-span-2">
            <CardHeader>
              <CardTitle>渠道表现 / Channel Performance</CardTitle>
              <CardDescription>过去 30 天发布数量</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart data={BAR_DATA} height={220} />
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>快速发布 / Quick Publish</CardTitle>
              <CardDescription>表单基元演示</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="标题 / Title" />
              <Input placeholder="标签（逗号分隔）" />
              <div className="flex flex-wrap gap-1.5">
                <Badge>Douyin</Badge>
                <Badge variant="secondary">XHS</Badge>
                <Badge variant="outline">Wechat</Badge>
                <Badge variant="destructive">未连接</Badge>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={() => setDialogOpen(true)} className="flex-1">
                  <Plus className="h-3.5 w-3.5" /> 立即发布
                </Button>
                <Button variant="outline" onClick={() => setDrawerOpen(true)}>
                  <Calendar className="h-3.5 w-3.5" /> 排期
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Table */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>最近任务 / Recent Tasks</CardTitle>
            <CardDescription>Table primitive demo</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>渠道</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TABLE_ROWS.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.id}</TableCell>
                    <TableCell>{row.title}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status] ?? "default"}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{row.at}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Tabs + Avatar + Tooltip + Skeleton + EmptyState */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>Tabs / Avatar / Tooltip</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="team">
                {(active, setActive) => (
                  <>
                    <TabsList>
                      <TabsTrigger active={active === "team"} value="team" onClick={() => setActive("team")}>
                        团队
                      </TabsTrigger>
                      <TabsTrigger active={active === "skeleton"} value="skeleton" onClick={() => setActive("skeleton")}>
                        Skeleton
                      </TabsTrigger>
                      <TabsTrigger active={active === "empty"} value="empty" onClick={() => setActive("empty")}>
                        EmptyState
                      </TabsTrigger>
                    </TabsList>
                    {active === "team" && (
                      <div className="flex items-center gap-3 pt-3">
                        {["Katherine", "Bob", "Yu", "Ana"].map((n) => (
                          <Tooltip key={n} content={n}>
                            <Avatar fallback={n} size="md" />
                          </Tooltip>
                        ))}
                        <Tooltip content="See all 12 members">
                          <Button variant="ghost" size="sm">
                            +8 <ArrowRight className="h-3 w-3" />
                          </Button>
                        </Tooltip>
                      </div>
                    )}
                    {active === "skeleton" && (
                      <div className="space-y-2 pt-3">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    )}
                    {active === "empty" && (
                      <EmptyState
                        icon={Sparkles}
                        title="还没有任何 AI 推荐"
                        description="连接至少一个渠道并发布 1 条内容后，Agent 会自动给出优化建议。"
                        action={
                          <Button size="sm" variant="outline">
                            连接渠道
                          </Button>
                        }
                      />
                    )}
                  </>
                )}
              </Tabs>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>Agent 推荐 / Recommendations</CardTitle>
              <CardDescription>每张卡示意完整可点击区</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { title: "切换 Wechat 至晚间 8 点发布", impact: "+18% 互动" },
                { title: "Douyin 短剧切到 Hook v3 模板", impact: "+24% 完播" },
                { title: "XHS 标题前 12 字加表情", impact: "+9% CTR" },
              ].map((rec) => (
                <div
                  key={rec.title}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 hover:bg-muted/60 transition-colors cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{rec.title}</div>
                    <div className="text-xs text-muted-foreground">预计 {rec.impact}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="确认立即发布"
        description="该内容将同时下发到所有勾选渠道"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">该操作不可撤销。继续？</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => setDialogOpen(false)}>确认发布</Button>
          </div>
        </div>
      </Dialog>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="排期 / Schedule">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">选择发布时间</p>
          <Input type="datetime-local" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDrawerOpen(false)}>
              取消
            </Button>
            <Button className="flex-1" onClick={() => setDrawerOpen(false)}>
              加入队列
            </Button>
          </div>
        </div>
      </Drawer>
    </AppShell>
  );
}
