import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ImageStudioPage() {
  return (
    <EmptyState
      icon={Construction}
      title="AI 图像工作室 — Phase 5"
      description="Prompt / 风格 / 尺寸 / 队列 / 历史；接 netclaw-agent skill 系统"
    />
  );
}
