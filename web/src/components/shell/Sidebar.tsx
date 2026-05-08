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
        "flex h-screen w-60 shrink-0 flex-col relative overflow-hidden border-r border-[#E9E2FB]",
        className,
      )}
      style={{
        // White-dominant with a soft purple wash that deepens toward the bottom
        background:
          "linear-gradient(180deg, #FFFFFF 0%, #F8F4FF 35%, #EFE6FE 65%, #E2D2FB 100%)",
      }}
    >
      {/* Subtle purple glow at the corners */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-50 [background:radial-gradient(circle_at_10%_5%,rgba(124,58,237,0.10)_0%,transparent_40%),radial-gradient(circle_at_90%_95%,rgba(167,139,250,0.18)_0%,transparent_45%)]"
      />

      <div className="relative flex items-center gap-2.5 px-4 py-4 border-b border-[#E9E2FB]">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-[0_4px_12px_rgba(124,58,237,0.18)] shrink-0 ring-1 ring-[#E9E2FB]">
          <img
            src="/logo.png"
            alt={brand}
            className="h-7 w-7 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
        <div className="leading-tight min-w-0">
          <div className="font-display text-base font-bold truncate text-[#4C1D95]">
            {brand}
          </div>
          {brandSubtitle && (
            <div className="text-[0.65rem] text-[#7C3AED]/70 truncate">{brandSubtitle}</div>
          )}
        </div>
      </div>

      <nav className="relative flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
        {items.map(({ path, label, icon: Icon, badge }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                isActive
                  ? "bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white font-semibold shadow-[0_4px_14px_rgba(124,58,237,0.35)]"
                  : "text-[#4C1D95]/80 hover:bg-white hover:text-[#7C3AED] hover:shadow-sm",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {badge !== undefined && (
              <span className="ml-auto rounded-full bg-[#7C3AED]/15 text-[#7C3AED] px-2 py-0.5 text-[0.65rem] font-medium">
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {(user || footer) && (
        <div className="relative border-t border-[#E9E2FB] px-3 py-3 bg-white/60 backdrop-blur-sm">
          {user && (
            <div className="flex items-center gap-2.5">
              <Avatar src={user.avatarSrc} fallback={user.name} size="sm" />
              <div className="leading-tight min-w-0 flex-1">
                <div className="text-xs font-semibold truncate text-[#4C1D95]">{user.name}</div>
                {user.subtitle && (
                  <div className="text-[0.65rem] text-[#7C3AED]/65 truncate">{user.subtitle}</div>
                )}
              </div>
            </div>
          )}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      )}
    </aside>
  );
}
