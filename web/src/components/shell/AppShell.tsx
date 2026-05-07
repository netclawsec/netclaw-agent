import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Auto-close on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll while mobile sidebar is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileOpen]);

  return (
    <div className={cn("flex min-h-screen bg-background text-foreground", className)}>
      {/* Desktop sidebar (>= lg) */}
      <Sidebar
        brand={brand}
        brandSubtitle={brandSubtitle}
        items={sidebarItems}
        user={user}
        footer={sidebarFooter}
        className="hidden lg:flex"
      />

      {/* Mobile sidebar drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden transition-opacity",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="absolute inset-0 bg-foreground/40"
        />
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-60 transform transition-transform",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar
            brand={brand}
            brandSubtitle={brandSubtitle}
            items={sidebarItems}
            user={user}
            footer={sidebarFooter}
          />
        </div>
      </div>

      <div className="flex min-h-screen flex-1 flex-col min-w-0">
        <Topbar
          title={topbarTitle}
          subtitle={topbarSubtitle}
          breadcrumbs={topbarBreadcrumbs}
          notifications={notifications}
          onSearch={onSearch}
          user={user}
          rightSlot={topbarRight}
          onMenuClick={() => setMobileOpen((v) => !v)}
        />
        <main className="flex-1 overflow-x-hidden p-5">{children}</main>
      </div>
    </div>
  );
}
