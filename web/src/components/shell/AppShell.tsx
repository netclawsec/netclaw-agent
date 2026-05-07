import { cn } from "@/lib/utils";
import { Sidebar, type SidebarItem } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps {
  brand: string;
  brandSubtitle?: string;
  sidebarItems: SidebarItem[];
  user?: { name: string; subtitle?: string; avatarSrc?: string };
  sidebarFooter?: React.ReactNode;
  topbarTitle: string;
  topbarSubtitle?: string;
  topbarBreadcrumbs?: { label: string; href?: string }[];
  topbarRight?: React.ReactNode;
  notifications?: number;
  onSearch?: (query: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function AppShell({
  brand,
  brandSubtitle,
  sidebarItems,
  user,
  sidebarFooter,
  topbarTitle,
  topbarSubtitle,
  topbarBreadcrumbs,
  topbarRight,
  notifications,
  onSearch,
  children,
  className,
}: AppShellProps) {
  return (
    <div className={cn("flex min-h-screen bg-background text-foreground", className)}>
      <Sidebar
        brand={brand}
        brandSubtitle={brandSubtitle}
        items={sidebarItems}
        user={user}
        footer={sidebarFooter}
      />
      <div className="flex min-h-screen flex-1 flex-col min-w-0">
        <Topbar
          title={topbarTitle}
          subtitle={topbarSubtitle}
          breadcrumbs={topbarBreadcrumbs}
          notifications={notifications}
          onSearch={onSearch}
          user={user}
          rightSlot={topbarRight}
        />
        <main className="flex-1 overflow-x-hidden p-5">{children}</main>
      </div>
    </div>
  );
}
