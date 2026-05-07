import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { api, type ModelInfoResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelInfoCard } from "@/components/ModelInfoCard";
import { OAuthProvidersCard } from "@/components/OAuthProvidersCard";

export default function SettingsModelsPage() {
  const [info, setInfo] = useState<ModelInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getModelInfo()
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="font-display text-xl font-bold">模型 / Models &amp; Providers</h2>
        <p className="text-sm text-muted-foreground">当前默认模型与已登录的 LLM 厂商</p>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>当前模型 / Active model</CardTitle>
          <CardDescription>
            来自 /api/model/info ·
            修改默认模型请到「设置 → 运行时 → 配置」(/settings/runtime/config)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : err ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          ) : info ? (
            <>
              <div className="flex items-center gap-2.5 text-sm">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <div className="font-mono">{info.model}</div>
                <span className="text-xs text-muted-foreground">via {info.provider || "—"}</span>
              </div>
              <ModelInfoCard currentModel={info.model} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground">未获取到模型信息</div>
          )}
        </CardContent>
      </Card>

      <OAuthProvidersCard />
    </div>
  );
}
