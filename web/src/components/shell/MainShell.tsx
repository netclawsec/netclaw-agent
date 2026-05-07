import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  Activity, BarChart3, FileVideo, Image as ImageIcon,
  MessagesSquare, Settings, Share2, MessageCircle,
} from "lucide-react";
import { useTheme } from "@/themes";
import { useI18n } from "@/i18n";
import { AppShell } from "@/components/shell/AppShell";
import type { SidebarItem } from "@/components/shell/Sidebar";

interface RouteMeta {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

interface MainShellProps {
  children: React.ReactNode;
}

/**
 * Main app shell — sidebar + topbar wrapping all primary product routes.
 * Forces netclaw-light theme on mount and restores previous on unmount.
 */
export function MainShell({ children }: MainShellProps) {
  const location = useLocation();
  const { setTheme, themeName } = useTheme();
  const { t } = useI18n();

  const navItems: SidebarItem[] = useMemo(
    () => [
      { path: "/", label: t.app.nav.commandCenter, icon: Activity },
      { path: "/social", label: t.app.nav.social, icon: Share2 },
      { path: "/studio/video", label: t.app.nav.studioVideo, icon: FileVideo },
      { path: "/studio/image", label: t.app.nav.studioImage, icon: ImageIcon },
      { path: "/wechat", label: "微信回复 / WeChat Reply", icon: MessageCircle },
      { path: "/agent-chat", label: t.app.nav.agentChat, icon: MessagesSquare },
      { path: "/analytics", label: t.app.nav.analytics, icon: BarChart3 },
      { path: "/settings", label: t.app.nav.settings, icon: Settings },
    ],
    [t],
  );

  const meta = useMemo<RouteMeta>(() => {
    const p = location.pathname;
    if (p === "/") return { title: t.app.nav.commandCenter, subtitle: "Command Center", breadcrumbs: [{ label: t.app.nav.commandCenter }] };
    if (p.startsWith("/social")) return { title: t.app.nav.social, subtitle: "Social Media Auto-Publish", breadcrumbs: [{ label: t.app.nav.social }] };
    if (p.startsWith("/studio/video")) return { title: t.app.nav.studioVideo, subtitle: "AI Video Studio", breadcrumbs: [{ label: "Studio", href: "/" }, { label: t.app.nav.studioVideo }] };
    if (p.startsWith("/studio/image")) return { title: t.app.nav.studioImage, subtitle: "AI Image Studio", breadcrumbs: [{ label: "Studio", href: "/" }, { label: t.app.nav.studioImage }] };
    if (p.startsWith("/wechat")) return { title: "微信回复", subtitle: "WeChat Automatic Reply Inbox", breadcrumbs: [{ label: "微信回复" }] };
    if (p.startsWith("/agent-chat")) return { title: t.app.nav.agentChat, subtitle: "Agent Chat Workspace", breadcrumbs: [{ label: t.app.nav.agentChat }] };
    if (p.startsWith("/analytics")) return { title: t.app.nav.analytics, subtitle: "Analytics", breadcrumbs: [{ label: t.app.nav.analytics }] };
    if (p.startsWith("/settings/runtime")) {
      const tab = p.replace("/settings/runtime/", "");
      return {
        title: t.app.nav.settings,
        subtitle: `Runtime · ${tab || "—"}`,
        breadcrumbs: [{ label: t.app.nav.settings, href: "/settings" }, { label: "Runtime", href: "/settings/runtime" }, { label: tab || "—" }],
      };
    }
    if (p.startsWith("/settings")) {
      const tab = p.split("/")[2] || "account";
      return { title: t.app.nav.settings, subtitle: tab, breadcrumbs: [{ label: t.app.nav.settings, href: "/settings" }, { label: tab }] };
    }
    return { title: "Netclaw Agent" };
  }, [location.pathname, t]);

  useEffect(() => {
    const previous = themeName;
    if (previous !== "netclaw-light") setTheme("netclaw-light");
    return () => {
      if (previous && previous !== "netclaw-light") setTheme(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell
      brand="Netclaw"
      brandSubtitle="AI Marketing Agent"
      sidebarItems={navItems}
      user={{ name: "Operator", subtitle: "Super Admin" }}
      topbarTitle={meta.title}
      topbarSubtitle={meta.subtitle}
      topbarBreadcrumbs={meta.breadcrumbs}
      onSearch={() => undefined}
      notifications={0}
    >
      {children}
    </AppShell>
  );
}
