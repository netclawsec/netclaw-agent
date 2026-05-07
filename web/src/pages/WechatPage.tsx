import { useEffect, useRef, useState } from "react";
import {
  Search, Send, Sparkles, MessageCircle, AlertTriangle, Loader2,
  ShieldCheck, Tag, Building2, Phone, Calendar, Star, Bot,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Contact {
  id: string;
  name: string;
  last_message?: string;
  unread?: number;
  updated_at?: string;
  is_group?: boolean;
  tag?: string;
}

interface Message {
  id: string;
  from: "me" | "them" | "system";
  text: string;
  ts?: number;
}

export default function WechatPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [contactsErr, setContactsErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggest, setAiSuggest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load contacts (real API: /api/wechat/contacts → reverse-proxied to sidecar 9203).
  useEffect(() => {
    fetch("/api/wechat/contacts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.contacts || [];
        setContacts(list);
        if (list[0]) setActiveId(list[0].id || list[0].name);
      })
      .catch((e: unknown) => setContactsErr((e as Error).message));
  }, []);

  // Load messages whenever the active contact changes.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessages(null);
    setAiSuggest(null);
    fetch(`/api/wechat/messages?contact=${encodeURIComponent(activeId)}&limit=50`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const arr: Message[] = Array.isArray(data) ? data : data?.messages || [];
        setMessages(arr);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function aiDraft() {
    if (!activeId) return;
    setAiBusy(true);
    setAiSuggest(null);
    try {
      const res = await fetch("/api/wechat/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: activeId }),
      });
      const data = await res.json();
      setAiSuggest(data?.draft || data?.text || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function send(text?: string) {
    const payload = (text ?? draft).trim();
    if (!activeId || !payload || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/wechat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: activeId, text: payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setDraft("");
      setAiSuggest(null);
      setMessages((cur) => [...(cur ?? []), { id: `local-${Date.now()}`, from: "me", text: payload }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const filteredContacts = (contacts ?? []).filter((c) =>
    !filter ? true : (c.name + (c.last_message ?? "")).toLowerCase().includes(filter.toLowerCase()),
  );
  const active = (contacts ?? []).find((c) => (c.id ?? c.name) === activeId) ?? null;
  const totalUnread = (contacts ?? []).reduce((a, c) => a + (c.unread ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* Header KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Kpi label="未读" value={totalUnread} hint="Unread inbox" />
        <Kpi label="联系人" value={contacts?.length ?? "—"} hint="Total contacts" />
        <Kpi label="今日已回" value={(messages ?? []).filter((m) => m.from === "me").length} hint="Sent today" />
        <Kpi label="AI 建议待审" value={aiSuggest ? 1 : 0} hint="Draft awaiting review" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-3 h-[calc(100vh-15rem)] min-h-[480px]">
        {/* Contact list */}
        <Card className="rounded-xl flex flex-col overflow-hidden">
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center justify-between">
              <span>联系人 / Contacts</span>
              {totalUnread > 0 && <Badge>{totalUnread}</Badge>}
            </CardTitle>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8" placeholder="搜索…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {contactsErr && (
              <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 inline mr-1" /> sidecar 未连：{contactsErr}
                <div className="text-[0.65rem] mt-1 text-muted-foreground">
                  确认 mcp_wechat sidecar 已启动（port 9203）；macOS 不支持 wxauto，仅 Windows 可真接
                </div>
              </div>
            )}
            {contacts === null && !contactsErr ? (
              <div className="p-3 space-y-2">
                <Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <EmptyState icon={MessageCircle} title="暂无联系人" description="WeChat 客户端未登录或无消息" />
            ) : (
              <ul className="divide-y divide-border">
                {filteredContacts.map((c) => {
                  const id = c.id ?? c.name;
                  const isActive = id === activeId;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(id)}
                        className={cn(
                          "w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors flex items-center gap-2.5",
                          isActive && "bg-accent",
                        )}
                      >
                        <Avatar fallback={c.name} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{c.name}</span>
                            {c.is_group && <Badge variant="outline" className="text-[0.6rem]">群</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{c.last_message || "—"}</div>
                        </div>
                        {!!c.unread && <Badge className="text-[0.6rem]">{c.unread}</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Conversation */}
        <Card className="rounded-xl flex flex-col overflow-hidden">
          <CardHeader className="shrink-0 flex-row items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{active?.name || "选择一个联系人"}</CardTitle>
              <CardDescription className="text-xs">
                /api/wechat/messages · /api/wechat/draft · /api/wechat/send
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" disabled={!activeId || aiBusy} onClick={aiDraft}>
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              AI 草稿
            </Button>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-3 space-y-2">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
            )}
            {!activeId ? (
              <EmptyState icon={MessageCircle} title="未选中联系人" description="左栏点一个联系人开始查看对话" />
            ) : messages === null ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-3/4" /><Skeleton className="h-10 w-1/2 ml-auto" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState icon={MessageCircle} title="对话为空" description="发送第一条消息" />
            ) : (
              messages.map((m) => <Bubble key={m.id} m={m} />)
            )}
            {aiSuggest && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-primary">
                  <Bot className="h-3.5 w-3.5" /> AI 建议回复 · 审核后发送
                </div>
                <p className="text-sm whitespace-pre-wrap">{aiSuggest}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => send(aiSuggest)}>
                    <Send className="h-3 w-3" /> 直接发送
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setDraft(aiSuggest); setAiSuggest(null); }}>
                    编辑后发送
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAiSuggest(null)}>取消</Button>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </CardContent>
          <div className="border-t border-border p-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                className="flex-1 min-h-[44px] max-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-none"
                placeholder={activeId ? "输入消息…（Enter 发送，Shift+Enter 换行）" : "请先选中联系人"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!activeId || sending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Button onClick={() => send()} disabled={!activeId || sending || !draft.trim()}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </Card>

        {/* Customer profile */}
        <Card className="rounded-xl overflow-y-auto">
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              客户档案
            </CardTitle>
            <CardDescription>CRM · Lead Score · 历史</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!active ? (
              <EmptyState icon={MessageCircle} title="未选中" description="选中一个联系人后展示档案" />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Avatar fallback={active.name} size="md" />
                  <div className="min-w-0">
                    <div className="font-display font-semibold truncate">{active.name}</div>
                    {active.tag && <Badge variant="outline" className="mt-0.5">{active.tag}</Badge>}
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Lead Score</span>
                    <span className="text-success flex items-center gap-1">
                      <Star className="h-3 w-3 fill-success" /> 待真接 CRM
                    </span>
                  </div>
                  <div className="font-display text-3xl font-bold text-success mt-1">—</div>
                  <div className="text-[0.7rem] text-muted-foreground mt-0.5">
                    需要 mcp_crm sidecar 接入后展示
                  </div>
                </div>

                <ProfileRow icon={Tag} label="标签" value="—（接 CRM 后展示）" />
                <ProfileRow icon={Building2} label="所属公司" value="—" />
                <ProfileRow icon={Phone} label="联系方式" value="—" />
                <ProfileRow icon={Calendar} label="首次接触" value="—" />

                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground mb-1.5">最近事件</div>
                  <p className="text-[0.7rem] text-muted-foreground">
                    待 CRM 时间线接入。当前仅展示 wechat sidecar 的对话流。
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const isMe = m.from === "me";
  if (m.from === "system") {
    return <div className="text-center text-[0.7rem] text-muted-foreground py-1">{m.text}</div>;
  }
  return (
    <div className={cn("flex", isMe && "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
          isMe ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {m.text}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-0.5 py-3">
        <div className="text-[0.65rem] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
        <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-[0.65rem] text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function ProfileRow({ icon: Icon, label, value }: { icon: typeof Tag; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-muted-foreground">{label}</div>
        <div className="font-medium">{value}</div>
      </div>
    </div>
  );
}
