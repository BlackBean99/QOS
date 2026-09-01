"use client";

import { useId } from "react";

import type { EquityPoint } from "@/src/domain/backtest";

interface AccessibleChartProps {
  points: EquityPoint[];
  value: "equity" | "drawdownPercent";
  label: string;
  currency?: string;
}

function formatCompact(value: number, currency?: string): string {
  if (!currency) return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    style: "currency",
    currency,
    maximumFractionDigits: 1,
  }).format(value);
}

export function AccessibleChart({ points, value, label, currency }: AccessibleChartProps) {
  const id = useId().replace(/:/g, "");
  const values = points.map((point) => point[value]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const width = 720;
  const height = 250;
  const paddingX = 18;
  const paddingY = 24;
  const coordinates = points
    .map((point, index) => {
      const x = paddingX + (index / Math.max(points.length - 1, 1)) * (width - paddingX * 2);
      const y = height - paddingY - ((point[value] - minimum) / range) * (height - paddingY * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const last = points.at(-1)?.[value] ?? 0;

  return (
    <figure className={`chart chart-${value}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{label}</title>
        <desc id={`${id}-desc`}>
          {points[0]?.date}부터 {points.at(-1)?.date}까지. 최저 {formatCompact(minimum, currency)},
          최고 {formatCompact(maximum, currency)}, 마지막 {formatCompact(last, currency)}.
        </desc>
        <g className="chart-grid" aria-hidden="true">
          <line x1="18" x2="702" y1="24" y2="24" />
          <line x1="18" x2="702" y1="125" y2="125" />
          <line x1="18" x2="702" y1="226" y2="226" />
        </g>
        <polyline className="chart-line-shadow" points={coordinates} aria-hidden="true" />
        <polyline className="chart-line" points={coordinates} aria-hidden="true" />
        <circle
          className="chart-endpoint"
          cx={coordinates.split(" ").at(-1)?.split(",")[0]}
          cy={coordinates.split(" ").at(-1)?.split(",")[1]}
          r="5"
          aria-hidden="true"
        />
      </svg>
      <figcaption>
        <span>{points[0]?.date}</span>
        <strong>실선 · {label}</strong>
        <span>{points.at(-1)?.date}</span>
      </figcaption>
    </figure>
  );
}
