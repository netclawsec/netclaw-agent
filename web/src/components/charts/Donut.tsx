import { cn } from "@/lib/utils";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: React.ReactNode;
  className?: string;
}

interface ResolvedSlice {
  slice: DonutSlice;
  dash: number;
  offset: number;
}

export function DonutChart({ data, size = 160, thickness = 22, centerLabel, className }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  if (total === 0) {
    return (
      <div className={cn("flex items-center justify-center text-xs text-muted-foreground", className)} style={{ width: size, height: size }}>
        暂无数据
      </div>
    );
  }

  // Pre-compute each slice's dash + cumulative offset without mutating during render.
  const resolved: ResolvedSlice[] = data.reduce<ResolvedSlice[]>((acc, slice) => {
    const previous = acc[acc.length - 1];
    const offset = previous ? previous.offset + previous.dash : 0;
    const dash = (Math.max(0, slice.value) / total) * circumference;
    acc.push({ slice, dash, offset });
    return acc;
  }, []);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={thickness} />
        {resolved.map(({ slice, dash, offset }) => (
          <circle
            key={slice.label}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      {centerLabel && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-foreground">
          {centerLabel}
        </div>
      )}
    </div>
  );
}
