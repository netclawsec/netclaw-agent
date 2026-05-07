import { useEffect, useState } from "react";
import { RefreshCw, PlugZap, FileCode, ExternalLink } from "lucide-react";
import { api, type PluginManifestResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export default function SettingsPluginsPage() {
  const [plugins, setPlugins] = useState<PluginManifestResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .getPlugins()
      .then(setPlugins)
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    load();
  }, []);

  async function rescan() {
    setRescanning(true);
    setInfo(null);
    setError(null);
    try {
      const r = await api.rescanPlugins();
      setInfo(`重扫完成：${r.count} 个插件`);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRescanning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">插件 / Plugins</h2>
          <p className="text-sm text-muted-foreground">
            来自 /api/dashboard/plugins · ~/.netclaw/plugins/* 目录扫描
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={rescan} disabled={rescanning}>
          <RefreshCw className={rescanning ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {rescanning ? "扫描中…" : "重新扫描"}
        </Button>
      </div>

      {info && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">{info}</div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {plugins === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <EmptyState
          icon={PlugZap}
          title="还没有安装插件"
          description="把插件目录放到 ~/.netclaw/plugins/，然后点重新扫描"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {plugins.map((p) => {
            // Only allow same-origin relative paths — never honour
            // `javascript:`, `data:`, etc. coming from the manifest.
            const tabPath = p.tab?.path;
            const safePath = typeof tabPath === "string" && /^\/[^/]/.test(tabPath) ? tabPath : null;
            return (
              <Card key={p.name} className="rounded-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 truncate">
                    <PlugZap className="h-4 w-4 text-primary shrink-0" />
                    <span className="truncate">{p.label || p.name}</span>
                  </CardTitle>
                  <CardDescription className="line-clamp-2 min-h-[2.4rem]">{p.description || "—"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">v{p.version || "0.0.0"}</Badge>
                    {p.has_api && <Badge variant="outline">API</Badge>}
                    {safePath && <Badge variant="outline">{safePath}</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileCode className="h-3 w-3" />
                    <span className="font-mono truncate">{p.entry}</span>
                  </div>
                  {safePath && (
                    <a
                      href={safePath}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      打开 <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
