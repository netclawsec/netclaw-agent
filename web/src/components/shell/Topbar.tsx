import { Bell, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

interface TopbarProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
  onSearch?: (query: string) => void;
  notifications?: number;
  user?: { name: string; subtitle?: string; avatarSrc?: string };
  rightSlot?: React.ReactNode;
  className?: string;
}

export function Topbar({
  title,
  subtitle,
  breadcrumbs,
  onSearch,
  notifications,
  user,
  rightSlot,
  className,
}: TopbarProps) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card/80 px-5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="opacity-40">/</span>}
                {b.href ? (
                  <a href={b.href} className="hover:text-foreground">
                    {b.label}
                  </a>
                ) : (
                  <span>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-baseline gap-2 leading-tight">
          <h1 className="font-display text-base font-semibold truncate">{title}</h1>
          {subtitle && <span className="text-xs text-muted-foreground truncate">{subtitle}</span>}
        </div>
      </div>

      {onSearch && (
        <div className="relative hidden md:block">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="搜索 / Search"
            onChange={(e) => onSearch(e.target.value)}
            className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      )}

      {rightSlot}

      {notifications !== undefined && (
        <button
          type="button"
          aria-label="Notifications"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {notifications > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-destructive px-1 text-[0.55rem] font-bold text-destructive-foreground">
              {notifications > 9 ? "9+" : notifications}
            </span>
          )}
        </button>
      )}

      {user && (
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:block leading-tight text-right">
            <div className="text-xs font-medium">{user.name}</div>
            {user.subtitle && <div className="text-[0.65rem] text-muted-foreground">{user.subtitle}</div>}
          </div>
          <Avatar src={user.avatarSrc} fallback={user.name} size="sm" />
        </div>
      )}
    </header>
  );
}
