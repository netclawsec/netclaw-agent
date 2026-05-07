import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, Sparkles, AlertTriangle } from "lucide-react";
import { useTheme } from "@/themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LicenseStatus {
  active?: boolean;
  expires_at?: string | null;
  plan?: string;
  seats?: number;
  error?: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTheme, themeName } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
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

  // Pull live license status (real /api/license — no fabricated stats).
  useEffect(() => {
    fetch("/api/license")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data === "object") setLicense(data as LicenseStatus);
      })
      .catch(() => undefined);
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
        body: JSON.stringify({ username, password, remember }),
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
    <div className="min-h-screen bg-background text-foreground grid lg:grid-cols-2">
      {/* Left brand panel (decorative, no fake stats) */}
      <div className="relative hidden lg:flex flex-col justify-between bg-gradient-to-br from-[#7C3AED] via-[#5B21B6] to-[#1E1B4B] p-10 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-15 [background:radial-gradient(circle_at_20%_30%,white_0%,transparent_45%),radial-gradient(circle_at_80%_70%,white_0%,transparent_40%)]" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold">Netclaw Agent</div>
            <div className="text-[0.7rem] opacity-70">AI Marketing Operations</div>
          </div>
        </div>

        <div className="relative space-y-4">
          <h1 className="font-display text-3xl font-bold leading-tight">
            一站式驱动你的<br /> 全媒体增长
          </h1>
          <p className="text-sm opacity-80 max-w-md leading-relaxed">
            抖音、小红书、视频号 —— 用 Agent 自动化策划、生成、发布、互动。
          </p>
        </div>

        <div className="relative">
          {license ? (
            <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 px-4 py-3 max-w-md">
              <div className="text-[0.7rem] opacity-60 uppercase tracking-[0.12em]">License 状态</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="font-medium">{license.active ? "已激活" : "未激活"}</span>
                {license.plan && <span className="opacity-70">· {license.plan}</span>}
                {license.expires_at && <span className="opacity-70">· 到 {license.expires_at.slice(0, 10)}</span>}
              </div>
            </div>
          ) : (
            <div className="text-[0.7rem] opacity-50">License 状态读取中…</div>
          )}
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold">登录 / Sign In</h2>
            <p className="text-sm text-muted-foreground">
              登录以管理你的 Netclaw Agent 工作空间
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              icon={Mail}
              placeholder="用户名 / Username"
              value={username}
              onChange={setUsername}
              autoComplete="username"
            />
            <Field
              icon={Lock}
              placeholder="密码 / Password"
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
              记住账号 / Remember me
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
                  登录 / Sign In
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </form>

          <p className="text-[0.7rem] text-muted-foreground">
            POST /api/employee/login（接 license server 多租户后台）
          </p>
        </div>
      </div>
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
