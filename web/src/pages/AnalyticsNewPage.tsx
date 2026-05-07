import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function AnalyticsNewPage() {
  return (
    <EmptyState
      icon={Construction}
      title="数据分析 — Phase 8"
      description="Funnel / 关键指标 / 收益 / API 监控；接现有 AnalyticsPage 数据源 + 新设计语言"
    />
  );
}
