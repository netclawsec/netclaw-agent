import { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, Sparkles, Loader2, Bot, User, Wrench } from "lucide-react";
import { api, type SessionInfo, type SessionMessage } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function AgentChatPage() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initial sessions load
  useEffect(() => {
    api.getSessions(20, 0)
      .then((paged) => {
        setSessions(paged.sessions);
        if (paged.sessions[0]) setActiveId(paged.sessions[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Load messages when session changes
  useEffect(() => {
    if (!activeId) {
      setMessages(null);
      return;
    }
    let cancelled = false;
    setMessages(null);
    api.getSessionMessages(activeId)
      .then((r) => {
        if (!cancelled) setMessages(r.messages);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    const userMessage: SessionMessage = { role: "user", content: draft };
    setMessages((cur) => (cur ? [...cur, userMessage] : [userMessage]));
    const text = draft;
    setDraft("");

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: activeId, message: text }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = res.body;
      if (!body) {
        throw new Error("No stream body");
      }
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      // Stream chunks into a placeholder assistant message.
      setMessages((cur) => [...(cur ?? []), { role: "assistant", content: "" }]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Best-effort: try to extract text from SSE-like data: lines, fall back to raw.
        const text = extractStreamText(chunk);
        assistantText += text;
        setMessages((cur) => {
          if (!cur) return cur;
          const next = cur.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: assistantText };
          }
          return next;
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-4 h-[calc(100vh-9rem)] min-h-[480px]">
      {/* Sessions list */}
      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center justify-between">
            会话 / Sessions
            <Button size="sm" variant="ghost" onClick={() => setActiveId(null)}>
              <Sparkles className="h-3 w-3" />
            </Button>
          </CardTitle>
          <CardDescription>{sessions?.length ?? 0} 条会话</CardDescription>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-y-auto">
          {sessions === null ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-10" /> <Skeleton className="h-10" />
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState icon={MessageSquare} title="还没有会话" description="发送一条消息即可创建" />
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      "w-full px-3 py-2 text-left hover:bg-muted/40 transition-colors",
                      activeId === s.id && "bg-accent",
                    )}
                  >
                    <div className="text-sm font-medium truncate">{s.title || "(untitled)"}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[0.6rem]">{s.model || "default"}</Badge>
                      <span>{s.message_count ?? 0} 条</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Chat */}
      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0 flex-row items-center justify-between">
          <div>
            <CardTitle>{sessions?.find((s) => s.id === activeId)?.title || "新对话"}</CardTitle>
            <CardDescription>接 /api/chat/stream</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {messages === null && activeId ? (
            <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-16" /></div>
          ) : messages === null ? (
            <EmptyState icon={Bot} title="尚未选择会话" description="从左侧选一条，或直接在底部发送消息" />
          ) : messages.length === 0 ? (
            <EmptyState icon={MessageSquare} title="对话为空" description="输入消息开始" />
          ) : (
            messages.map((m, i) => <MessageBubble key={i} m={m} />)
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="border-t border-border p-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 min-h-[44px] max-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-none"
              placeholder="给 Agent 发消息…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={sending}
            />
            <Button onClick={send} disabled={sending || !draft.trim()}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </Card>

      {/* Right rail: memory placeholder */}
      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle>Memory · Knowledge · Tasks</CardTitle>
          <CardDescription>三栏右侧（接 /api/memory 待补）</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-3">
          <Section title="Memory" icon={Bot}>
            <SmallNote>从 ~/.netclaw 读取的会话级 memory；下版本接 /api/memory。</SmallNote>
          </Section>
          <Section title="Brand Knowledge" icon={Sparkles}>
            <SmallNote>品牌资料库 / Voice 设定，Phase 7 后续接入。</SmallNote>
          </Section>
          <Section title="Task Checklist" icon={Wrench}>
            <SmallNote>当前 Agent 任务清单与子步骤进度。</SmallNote>
          </Section>
        </CardContent>
      </Card>
    </div>
  );
}

function extractStreamText(chunk: string): string {
  // Try SSE-style "data: ..." lines first; fall back to raw text.
  const lines = chunk.split(/\r?\n/);
  let out = "";
  for (const line of lines) {
    const m = line.match(/^data:\s?(.*)$/);
    if (m) {
      const payload = m[1];
      if (payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        if (typeof obj === "string") out += obj;
        else if (obj && typeof obj.delta === "string") out += obj.delta;
        else if (obj && typeof obj.text === "string") out += obj.text;
        else if (obj && obj.content) out += String(obj.content);
      } catch {
        out += payload;
      }
    }
  }
  // If no SSE lines parsed, just return the raw chunk.
  if (!out && lines.every((l) => !l.startsWith("data:"))) {
    return chunk;
  }
  return out;
}

function MessageBubble({ m }: { m: SessionMessage }) {
  const isUser = m.role === "user";
  const isTool = m.role === "tool";
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full shrink-0",
          isUser ? "bg-primary text-primary-foreground" : isTool ? "bg-warning/20 text-warning" : "bg-secondary text-secondary-foreground",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : isTool ? <Wrench className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn("rounded-lg border border-border px-3 py-2 max-w-[88%]", isUser ? "bg-primary/5" : "bg-card")}>
        <div className="text-xs text-muted-foreground mb-0.5">
          {isUser ? "你" : m.role}
          {m.tool_name && <span className="ml-1 text-warning">{m.tool_name}</span>}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content || ""}</div>
        {m.tool_calls && m.tool_calls.length > 0 && (
          <div className="mt-1.5 text-[0.7rem] text-muted-foreground space-y-1">
            {m.tool_calls.map((tc) => (
              <div key={tc.id} className="font-mono">
                → {tc.function.name}({tc.function.arguments.slice(0, 80)})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Bot; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-display font-semibold mb-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {title}
      </div>
      {children}
    </div>
  );
}

function SmallNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>;
}
