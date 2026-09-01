import { describe, expect, it } from "vitest";

import type { Candle } from "@/src/fixtures/markets";
import {
  IndicatorRegistry,
  type IndicatorRuntimeContext,
} from "@/src/domain/strategy-runtime/indicators";
import type { IndicatorOperand } from "@/src/domain/strategy-v3/schema";

function fixture(length = 120): Candle[] {
  const start = Date.parse("2026-01-05T14:30:00.000Z");
  return Array.from({ length }, (_, index) => {
    const session = Math.floor(index / 30);
    const within = index % 30;
    const base = 100 + session * 2 + within * 0.18 + Math.sin(index / 3) * 1.4;
    const open = base - Math.sin(index) * 0.25;
    const close = base + Math.cos(index / 2) * 0.35;
    return {
      date: new Date(start + session * 86_400_000 + within * 300_000).toISOString(),
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.7,
      close,
      volume: 1_000 + (index % 11) * 130,
    };
  });
}

const context: IndicatorRuntimeContext = {
  primaryTimeframe: "5m",
  marketTimeZone: "America/New_York",
  sessionOpen: "09:30",
  sessionClose: "16:00",
};

function operand(value: Record<string, unknown>): IndicatorOperand {
  return { type: "INDICATOR", timeframe: "5m", offset: 0, ...value } as IndicatorOperand;
}

