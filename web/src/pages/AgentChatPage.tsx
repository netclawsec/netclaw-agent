import { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, Loader2, Bot, User, Wrench } from "lucide-react";
import { api, type SessionInfo, type SessionMessage } from "@/lib/api";
import { runChat, type RunChatHandle } from "@/lib/chat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChatMessage extends SessionMessage {
  /** Stable client-side id so React's reconciliation doesn't reuse the wrong DOM node mid-stream. */
  _key?: string;
}

let _msgCounter = 0;
function newKey(): string {
  _msgCounter += 1;
  return `m_${Date.now()}_${_msgCounter}`;
}

export default function AgentChatPage() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatHandleRef = useRef<RunChatHandle | null>(null);

  useEffect(() => {
    api.getSessions(20, 0)
      .then((paged) => {
        setSessions(paged.sessions);
        if (paged.sessions[0]) setActiveId(paged.sessions[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessages(null);
    api.getSessionMessages(activeId)
      .then((r) => {
        if (!cancelled) {
          setMessages(r.messages.map((m) => ({ ...m, _key: newKey() })));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Cancel any in-flight stream when the page unmounts (avoids setState on dead component).
  useEffect(() => {
    return () => {
      const h = chatHandleRef.current;
      chatHandleRef.current = null;
      if (h) void h.cancel();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    const text = draft;
    setDraft("");
    setMessages((cur) => [
      ...(cur ?? []),
      { role: "user", content: text, _key: newKey() },
      { role: "assistant", content: "", _key: newKey() },
    ]);

    // Cancel any prior in-flight run before starting a new one.
    const prev = chatHandleRef.current;
    chatHandleRef.current = null;
    if (prev) void prev.cancel();

    chatHandleRef.current = runChat({
      sessionId: activeId ?? undefined,
      message: text,
      onToken: (_tok, total) => {
        setMessages((cur) => {
          if (!cur) return cur;
          const next = cur.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: total };
          }
          return next;
        });
      },
      onDone: (_total, sid) => {
        if (!activeId) setActiveId(sid);
        setSending(false);
        chatHandleRef.current = null;
      },
      onError: (err) => {
        setError(err.message);
        setSending(false);
        chatHandleRef.current = null;
      },
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-9rem)] min-h-[480px]">
      {/* Sessions list */}
      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center justify-between">
            会话历史
            <Button size="sm" variant="ghost" onClick={() => { setActiveId(null); setMessages([]); }}>
              新建
            </Button>
          </CardTitle>
          <CardDescription>{sessions?.length ?? 0} 条</CardDescription>
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
            <CardDescription>跟你的 AI 员工对话 · 流式响应</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {messages === null ? (
            <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-16" /></div>
          ) : messages.length === 0 ? (
            <EmptyState icon={MessageSquare} title={activeId ? "对话为空" : "新对话"} description="输入消息开始" />
          ) : (
            messages.map((m, i) => <MessageBubble key={m._key ?? `${m.role}-${i}`} m={m} />)
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
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
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
