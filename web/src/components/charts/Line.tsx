import { cn } from "@/lib/utils";

export interface LineSeries {
  name: string;
  color: string;
  data: number[];
}

interface LineChartProps {
  series: LineSeries[];
  labels?: string[];
  height?: number;
  className?: string;
}

const PADDING = { top: 12, right: 12, bottom: 24, left: 32 };

export function LineChart({ series, labels, height = 220, className }: LineChartProps) {
  const len = series[0]?.data.length ?? 0;
  if (!series.length || len === 0) {
    return <div className={cn("flex h-[220px] items-center justify-center text-xs text-muted-foreground", className)}>暂无数据</div>;
  }

  const all = series.flatMap((s) => s.data);
  const min = Math.min(0, ...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const width = 600; // viewBox width — scales responsively via viewBox preserve
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;
  const stepX = len > 1 ? innerW / (len - 1) : innerW;

  const yToPx = (v: number) => PADDING.top + innerH - ((v - min) / range) * innerH;
  const xToPx = (i: number) => PADDING.left + i * stepX;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => min + (range * i) / yTicks);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full", className)}
      role="img"
      aria-label={`Line chart with ${series.length} series`}
    >
      {/* y grid */}
      {tickValues.map((v, i) => (
        <g key={i}>
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={yToPx(v)}
            y2={yToPx(v)}
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeWidth={1}
          />
          <text
            x={PADDING.left - 6}
            y={yToPx(v) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize="10"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}

      {/* x labels */}
      {labels?.map((label, i) =>
        i % Math.max(1, Math.floor(len / 6)) === 0 ? (
          <text
            key={i}
            x={xToPx(i)}
            y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="10"
          >
            {label}
          </text>
        ) : null,
      )}

      {/* lines (single-point series render as a dot, not a line) */}
      {series.map((s) =>
        s.data.length === 1 ? (
          <circle
            key={s.name}
            cx={xToPx(0)}
            cy={yToPx(s.data[0])}
            r={3}
            fill={s.color}
          />
        ) : (
          <polyline
            key={s.name}
            points={s.data.map((v, i) => `${xToPx(i).toFixed(2)},${yToPx(v).toFixed(2)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}
