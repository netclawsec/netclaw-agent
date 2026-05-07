import { cn } from "@/lib/utils";

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASS = {
  sm: "h-7 w-7 text-[0.65rem]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
} as const;

export function Avatar({ src, alt, fallback, size = "md", className }: AvatarProps) {
  const initials = (fallback ?? alt ?? "?").slice(0, 2).toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground font-display tracking-wider select-none",
        SIZE_CLASS[size],
        className,
      )}
    >
      {src ? <img src={src} alt={alt ?? ""} className="h-full w-full object-cover" /> : initials}
    </span>
  );
}
