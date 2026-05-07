import { Globe, Sparkles, Type, Ruler } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  FONT_OPTIONS,
  SIZE_PRESETS,
  setFontPrefs,
  useFontPrefs,
} from "@/lib/font-prefs";

export default function SettingsGeneralPage() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = navigator.language;
  const prefs = useFontPrefs();

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-display text-xl font-bold">通用</h2>
        <p className="text-sm text-muted-foreground">外观、语言、字体与本地化</p>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>外观</CardTitle>
          <CardDescription>主题预设</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground w-20">主题</span>
          <ThemeSwitcher />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>语言</CardTitle>
          <CardDescription>UI 文案语言（默认中文，可切英文）</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground w-20">语言</span>
          <LanguageSwitcher />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-4 w-4" /> 字体
          </CardTitle>
          <CardDescription>20 种常见字体 · 应用到全局界面（含正文与标题）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FONT_OPTIONS.map((f) => {
              const active = prefs.fontId === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFontPrefs({ fontId: f.id })}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium" style={{ fontFamily: f.stack }}>
                        {f.label}
                      </span>
                      {active && <Badge className="text-[0.6rem]">已选</Badge>}
                    </div>
                    <div
                      className="text-xs text-muted-foreground truncate mt-0.5"
                      style={{ fontFamily: f.stack }}
                    >
                      网钳科技 · NetClaw Agent · 0123
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[0.6rem] shrink-0">
                    {f.group}
                  </Badge>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-4 w-4" /> 字号
          </CardTitle>
          <CardDescription>正文基准字号 · 全局缩放</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-1.5">
          {SIZE_PRESETS.map((s) => {
            const active = prefs.sizeId === s.id;
            return (
              <Button
                key={s.id}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => setFontPrefs({ sizeId: s.id })}
              >
                {s.label}
                <span className="ml-1.5 text-[0.6rem] opacity-60">{s.basePx}px</span>
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>本地化</CardTitle>
          <CardDescription>从浏览器自动检测（只读）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <Field label="时区" value={tz} />
          <Field label="浏览器语言" value={locale} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-32">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
