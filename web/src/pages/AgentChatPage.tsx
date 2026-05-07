import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function AgentChatPage() {
  return (
    <EmptyState
      icon={Construction}
      title="Agent Chat 工作台 — Phase 7"
      description="主对话 + Memory / Brand Knowledge / Task Checklist 三栏；接现有 /api/chat/stream + /api/sessions"
    />
  );
}