describe("Strategy v3 indicator registry", () => {
  it("calculates every supported indicator family with explicit named outputs", () => {
    const candles = fixture();
    const registry = new IndicatorRegistry(candles, context);
    const operands: IndicatorOperand[] = [
      operand({ kind: "PRICE", field: "hlc3" }),
      operand({ kind: "VOLUME" }),
      operand({ kind: "SMA", period: 20 }),
      operand({ kind: "EMA", period: 20 }),
      operand({ kind: "RSI", period: 14 }),
      operand({
        kind: "MACD",
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        output: "HISTOGRAM",
      }),
      operand({ kind: "ATR", period: 14 }),
      operand({ kind: "ATRP", period: 14 }),
      operand({ kind: "ATR_EXPANSION", period: 14, averagePeriod: 20 }),
      operand({ kind: "ADX", period: 14, output: "ADX" }),
      operand({ kind: "ADX", period: 14, output: "PLUS_DI" }),
      operand({
        kind: "ICHIMOKU",
        tenkanPeriod: 9,
        kijunPeriod: 26,
        spanBPeriod: 52,
        displacement: 26,
        output: "CLOUD_TOP_SOURCE",
      }),
      operand({ kind: "STOCHASTIC", kPeriod: 14, kSmoothing: 3, dPeriod: 3, output: "D" }),
      operand({ kind: "ROC", period: 10 }),
      operand({ kind: "MOMENTUM", period: 10 }),
      operand({ kind: "BOLLINGER", period: 20, standardDeviations: 2, output: "UPPER" }),
      operand({ kind: "BB_WIDTH_PERCENTILE", period: 20, standardDeviations: 2, lookback: 30 }),
      operand({ kind: "DONCHIAN", period: 20, excludeCurrent: true, output: "UPPER" }),
      operand({ kind: "KELTNER", emaPeriod: 20, atrPeriod: 14, multiplier: 2, output: "UPPER" }),
      operand({ kind: "VWAP", variant: { kind: "SESSION" }, output: "VALUE" }),
      operand({ kind: "VWAP", variant: { kind: "WEEKLY" }, output: "VALUE" }),
      operand({ kind: "VWAP", variant: { kind: "MONTHLY" }, output: "VALUE" }),
      operand({
        kind: "VWAP",
        variant: { kind: "ANCHORED", anchor: candles[10].date },
        output: "VALUE",
      }),
      operand({
        kind: "VWAP",
        variant: { kind: "ROLLING_BARS", bars: 15 },
        output: "UPPER_BAND",
        bandStandardDeviations: 2,
      }),
      operand({ kind: "VWAP", variant: { kind: "ROLLING_DAYS", days: 2 }, output: "Z_SCORE" }),
      operand({ kind: "VOLUME_SMA", period: 20 }),
      operand({ kind: "RELATIVE_VOLUME", period: 20 }),
      operand({ kind: "OBV" }),
      operand({ kind: "OBV", output: "PREVIOUS_HIGH", period: 20 }),
      operand({ kind: "CMF", period: 20 }),
      operand({ kind: "ZSCORE", period: 20 }),
      operand({ kind: "MA_DEVIATION", average: "EMA", period: 20 }),
      operand({ kind: "HIGHEST", period: 20, field: "high", excludeCurrent: true }),
      operand({ kind: "LOWEST", period: 20, field: "low", excludeCurrent: true }),
      operand({ kind: "OPENING_RANGE", minutes: 15, output: "HIGH" }),
      operand({
        kind: "MARKET_STRUCTURE",
        lookback: 20,
        leftBars: 2,
        rightBars: 2,
        output: "SWING_HIGH",
      }),
      operand({ kind: "PARABOLIC_SAR", accelerationStep: 0.02, accelerationMaximum: 0.2 }),
      operand({ kind: "MA_SLOPE", average: "EMA", period: 20, lookback: 5 }),
    ];

    for (const item of operands) {
      const series = registry.series(item);
      expect(series).toHaveLength(candles.length);
      expect(
        series.some((value) => value !== null),
        item.kind,
      ).toBe(true);
    }
  });

  it("keeps every tested signal prefix-invariant and therefore look-ahead safe", () => {
    const candles = fixture();
    const tested: IndicatorOperand[] = [
      operand({ kind: "EMA", period: 9 }),
      operand({ kind: "RSI", period: 14 }),
      operand({ kind: "MACD", fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, output: "SIGNAL" }),
      operand({ kind: "ADX", period: 14, output: "ADX" }),
      operand({
        kind: "ICHIMOKU",
        tenkanPeriod: 9,
        kijunPeriod: 26,
        spanBPeriod: 52,
        displacement: 26,
        output: "SPAN_B_SOURCE",
      }),
      operand({ kind: "BB_WIDTH_PERCENTILE", period: 20, standardDeviations: 2, lookback: 20 }),
      operand({ kind: "VWAP", variant: { kind: "ROLLING_DAYS", days: 2 }, output: "VALUE" }),
      operand({
        kind: "MARKET_STRUCTURE",
        lookback: 20,
        leftBars: 2,
        rightBars: 2,
        output: "SWING_HIGH",
      }),
    ];

    for (const item of tested) {
      const full = new IndicatorRegistry(candles, context).series(item);
      for (const end of [55, 72, 95, 120]) {
        const prefix = new IndicatorRegistry(candles.slice(0, end), context).series(item);
        expect(prefix.at(-1), `${item.kind} at ${end}`).toBe(full[end - 1]);
      }
    }
  });

  it("uses only completed higher-timeframe candles", () => {
    const candles = fixture();
    const registry = new IndicatorRegistry(candles, context);
    const daily = {
      type: "INDICATOR" as const,
      timeframe: "1d" as const,
      offset: 0,
      kind: "EMA" as const,
      period: 2,
    };
    const values = registry.series(daily);

    expect(values.slice(0, 60).every((value) => value === null)).toBe(true);
    expect(values[60]).not.toBeNull();
    expect(values[60]).toBe(values[89]);
  });

  it("aligns intraday higher-timeframe buckets to the exchange session open", () => {
    const candles = fixture(30);
    const registry = new IndicatorRegistry(candles, context);
    const hourlyClose = registry.series({
      type: "INDICATOR",
      timeframe: "60m",
      offset: 0,
      kind: "PRICE",
      field: "close",
    });

    expect(hourlyClose.slice(0, 11).every((value) => value === null)).toBe(true);
    expect(hourlyClose[11]).toBe(candles[11].close);
    expect(hourlyClose[22]).toBe(candles[11].close);
    expect(hourlyClose[23]).toBe(candles[23].close);
  });

  it("keeps Ichimoku source spans separate from forward chart projection", () => {
    const candles = fixture(80);
    const registry = new IndicatorRegistry(candles, context);
    const source = registry.series(
      operand({
        kind: "ICHIMOKU",
        tenkanPeriod: 9,
        kijunPeriod: 26,
        spanBPeriod: 52,
        displacement: 26,
        output: "SPAN_A_SOURCE",
      }),
    );

    expect(source[50]).not.toBeNull();
    expect(source[24]).toBeNull();
  });
});
