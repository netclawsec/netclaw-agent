import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function SocialPage() {
  return (
    <EmptyState
      icon={Construction}
      title="社交媒体自动发布 — Phase 3"
      description="日历调度 / 内容队列 / 素材库 / 截流 / 回复 — 5 个 tab + opencli 抖音/小红书 adapter，正在落地。"
    />
  );
}
