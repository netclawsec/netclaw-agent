import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  stroke = "currentColor",
  fill,
  className,
}: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const coords = data.map((v, i) => [
    i * stepX,
    height - ((v - min) / range) * height,
  ] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const firstX = coords[0][0];
  const lastX = coords[coords.length - 1][0];
  const areaPath = `M${firstX.toFixed(2)},${height} ${linePath.replace(/^M/, "L")} L${lastX.toFixed(2)},${height} Z`;

  return (
    <svg width={width} height={height} className={cn("block", className)} aria-hidden="true">
      {fill && <path d={areaPath} fill={fill} opacity={0.25} />}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
