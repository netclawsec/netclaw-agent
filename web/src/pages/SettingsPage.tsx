import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import {
  Activity, MessageSquare, FileText, Clock, Package,
  Settings as SettingsIcon, KeyRound, Database, User,
  Sliders, Bot, PlugZap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const RUNTIME_TABS = [
  { path: "/settings/runtime/status", label: "运行状态", icon: Activity },
  { path: "/settings/runtime/sessions", label: "会话历史", icon: MessageSquare },
  { path: "/settings/runtime/logs", label: "日志", icon: FileText },
  { path: "/settings/runtime/cron", label: "定时任务", icon: Clock },
  { path: "/settings/runtime/skills", label: "技能", icon: Package },
  { path: "/settings/runtime/config", label: "配置", icon: SettingsIcon },
  { path: "/settings/runtime/env", label: "环境变量", icon: KeyRound },
  { path: "/settings/runtime/analytics", label: "Agent 分析", icon: Database },
];

const SECTION_TABS = [
  { path: "/settings/account", label: "账户", icon: User },
  { path: "/settings/general", label: "通用", icon: Sliders },
  { path: "/settings/models", label: "模型 & 厂商", icon: Bot },
  { path: "/settings/plugins", label: "插件", icon: PlugZap },
  { path: "/settings/runtime", label: "运行时", icon: Database },
];

export default function SettingsPage() {
  const location = useLocation();
  const inRuntime = location.pathname.startsWith("/settings/runtime");

  // Bare /settings — redirect into account.
  if (location.pathname === "/settings") {
    return <Navigate to="/settings/account" replace />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
      <aside className="lg:sticky lg:top-4 self-start">
        <div className="space-y-0.5 text-sm">
          {SECTION_TABS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path || location.pathname.startsWith(path + "/");
            return (
              <NavLink
                key={path}
                to={path}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            );
          })}
        </div>

        {inRuntime && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              运维子页 / Runtime Tabs
            </div>
            {RUNTIME_TABS.map(({ path, label, icon: Icon }) => {
              const active = location.pathname === path;
              return (
                <NavLink
                  key={path}
                  to={path}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </NavLink>
              );
            })}
          </div>
        )}
      </aside>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
