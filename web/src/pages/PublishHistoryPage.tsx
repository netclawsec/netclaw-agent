import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandIcon, type BrandSlug } from "@/components/BrandIcon";
import { fetchJson } from "@/lib/fetchJson";
import { Select, SelectOption } from "@/components/ui/select";

interface QueueItem {
  id: string;
  title: string;
  platform: string;
  target_account_idx?: number;
  caption?: string;
  scheduled_at?: string;
  status: "pending" | "publishing" | "published" | "failed";
  created_at: number;
  error?: string;
}

const BRAND_BY_PLATFORM: Record<string, BrandSlug> = {
  douyin: "tiktok",
  xhs: "xiaohongshu",
  shipinhao: "wechat",
};

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  xhs: "小红书",
  shipinhao: "视频号",
};

function statusBadge(s: QueueItem["status"]) {
  if (s === "published")
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30"><CheckCircle2 className="h-3 w-3" /> 已发布</Badge>;
  if (s === "failed")
    return <Badge variant="outline" className="border-destructive/40 text-destructive"><AlertCircle className="h-3 w-3" /> 失败</Badge>;
  if (s === "publishing")
    return <Badge variant="outline" className="border-primary/40 text-primary"><Loader2 className="h-3 w-3 animate-spin" /> 发送中</Badge>;
  return <Badge variant="outline" className="text-muted-foreground"><Clock className="h-3 w-3" /> 待发</Badge>;
}

export default function PublishHistoryPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | QueueItem["status"]>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const res = await fetchJson<{ queue?: QueueItem[] }>("/api/social/queue");
    setRefreshing(false);
    setLoading(false);
    if (res.ok) {
      setItems(res.data?.queue ?? []);
      setError(null);
    } else {
      setError(`加载失败：${res.error}`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    return items
      .filter((i) => statusFilter === "all" || i.status === statusFilter)
      .filter((i) => platformFilter === "all" || i.platform === platformFilter)
      .slice()
      .sort((a, b) => b.created_at - a.created_at);
  }, [items, statusFilter, platformFilter]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center gap-3">
          <CardTitle className="text-base">发布记录</CardTitle>
          <div className="ml-auto flex items-center gap-2">
            <div className="w-[120px]">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectOption value="all">全部状态</SelectOption>
                <SelectOption value="pending">待发</SelectOption>
                <SelectOption value="publishing">发送中</SelectOption>
                <SelectOption value="published">已发布</SelectOption>
                <SelectOption value="failed">失败</SelectOption>
              </Select>
            </div>
            <div className="w-[140px]">
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectOption value="all">全部平台</SelectOption>
                <SelectOption value="douyin" icon={<BrandIcon slug="tiktok" color="currentColor" className="h-4 w-4" />}>抖音</SelectOption>
                <SelectOption value="xhs" icon={<BrandIcon slug="xiaohongshu" className="h-4 w-4" />}>小红书</SelectOption>
                <SelectOption value="shipinhao" icon={<BrandIcon slug="wechat" className="h-4 w-4" />}>视频号</SelectOption>
              </Select>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              title="刷新"
            >
              <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {loading ? (
            <div className="text-xs text-muted-foreground py-8 text-center">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">没有匹配的记录</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((it) => {
                const brand = BRAND_BY_PLATFORM[it.platform];
                return (
                  <div key={it.id} className="flex items-start gap-3 py-3">
                    {brand && (
                      <BrandIcon
                        slug={brand}
                        className="h-5 w-5 mt-0.5 shrink-0"
                        color={brand === "tiktok" ? "currentColor" : undefined}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{it.title || "(无标题)"}</span>
                        {statusBadge(it.status)}
                        <span className="text-[10px] text-muted-foreground">
                          {PLATFORM_LABEL[it.platform] || it.platform}
                          {typeof it.target_account_idx === "number" && it.target_account_idx > 0
                            ? ` · 账号 #${it.target_account_idx}` : ""}
                        </span>
                      </div>
                      {it.caption && (
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{it.caption}</div>
                      )}
                      {it.error && <div className="text-xs text-destructive mt-1">{it.error}</div>}
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(it.created_at * 1000).toLocaleString()}
                    </div>
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
