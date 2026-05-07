import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Mail, Lock, Zap, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";
import { useTheme } from "@/themes";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const STAT_ITEMS = [
  { label: "已连通道", value: "56", color: "#7C3AED" },
  { label: "总素材", value: "312", color: "#F59E0B" },
  { label: "活跃 Agent", value: "1.2K", color: "#10B981" },
  { label: "协作员工", value: "28", color: "#3B82F6" },
];

const RECENT_BRANDS = [
  { name: "Instagram", color: "#E1306C" },
  { name: "TikTok", color: "#1F1F1F" },
  { name: "YouTube", color: "#EF4444" },
  { name: "X / Twitter", color: "#3B82F6" },
  { name: "WeChat", color: "#10B981" },
  { name: "LinkedIn", color: "#0A66C2" },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTheme, themeName } = useTheme();
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("请填写邮箱与密码 / Email and password required");
      return;
    }
    setSubmitting(true);
    // Frontend-only stub: real auth wiring lives in Phase 9 alongside
    // /api/employee/login. For now, treat any non-empty form as a login
    // and route the user into the new product surface.
    setTimeout(() => {
      setSubmitting(false);
      navigate("/", { replace: true });
    }, 400);
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between bg-gradient-to-br from-[#7C3AED] via-[#5B21B6] to-[#1E1B4B] p-10 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_20%_30%,white_0%,transparent_45%),radial-gradient(circle_at_80%_70%,white_0%,transparent_40%)]" />
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
            连接抖音、小红书、视频号、微信、海外平台 —— 用 Agent 自动化策划、生成、发布、互动。
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md pt-2">
            {STAT_ITEMS.map((s) => (
              <div key={s.label} className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 px-4 py-3">
                <div className="font-display text-2xl font-bold">{s.value}</div>
                <div className="text-[0.7rem] opacity-70 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative space-y-3">
          <div className="text-[0.7rem] uppercase tracking-[0.15em] opacity-60">Recent Activity</div>
          <div className="flex flex-wrap gap-1.5">
            {RECENT_BRANDS.map((b) => (
              <span
                key={b.name}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[0.7rem]"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
                {b.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold">登录 / Sign In</h2>
            <p className="text-sm text-muted-foreground">
              登录账号管理你的 Netclaw Agent 工作空间
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              icon={Building2}
              placeholder="组织 / Organization"
              value={org}
              onChange={setOrg}
              autoComplete="organization"
            />
            <Field
              icon={Mail}
              placeholder="邮箱 / Email"
              value={email}
              onChange={setEmail}
              type="email"
              autoComplete="email"
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
              <a href="#forgot" className="ml-auto text-xs text-primary hover:underline">
                忘记密码？
              </a>
            </label>

            {error && <div className="text-xs text-destructive">{error}</div>}

            <Button type="submit" className="w-full rounded-md" disabled={submitting}>
              {submitting ? "登录中..." : (
                <>
                  登录 / Sign In
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>

            <div className="relative my-2 flex items-center text-xs text-muted-foreground">
              <div className="flex-1 border-t border-border" />
              <span className="px-2">SSO 单点登录 / Sign in with SSO</span>
              <div className="flex-1 border-t border-border" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="w-full">
                <Zap className="h-3.5 w-3.5" /> Lark
              </Button>
              <Button type="button" variant="outline" className="w-full">
                <ShieldCheck className="h-3.5 w-3.5" /> Microsoft
              </Button>
            </div>
          </form>

          <Card className="rounded-xl border-dashed">
            <CardContent className="flex items-center gap-3 py-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 leading-tight">
                <div className="text-xs font-medium">30 天试用 · Free Trial</div>
                <div className="text-[0.7rem] text-muted-foreground">无信用卡，全功能</div>
              </div>
              <Badge variant="outline">立即开通</Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  icon: typeof Building2;
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
