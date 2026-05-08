import { useEffect, useState } from "react";
import { Mail, Building2, ShieldCheck, Globe, Sparkles, User as UserIcon } from "lucide-react";
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

interface LicenseStatus {
  active?: boolean;
  expires_at?: string | null;
  plan?: string;
  seats?: number;
  error?: string;
  server?: string;
}

export default function AccountPage() {
  const [me, setMe] = useState<WhoAmI | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licLoading, setLicLoading] = useState(true);

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
        if (!cancelled) setMeLoading(false);
      });
    fetch("/api/license")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === "object") setLicense(data as LicenseStatus);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLicLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-display text-xl font-bold">账户</h2>
        <p className="text-sm text-muted-foreground">个人资料、组织信息与偏好设置</p>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>个人资料</CardTitle>
          <CardDescription>从 License Server 多租户账号同步（只读，修改请联系管理员）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {meLoading ? (
            <>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </>
          ) : me ? (
            <>
              <Field icon={Mail} label="用户名" value={me.username ?? "—"} />
              {me.display_name && <Field icon={UserIcon} label="昵称" value={me.display_name} />}
              {me.email && <Field icon={Mail} label="邮箱" value={me.email} />}
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
          <CardTitle>外观</CardTitle>
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
          <CardTitle>授权 License</CardTitle>
          <CardDescription>
            管理后台：
            <a
              href="https://license.netclawsec.com.cn/admin/login.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline ml-1"
            >
              license.netclawsec.com.cn/admin/login.html
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {licLoading ? (
            <Skeleton className="h-5 w-1/3" />
          ) : license ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {license.active ? (
                  <Badge>已激活</Badge>
                ) : (
                  <Badge variant="destructive">未激活</Badge>
                )}
                {license.plan && <Badge variant="outline">{license.plan}</Badge>}
                {typeof license.seats === "number" && (
                  <Badge variant="outline">{license.seats} seats</Badge>
                )}
              </div>
              {license.expires_at && (
                <div className="text-xs text-muted-foreground">
                  到期：{license.expires_at.slice(0, 10)}
                </div>
              )}
              {license.error && (
                <div className="text-xs text-destructive">错误：{license.error}</div>
              )}
              {license.server && (
                <div className="text-[0.7rem] text-muted-foreground">License server: {license.server}</div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">读取 /api/license 失败</div>
          )}
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
