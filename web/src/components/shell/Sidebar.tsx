import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

export interface SidebarItem {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number;
}

interface SidebarProps {
  brand: string;
  brandSubtitle?: string;
  items: SidebarItem[];
  user?: { name: string; subtitle?: string; avatarSrc?: string };
  footer?: React.ReactNode;
  className?: string;
}

export function Sidebar({ brand, brandSubtitle, items, user, footer, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-screen w-60 shrink-0 flex-col border-r border-border bg-secondary text-secondary-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border/60">
        <img
          src="/logo.png"
          alt={brand}
          className="h-9 w-9 rounded-lg shrink-0 object-contain"
          onError={(e) => {
            // Fallback to 2-letter abbreviation if logo asset is missing.
            const img = e.currentTarget;
            const parent = img.parentElement;
            if (!parent) return;
            img.style.display = "none";
            if (!parent.querySelector("[data-fallback]")) {
              const fb = document.createElement("div");
              fb.setAttribute("data-fallback", "1");
              fb.className =
                "flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-display text-sm font-bold shrink-0";
              fb.textContent = brand.slice(0, 2).toUpperCase();
              parent.insertBefore(fb, img);
            }
          }}
        />
        <div className="leading-tight min-w-0">
          <div className="font-display text-sm font-semibold truncate">{brand}</div>
          {brandSubtitle && <div className="text-[0.65rem] text-muted-foreground truncate">{brandSubtitle}</div>}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {items.map(({ path, label, icon: Icon, badge }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {badge !== undefined && (
              <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {(user || footer) && (
        <div className="border-t border-border/60 px-3 py-3">
          {user && (
            <div className="flex items-center gap-2.5">
              <Avatar src={user.avatarSrc} fallback={user.name} size="sm" />
              <div className="leading-tight min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{user.name}</div>
                {user.subtitle && <div className="text-[0.65rem] text-muted-foreground truncate">{user.subtitle}</div>}
              </div>
            </div>
          )}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      )}
    </aside>
  );
}
