import { useEffect, useState } from "react";
import { Mail, Building2, ShieldCheck, Globe, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

interface WhoAmI {
  username?: string;
  display_name?: string;
  tenant_name?: string;
  tenant_slug?: string;
  role?: string;
  email?: string;
}

export default function AccountPage() {
  const [me, setMe] = useState<WhoAmI | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employee/whoami")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === "object") setMe(data as WhoAmI);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-display text-xl font-bold">账户 / Account</h2>
        <p className="text-sm text-muted-foreground">个人资料、组织信息与偏好设置</p>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>个人资料 / Profile</CardTitle>
          <CardDescription>从 license server 多租户账号同步</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {loading ? (
            <>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </>
          ) : me ? (
            <>
              <Field icon={Mail} label="用户名" value={me.username ?? "—"} />
              <Field icon={Building2} label="组织" value={me.tenant_name ?? me.tenant_slug ?? "default"} />
              <Field icon={ShieldCheck} label="角色" value={me.role ?? "—"} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground">未登录或 license 未激活</div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>外观 / Appearance</CardTitle>
          <CardDescription>主题与语言</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Field icon={Sparkles} label="主题" />
          <ThemeSwitcher />
          <Field icon={Globe} label="语言" />
          <LanguageSwitcher />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>License</CardTitle>
          <CardDescription>当前订阅状态</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2.5">
          <Badge>已激活</Badge>
          <span className="text-xs text-muted-foreground">License server: license.netclawsec.com.cn</span>
        </CardContent>
      </Card>
    </div>
  );
}

interface FieldProps {
  icon: typeof Mail;
  label: string;
  value?: string;
}

function Field({ icon: Icon, label, value }: FieldProps) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground w-20">{label}</span>
      {value !== undefined && <span className="font-medium">{value}</span>}
    </div>
  );
}
