"use client";

import dynamic from "next/dynamic";

import type { InstrumentSummary } from "@/src/domain/instruments";
import type { ChartSettings } from "@/src/domain/stored-strategy";
import type { ChartLevel, ChartSignal } from "./interactive-market-chart";

const InteractiveMarketChart = dynamic(
  () => import("./interactive-market-chart").then((module) => module.InteractiveMarketChart),
  {
    ssr: false,
    loading: () => (
      <div className="chart-loading" role="status">
        차트 도구를 불러오는 중입니다.
      </div>
    ),
  },
);

export function MarketChartPanel({
  instrument,
  settings,
  signals,
  levels = [],
  onSettingsChange,
}: {
  instrument: InstrumentSummary;
  settings: ChartSettings;
  signals: ChartSignal[];
  levels?: ChartLevel[];
  onSettingsChange: (settings: ChartSettings) => void;
}) {
  return (
    <InteractiveMarketChart
      instrument={instrument}
      settings={settings}
      signals={signals}
      levels={levels}
      onSettingsChange={onSettingsChange}
    />
  );
}
