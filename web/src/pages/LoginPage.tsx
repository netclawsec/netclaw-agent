import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  User, Lock, ArrowRight, AlertTriangle, Shield, Wifi, HelpCircle,
  Building2,
} from "lucide-react";
import { useTheme } from "@/themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openExternal } from "@/lib/external";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTheme, themeName } = useTheme();
  const [organization, setOrganization] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = themeName;
    if (previous !== "netclaw-light") setTheme("netclaw-light");
    return () => {
      if (previous && previous !== "netclaw-light") setTheme(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
      setError("请填写用户名与密码");
      return;
    }
    if (!organization.trim()) {
      setError("请填写组织代码（由超级管理员分配）");
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
          remember,
          organization: organization.trim(),
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
    <div className="min-h-screen bg-background text-foreground grid grid-cols-1 lg:grid-cols-[320px_1fr]">
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

      {/* Form (now the only right-hand surface) */}
      <div className="flex items-center justify-center p-5 lg:p-8">
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
              placeholder="组织代码（由超级管理员分配）"
              value={organization}
              onChange={setOrganization}
              autoComplete="organization"
            />
            <Field
              icon={User}
              placeholder="用户名"
              value={username}
              onChange={setUsername}
              autoComplete="username"
            />
            <Field
              icon={Lock}
              placeholder="密码"
              value={password}
              onChange={setPassword}
              type="password"
              autoComplete="current-password"
            />

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              记住账号
            </label>

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
          </form>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
            <span className="text-[0.65rem] text-muted-foreground pt-2">企业管理员入口</span>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="h-7 px-2 text-[0.7rem] mt-1"
              onClick={() =>
                openExternal("https://license.netclawsec.com.cn/admin/login.html")
              }
            >
              打开管理后台
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
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

interface FieldProps {
  icon: typeof User;
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
