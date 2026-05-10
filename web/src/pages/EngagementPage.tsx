import { useCallback, useEffect, useState } from "react";
import {
  Sparkles, ThumbsUp, MessageCircle, UserPlus, Activity, Plus, Trash2, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectOption } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetchJson";
import { cn } from "@/lib/utils";

type RuleKind = "like" | "comment" | "follow";
type Platform = "douyin" | "xhs";

interface Rule {
  id: string;
  kind: RuleKind;
  platform: Platform;
  keyword: string;
  daily_cap: number;
  enabled: boolean;
  created_at: number;
  last_run_at: number | null;
  today_count: number;
  today_date: string | null;
  comment_template_id?: string | null;
}

const KIND_META: Record<RuleKind, { name: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  like: { name: "自动点赞", icon: ThumbsUp, tone: "text-emerald-700 bg-emerald-500/10" },
  comment: { name: "自动评论", icon: MessageCircle, tone: "text-blue-700 bg-blue-500/10" },
  follow: { name: "自动关注", icon: UserPlus, tone: "text-purple-700 bg-purple-500/10" },
};

const PLATFORM_LABEL: Record<Platform, string> = { douyin: "抖音", xhs: "小红书" };

export default function EngagementPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-rule form state
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<{ kind: RuleKind; platform: Platform; keyword: string; daily_cap: number }>({
    kind: "like",
    platform: "douyin",
    keyword: "",
    daily_cap: 30,
  });
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetchJson<{ rules?: Rule[] }>("/api/engagement/rules");
    setLoading(false);
    if (!res.ok) {
      setError(`加载失败：${res.error}`);
      return;
    }
    setError(null);
    setRules(res.data?.rules ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitNew = async () => {
    if (!draft.keyword.trim()) {
      setError("关键词不能为空");
      return;
    }
    setSubmitting(true);
    const res = await fetchJson<Rule>("/api/engagement/rules", { method: "POST", body: draft });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || "创建失败");
      return;
    }
    setShowForm(false);
    setDraft({ kind: "like", platform: "douyin", keyword: "", daily_cap: 30 });
    void refresh();
  };

  const toggle = async (rule: Rule) => {
    const res = await fetchJson<Rule>(`/api/engagement/rules/${rule.id}/update`, {
      method: "POST",
      body: { enabled: !rule.enabled },
    });
    if (!res.ok) {
      setError(res.error || "切换失败");
      return;
    }
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
  };

  const remove = async (rule: Rule) => {
    if (!window.confirm(`删除规则「${KIND_META[rule.kind].name} · ${rule.keyword}」？`)) return;
    const res = await fetchJson(`/api/engagement/rules/${rule.id}/delete`, { method: "POST" });
    if (!res.ok) {
      setError(res.error || "删除失败");
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 text-xs text-amber-700 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          预览版：规则 CRUD 已联调到 <code className="bg-amber-500/15 px-1 rounded">~/.netclaw/web/engagement_rules.json</code>。执行引擎（cron + opencli）下一迭代接入；当前 enabled 仅作意图记录。
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        {(Object.keys(KIND_META) as RuleKind[]).map((k) => {
          const meta = KIND_META[k];
          const KindIcon = meta.icon;
          const count = rules.filter((r) => r.kind === k).length;
          return (
            <Card key={k} className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-xl", meta.tone)}>
                      <KindIcon className="h-4 w-4" />
                    </span>
                    {meta.name}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{count} 条规则</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                按关键词搜索 → {meta.name.replace("自动", "")} 指定数量帖子，频次受日上限约束。
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> 规则列表
          </CardTitle>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
            >
              <Plus className="h-3 w-3" /> 新建规则
            </button>
          )}
        </CardHeader>
        <CardContent>
          {showForm && (
            <div className="mb-4 rounded-xl border border-border p-4 grid gap-3 grid-cols-1 md:grid-cols-4">
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">类型</div>
                <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as RuleKind })}>
                  <SelectOption value="like">自动点赞</SelectOption>
                  <SelectOption value="comment">自动评论</SelectOption>
                  <SelectOption value="follow">自动关注</SelectOption>
                </Select>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">平台</div>
                <Select value={draft.platform} onValueChange={(v) => setDraft({ ...draft, platform: v as Platform })}>
                  <SelectOption value="douyin">抖音</SelectOption>
                  <SelectOption value="xhs">小红书</SelectOption>
                </Select>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">关键词</div>
                <Input
                  value={draft.keyword}
                  onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
                  maxLength={64}
                  placeholder="如 新手化妆"
                />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">日上限（次）</div>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={draft.daily_cap}
                  onChange={(e) => setDraft({ ...draft, daily_cap: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
                />
              </div>
              <div className="md:col-span-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs rounded-xl border border-border hover:bg-muted">取消</button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={submitNew}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} 创建
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-xs text-muted-foreground py-8 text-center">加载中…</div>
          ) : rules.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">还没有规则，点击「+ 新建规则」开始</div>
          ) : (
            <div className="divide-y divide-border">
              {rules.map((r) => {
                const meta = KIND_META[r.kind];
                const KindIcon = meta.icon;
                return (
                  <div key={r.id} className="flex items-center gap-3 py-3">
                    <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-xl shrink-0", meta.tone)}>
                      <KindIcon className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{meta.name}</span>
                        <Badge variant="outline" className="text-[10px]">{PLATFORM_LABEL[r.platform]}</Badge>
                        <span className="text-xs text-muted-foreground">关键词 「{r.keyword}」</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        日上限 {r.daily_cap} 次 · 今日已执行 {r.today_count}/{r.daily_cap}
                        {r.last_run_at && ` · 上次 ${new Date(r.last_run_at * 1000).toLocaleString()}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggle(r)}
                      className={cn(
                        "rounded-xl px-3 py-1.5 text-xs transition-colors",
                        r.enabled
                          ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30"
                          : "bg-muted text-muted-foreground border border-border hover:bg-muted/70",
                      )}
                    >
                      {r.enabled ? "运行中" : "已停用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(r)}
                      title="删除规则"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
