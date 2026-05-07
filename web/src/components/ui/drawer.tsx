import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/focus-trap";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, side = "right", title, children, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute top-0 bottom-0 w-full max-w-md bg-card text-card-foreground border-border shadow-xl flex flex-col outline-none focus:ring-2 focus:ring-ring/40",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-border px-5 py-3 flex items-center justify-between shrink-0">
            <h2 className="font-display text-base font-semibold">{title}</h2>
            <button
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
