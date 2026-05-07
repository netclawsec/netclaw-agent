import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  Activity, BarChart3, FileVideo, Image as ImageIcon,
  MessagesSquare, Settings, Share2,
} from "lucide-react";
import { useTheme } from "@/themes";
import { AppShell } from "@/components/shell/AppShell";
import type { SidebarItem } from "@/components/shell/Sidebar";

export const MAIN_NAV: SidebarItem[] = [
  { path: "/", label: "工作台 / Command Center", icon: Activity },
  { path: "/social", label: "社交发布 / 抖音 · 小红书 · 视频号", icon: Share2 },
  { path: "/studio/video", label: "AI 视频工作室", icon: FileVideo },
  { path: "/studio/image", label: "AI 图像工作室", icon: ImageIcon },
  { path: "/agent-chat", label: "Agent Chat", icon: MessagesSquare },
  { path: "/analytics", label: "数据分析", icon: BarChart3 },
  { path: "/settings", label: "设置", icon: Settings },
];

interface RouteMeta {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

const ROUTE_META: Array<{ match: (path: string) => boolean; meta: RouteMeta }> = [
  { match: (p) => p === "/", meta: { title: "工作台", subtitle: "Command Center", breadcrumbs: [{ label: "工作台" }] } },
  { match: (p) => p.startsWith("/social"), meta: { title: "社交媒体自动发布", subtitle: "Social Media Auto-Publish", breadcrumbs: [{ label: "社交发布" }] } },
  { match: (p) => p.startsWith("/studio/video"), meta: { title: "AI 视频工作室", subtitle: "AI Video Studio", breadcrumbs: [{ label: "工作室", href: "/" }, { label: "视频" }] } },
  { match: (p) => p.startsWith("/studio/image"), meta: { title: "AI 图像工作室", subtitle: "AI Image Studio", breadcrumbs: [{ label: "工作室", href: "/" }, { label: "图像" }] } },
  { match: (p) => p.startsWith("/agent-chat"), meta: { title: "Agent Chat", subtitle: "Agent Chat Workspace", breadcrumbs: [{ label: "Agent" }] } },
  { match: (p) => p.startsWith("/analytics"), meta: { title: "数据分析", subtitle: "Analytics", breadcrumbs: [{ label: "分析" }] } },
  { match: (p) => p.startsWith("/settings"), meta: { title: "设置", subtitle: "Settings", breadcrumbs: [{ label: "设置" }] } },
];

const FALLBACK_META: RouteMeta = { title: "Netclaw Agent", subtitle: "" };

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
  const meta = ROUTE_META.find((m) => m.match(location.pathname))?.meta ?? FALLBACK_META;

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
      sidebarItems={MAIN_NAV}
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
