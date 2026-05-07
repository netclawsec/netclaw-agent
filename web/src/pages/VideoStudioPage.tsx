import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function VideoStudioPage() {
  return (
    <EmptyState
      icon={Construction}
      title="AI 视频工作室 — Phase 4"
      description="模板库 / 时间轴 / 角色对话 / 配音；接 netclaw-agent skill 系统 (/api/skills + chat-stream)"
    />
  );
}
