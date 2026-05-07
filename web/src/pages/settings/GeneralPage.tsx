import { Globe, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export default function SettingsGeneralPage() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = navigator.language;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-display text-xl font-bold">通用 / General</h2>
        <p className="text-sm text-muted-foreground">外观、语言与本地化</p>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>外观 / Appearance</CardTitle>
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
          <CardTitle>语言 / Language</CardTitle>
          <CardDescription>UI 文案语言</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground w-20">语言</span>
          <LanguageSwitcher />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>本地化 / Locale</CardTitle>
          <CardDescription>从浏览器自动检测（只读）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <Field label="时区 / Timezone" value={tz} />
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
