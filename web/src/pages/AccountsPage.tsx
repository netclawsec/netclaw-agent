import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw, ExternalLink, CheckCircle2, AlertCircle, HelpCircle, Plus, Loader2, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandIcon, type BrandSlug } from "@/components/BrandIcon";
import { openExternal } from "@/lib/external";
import { fetchJson } from "@/lib/fetchJson";

interface AccountRow {
  idx: number;
  nickname: string;
  cookie_path: string | null;
  added_at: number;
  last_used_at: number | null;
  logged_in: boolean | null;
}

type Platform = "douyin" | "xhs" | "shipinhao";

const META: Record<Platform, { brand: BrandSlug; login_url: string; name: string }> = {
  douyin: { brand: "tiktok", login_url: "https://creator.douyin.com/", name: "抖音" },
  xhs: { brand: "xiaohongshu", login_url: "https://creator.xiaohongshu.com/", name: "小红书" },
  shipinhao: { brand: "wechat", login_url: "https://channels.weixin.qq.com/", name: "视频号" },
};

const PLATFORMS: Platform[] = ["douyin", "xhs", "shipinhao"];

function statusBadge(s: AccountRow["logged_in"]) {
  if (s === true)
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30"><CheckCircle2 className="h-3 w-3" /> 已登录</Badge>;
  if (s === false)
    return <Badge variant="outline" className="border-destructive/40 text-destructive"><AlertCircle className="h-3 w-3" /> 未登录</Badge>;
  return <Badge variant="outline" className="text-muted-foreground"><HelpCircle className="h-3 w-3" /> 未知</Badge>;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Record<Platform, AccountRow[]>>({
    douyin: [],
    xhs: [],
    shipinhao: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Platform | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const res = await fetchJson<{ accounts: Record<Platform, AccountRow[]> }>("/api/social/accounts");
    setRefreshing(false);
    setLoading(false);
    if (!res.ok) {
      setError(`加载失败：${res.error}`);
      return;
    }
    setError(null);
    setAccounts(
      res.data?.accounts ?? { douyin: [], xhs: [], shipinhao: [] },
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addAccount = async (platform: Platform) => {
    setAdding(platform);
    const res = await fetchJson<{ platform: Platform; account: AccountRow }>(
      "/api/social/accounts",
      { method: "POST", body: { platform } },
    );
    setAdding(null);
    if (!res.ok) {
      setError(res.error || "添加失败");
      return;
    }
    void refresh();
    // Open the platform login page so the user can complete sign-in.
    openExternal(META[platform].login_url);
  };

  const removeAccount = async (platform: Platform, account: AccountRow) => {
    if (!window.confirm(`删除 ${META[platform].name} 账号「${account.nickname}」？`)) return;
    const res = await fetchJson(`/api/social/accounts/${platform}/${account.idx}/delete`, {
      method: "POST",
    });
    if (!res.ok) {
      setError(res.error || "删除失败");
      return;
    }
    setAccounts((prev) => ({
      ...prev,
      [platform]: prev[platform].filter((a) => a.idx !== account.idx),
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">账号管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            每个平台支持多账号挂载。添加后请在弹出的浏览器里完成登录；登录态由真实 Chrome 维护。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground py-8 text-center">加载中…</div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
          {PLATFORMS.map((platform) => {
            const meta = META[platform];
            const rows = accounts[platform] || [];
            return (
              <Card key={platform} className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <BrandIcon
                        slug={meta.brand}
                        className="h-5 w-5"
                        color={meta.brand === "tiktok" ? "currentColor" : undefined}
                      />
                      {meta.name}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{rows.length} 账号</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rows.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground text-center py-4">尚无账号</div>
                  ) : (
                    rows.map((a) => (
                      <div key={a.idx} className="rounded-xl border border-border p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium truncate">#{a.idx} · {a.nickname}</span>
                          {statusBadge(a.logged_in)}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>添加于 {new Date(a.added_at * 1000).toLocaleDateString()}</span>
                          <button
                            type="button"
                            onClick={() => void removeAccount(platform, a)}
                            className="ml-auto rounded p-1 hover:bg-destructive/10 hover:text-destructive transition-colors"
                            title="删除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => void addAccount(platform)}
                    disabled={adding === platform}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/10 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition disabled:opacity-50"
                  >
                    {adding === platform ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    添加账号
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
