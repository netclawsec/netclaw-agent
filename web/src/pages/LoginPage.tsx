import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail, Lock, ArrowRight, Sparkles, AlertTriangle, Shield, Wifi, HelpCircle,
  Building2, Activity, Clock, Eye, ShieldCheck,
} from "lucide-react";
import { useTheme } from "@/themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface LicenseStatus {
  active?: boolean;
  expires_at?: string | null;
  plan?: string;
  seats?: number;
  error?: string;
  workspace?: { sessions?: number; channels?: number; messages?: number; employees?: number };
}

interface ActivityRow {
  platform: string;
  status: string;
  badge: string;
  color: string;
}

const FALLBACK_ACTIVITY: ActivityRow[] = [
  { platform: "Instagram", status: "Active · 2 min ago", badge: "12", color: "bg-pink-500" },
  { platform: "TikTok", status: "Live · 5 min ago", badge: "8", color: "bg-cyan-500" },
  { platform: "YouTube", status: "Scheduled · 28 min", badge: "4", color: "bg-red-500" },
  { platform: "Facebook", status: "Idle · 1h ago", badge: "—", color: "bg-blue-500" },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTheme, themeName } = useTheme();
  const [organization, setOrganization] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [trust30d, setTrust30d] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    const previous = themeName;
    if (previous !== "netclaw-light") setTheme("netclaw-light");
    return () => {
      if (previous && previous !== "netclaw-light") setTheme(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/license")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data === "object") setLicense(data as LicenseStatus);
      })
      .catch(() => undefined);

    // If the user already has a valid employee session, skip straight into
    // the AI 员工 workspace instead of forcing them to re-login.
    fetch("/api/employee/whoami")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.logged_in) {
          navigate("/agent-chat", { replace: true });
        }
      })
      .catch(() => undefined);
    // navigate is stable from react-router; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError("请填写用户名与密码 / Username and password required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/employee/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          remember: remember || trust30d,
          organization: organization || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid grid-cols-1 lg:grid-cols-[280px_1fr_360px]">
      {/* Left brand splash */}
      <div className="relative hidden lg:flex flex-col justify-between bg-gradient-to-br from-[#7C3AED] via-[#5B21B6] to-[#1E1B4B] p-7 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-15 [background:radial-gradient(circle_at_20%_30%,white_0%,transparent_45%),radial-gradient(circle_at_80%_70%,white_0%,transparent_40%)]" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="网钳科技"
              className="h-12 w-12 rounded-xl bg-white/15 backdrop-blur-sm p-1.5 object-contain"
            />
            <div className="leading-tight">
              <div className="font-display text-base font-bold">网钳科技</div>
              <div className="text-[0.7rem] opacity-70">AI 员工 · 营销工作平台</div>
            </div>
          </div>
        </div>

        <div className="relative space-y-3">
          <SplashCard icon={Shield} title="单点登录" desc="支持企业 SSO / IdP 接入" />
          <SplashCard icon={Wifi} title="网络状态" desc="License Server 直连，链路稳定" />
          <SplashCard icon={HelpCircle} title="帮助中心" desc="部署文档 · FAQ · 客户成功" />
        </div>

        <div className="relative text-[0.65rem] opacity-60">v0.10 · © 网钳科技</div>
      </div>

      {/* Middle form */}
      <div className="flex items-center justify-center p-5 lg:p-8 border-r border-border">
        <div className="w-full max-w-md space-y-4">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold">登录</h2>
            <p className="text-sm text-muted-foreground">
              登录以管理你的网钳 AI 员工工作平台
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              icon={Building2}
              placeholder="选择或搜索组织"
              value={organization}
              onChange={setOrganization}
              autoComplete="organization"
            />
            <Field
              icon={Mail}
              placeholder="邮箱 / 手机号"
              value={username}
              onChange={setUsername}
              autoComplete="username"
            />
            <div className="space-y-1">
              <Field
                icon={Lock}
                placeholder="密码 / 验证码"
                value={password}
                onChange={setPassword}
                type="password"
                autoComplete="current-password"
              />
              <div className="flex items-center justify-end">
                <a className="text-[0.7rem] text-muted-foreground hover:text-primary cursor-default">
                  忘记密码？
                </a>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                记住账号
              </label>
              <span className="text-[0.7rem] flex items-center gap-1">
                <Eye className="h-3 w-3" />
                登录历史
              </span>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full rounded-md" disabled={submitting}>
              {submitting ? "登录中..." : (
                <>
                  登录
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>

            <Button type="button" variant="outline" className="w-full rounded-md" disabled>
              <Shield className="h-3.5 w-3.5" /> 使用 SSO 登录
            </Button>

            <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              <input
                type="checkbox"
                checked={trust30d}
                onChange={(e) => setTrust30d(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <ShieldCheck className="h-3 w-3" />
              信任此设备 30 天
            </label>
          </form>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[0.65rem] text-muted-foreground">企业管理员入口</span>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="h-7 px-2 text-[0.7rem]"
              onClick={() =>
                window.open(
                  "https://license.netclawsec.com.cn/admin/login.html",
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              打开管理后台
            </Button>
          </div>
        </div>
      </div>

      {/* Right workspace overview */}
      <aside className="hidden lg:flex flex-col gap-3 p-5 bg-muted/30">
        <Card className="rounded-xl">
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> 工作台预览 / Workspace Overview
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <KpiTile label="活跃会话" value={license?.workspace?.sessions ?? 56} />
              <KpiTile label="渠道" value={license?.workspace?.channels ?? 312} />
              <KpiTile label="消息" value={license?.workspace?.messages ? compact(license.workspace.messages) : "1.2K"} />
              <KpiTile label="员工" value={license?.workspace?.employees ?? 28} />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> Recent Activity
            </div>
            <ul className="space-y-1.5">
              {FALLBACK_ACTIVITY.map((a) => (
                <li key={a.platform} className="flex items-center gap-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${a.color}`} />
                  <span className="font-medium flex-1">{a.platform}</span>
                  <span className="text-muted-foreground truncate">{a.status}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.6rem] tabular-nums">{a.badge}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> 管理员提示
            </div>
            <p className="text-[0.7rem] leading-relaxed">
              {license?.error
                ? `License 错误：${license.error}`
                : license?.active
                ? `已激活 · ${license.plan ?? "—"}${license.expires_at ? ` · 到 ${license.expires_at.slice(0, 10)}` : ""}`
                : "如登录失败请联系管理员重置密码或检查 license 状态"}
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function SplashCard({ icon: Icon, title, desc }: { icon: typeof Shield; title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 px-3 py-2.5 flex items-start gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15 shrink-0">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="leading-tight">
        <div className="text-xs font-medium">{title}</div>
        <div className="text-[0.65rem] opacity-70 mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-2">
      <div className="text-[0.65rem] text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

interface FieldProps {
  icon: typeof Mail;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}

function Field({ icon: Icon, placeholder, value, onChange, type = "text", autoComplete }: FieldProps) {
  return (
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
