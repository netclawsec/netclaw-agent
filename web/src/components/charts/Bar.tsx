import { cn } from "@/lib/utils";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  className?: string;
}

const PADDING = { top: 12, right: 12, bottom: 28, left: 32 };

export function BarChart({ data, height = 220, className }: BarChartProps) {
  if (!data.length) {
    return <div className={cn("flex h-[220px] items-center justify-center text-xs text-muted-foreground", className)}>暂无数据</div>;
  }
  const max = Math.max(...data.map((d) => Math.max(0, d.value)), 1);
  const width = 600;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;
  const slot = innerW / data.length;
  const barW = Math.max(8, Math.min(40, slot * 0.6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full", className)}
      role="img"
      aria-label="Bar chart"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
        const y = PADDING.top + innerH * (1 - p);
        return (
          <g key={i}>
            <line x1={PADDING.left} x2={width - PADDING.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
            <text x={PADDING.left - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
              {Math.round(max * p)}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const x = PADDING.left + slot * i + (slot - barW) / 2;
        const h = (Math.max(0, d.value) / max) * innerH;
        const y = PADDING.top + innerH - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={h} fill={d.color ?? "var(--color-primary)"} rx={3} />
            <text
              x={x + barW / 2}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
