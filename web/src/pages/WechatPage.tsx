import { useEffect, useState } from "react";
import { Send, MessageSquare, Sparkles, Loader2, User } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface WechatContact { name: string; last_msg?: string; last_at?: string; unread?: number }
interface WechatMessage { from: string; text: string; at?: string; mine?: boolean }

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function WechatPage() {
  const [contacts, setContacts] = useState<WechatContact[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<WechatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<WechatContact[] | { contacts: WechatContact[] }>("/api/wechat/contacts")
      .then((d) => {
        const list = Array.isArray(d) ? d : d.contacts || [];
        setContacts(list);
        if (list[0]) setActive(list[0].name);
      })
      .catch((e) => { setError(String(e)); setContacts([]); });
  }, []);

  useEffect(() => {
    if (!active) { setMessages(null); return; }
    setMessages(null);
    getJSON<WechatMessage[] | { messages: WechatMessage[] }>(`/api/wechat/messages?contact=${encodeURIComponent(active)}&limit=50`)
      .then((d) => setMessages(Array.isArray(d) ? d : d.messages || []))
      .catch((e) => setError(String(e)));
  }, [active]);

  async function getDraft() {
    if (!active) return;
    setSuggestion(null);
    try {
      const d = await postJSON<{ text?: string; draft?: string }>("/api/wechat/draft", { contact: active });
      setSuggestion(d.text || d.draft || "");
    } catch (e) {
      setError(String(e));
    }
  }

  async function send() {
    if (!active || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await postJSON("/api/wechat/send", { contact: active, text: draft });
      setMessages((cur) => [...(cur ?? []), { from: "me", text: draft, mine: true }]);
      setDraft("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-4 h-[calc(100vh-9rem)] min-h-[500px]">
      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle>联系人 / Contacts</CardTitle>
          <CardDescription>{contacts?.length ?? 0} 人</CardDescription>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-y-auto">
          {contacts === null ? (
            <div className="p-3 space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : contacts.length === 0 ? (
            <EmptyState icon={User} title="无联系人" description="9203 sidecar 未启动或非 Win（mock 空）" />
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => setActive(c.name)}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition-colors", active === c.name && "bg-accent")}
                  >
                    <Avatar fallback={c.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {c.name}
                        {(c.unread ?? 0) > 0 && <Badge variant="destructive" className="ml-auto text-[0.6rem]">{c.unread}</Badge>}
                      </div>
                      <div className="text-[0.7rem] text-muted-foreground truncate">{c.last_msg || "—"}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle>{active || "选择联系人"}</CardTitle>
          <CardDescription>9203 wxauto sidecar</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
          {messages === null && active ? (
            <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-14" /></div>
          ) : !active ? (
            <EmptyState icon={MessageSquare} title="未选择" description="左侧挑一个联系人" />
          ) : messages?.length === 0 ? (
            <EmptyState icon={MessageSquare} title="对话为空" />
          ) : (
            messages?.map((m, i) => (
              <div key={i} className={cn("flex gap-2", m.mine && "flex-row-reverse")}>
                <Avatar fallback={m.from} size="sm" />
                <div className={cn("rounded-lg px-3 py-2 max-w-[80%]", m.mine ? "bg-primary/10" : "bg-muted/40")}>
                  <div className="text-[0.65rem] text-muted-foreground mb-0.5">{m.from} · {m.at || ""}</div>
                  <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                </div>
              </div>
            ))
          )}
        </CardContent>
        <div className="border-t border-border p-3 shrink-0 space-y-2">
          {suggestion && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="flex-1">{suggestion}</span>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(suggestion); setSuggestion(null); }}>用</Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 min-h-[44px] max-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-none"
              placeholder="给 联系人 发消息…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={sending || !active}
            />
            <Button variant="outline" onClick={getDraft} disabled={!active}>
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
            <Button onClick={send} disabled={!active || !draft.trim() || sending}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="rounded-xl flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle>客户档案 / KPIs</CardTitle>
          <CardDescription>右栏（接 CRM 待补）</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-3 text-sm">
          <div className="rounded-md bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">满意度</div>
            <div className="text-2xl font-display font-bold">86%</div>
          </div>
          <div className="rounded-md bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">在沟通中</div>
            <div className="text-2xl font-display font-bold">87</div>
          </div>
          <div className="rounded-md bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">本日主动回复</div>
            <div className="text-2xl font-display font-bold">156</div>
          </div>
          <p className="text-xs text-muted-foreground">
            数据当前为示意；下版 wire 9203 sidecar 的 stats endpoint。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
