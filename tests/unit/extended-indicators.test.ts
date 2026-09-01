import { describe, expect, it } from "vitest";

import {
  EXTENDED_INDICATOR_NAMES,
  calculateExtendedIndicator,
} from "@/src/components/market-chart/extended-indicators";
import {
  IndicatorInstanceSchema,
  INDICATOR_CATALOG,
  createIndicatorInstance,
  indicatorRequiredHistory,
  type ChartIndicator,
} from "@/src/domain/chart-indicators";

const candles = Array.from({ length: 400 }, (_, index) => {
  const close = 100 + index * 0.4 + Math.sin(index / 5) * 3;
  return {
    timestamp: Date.UTC(2025, 0, 1) + index * 86_400_000,
    open: close - 0.5,
    high: close + 2,
    low: close - 2,
    close,
    volume: 10_000 + index * 50,
  };
});

describe("extended chart indicators", () => {
  it("calculates every catalog extension as an aligned finite series", () => {
    expect(EXTENDED_INDICATOR_NAMES).toHaveLength(74);
    for (const name of EXTENDED_INDICATOR_NAMES) {
      const result = calculateExtendedIndicator(name, candles);
      expect(result, name).toHaveLength(candles.length);
      expect(
        result.some((point) =>
          Object.values(point).some((value) => value !== null && Number.isFinite(value)),
        ),
        `${name} must produce a finite value after warm-up`,
      ).toBe(true);
    }
  });

  it("produces a finite default value within each declared daily history budget", () => {
    for (const name of EXTENDED_INDICATOR_NAMES) {
      const item = INDICATOR_CATALOG.find((candidate) => candidate.name === name);
      expect(item, name).toBeDefined();
      const required = indicatorRequiredHistory(name, item?.defaultParams ?? []);
      const result = calculateExtendedIndicator(name, candles.slice(0, required));
      expect(
        result.some((point) =>
          Object.values(point).some((value) => value !== null && Number.isFinite(value)),
        ),
        `${name} should be finite inside its default history budget`,
      ).toBe(true);
    }
  });

  it("enforces the lowest mathematically calculable period for sensitive formulas", () => {
    const boundaries: Array<{
      name: ChartIndicator;
      index: number;
      min: number;
    }> = [
      { name: "ADX", index: 0, min: 2 },
      { name: "HMA", index: 0, min: 2 },
      { name: "RVI", index: 1, min: 2 },
      { name: "SMI", index: 0, min: 2 },
      { name: "LINREG", index: 0, min: 2 },
      { name: "LINREG_SLOPE", index: 0, min: 2 },
      { name: "ZLEMA", index: 0, min: 3 },
    ];

    for (const boundary of boundaries) {
      const item = INDICATOR_CATALOG.find((candidate) => candidate.name === boundary.name);
      expect(item, boundary.name).toBeDefined();
      const params = [...(item?.defaultParams ?? [])];
      params[boundary.index] = boundary.min;
      const instance = createIndicatorInstance(boundary.name, `minimum-${boundary.name}`);

      expect(
        IndicatorInstanceSchema.safeParse({ ...instance, calcParams: params }).success,
        `${boundary.name} should accept ${boundary.min}`,
      ).toBe(true);
      expect(
        calculateExtendedIndicator(boundary.name, candles, params).some((point) =>
          Object.values(point).some((value) => value !== null && Number.isFinite(value)),
        ),
        `${boundary.name} should calculate at ${boundary.min}`,
      ).toBe(true);

      const invalid = [...params];
      invalid[boundary.index] = boundary.min - 1;
      expect(
        IndicatorInstanceSchema.safeParse({ ...instance, calcParams: invalid }).success,
        `${boundary.name} should reject ${boundary.min - 1}`,
      ).toBe(false);
    }
  });

  it("aligns Donchian output without shifting it into the warm-up window", () => {
    const result = calculateExtendedIndicator("DONCHIAN", candles.slice(0, 5), [3]);
    expect(result[0]).toEqual({ upper: null, middle: null, lower: null });
    expect(result[1]).toEqual({ upper: null, middle: null, lower: null });
    expect(result[2]).toEqual({
      upper: Math.max(...candles.slice(0, 3).map((candle) => candle.high)),
      middle:
        (Math.max(...candles.slice(0, 3).map((candle) => candle.high)) +
          Math.min(...candles.slice(0, 3).map((candle) => candle.low))) /
        2,
      lower: Math.min(...candles.slice(0, 3).map((candle) => candle.low)),
    });
  });

  it("treats unchanged closes as zero net volume", () => {
    const result = calculateExtendedIndicator("NET_VOLUME", [
      { ...candles[0], close: 10, volume: 100 },
      { ...candles[1], close: 10, volume: 200 },
      { ...candles[2], close: 9, volume: 300 },
    ]);
    expect(result).toEqual([{ net: 0 }, { net: 0 }, { net: -300 }]);
  });

  it("ranks Connors RSI with percentage returns and a complete comparison window", () => {
    const reference = [100, 110, 99, 108.9, 87.12, 104.544].map((close, index) => ({
      ...candles[index],
      close,
    }));
    const result = calculateExtendedIndicator("CONNORS_RSI", reference, [2, 2, 3]);
    expect(result.slice(0, 4).every((point) => point.connors === null)).toBe(true);
    expect(result[4]?.connors).not.toBeNull();
    expect(result[5]?.connors).not.toBeNull();
  });

  it("matches an independent Wilder Supertrend recurrence", () => {
    const sample = Array.from({ length: 40 }, (_, index) => {
      const close = 100 + Math.sin(index / 2) * 12 + index * 0.15;
      return {
        timestamp: Date.UTC(2026, 0, 1 + index),
        open: close - 1,
        high: close + 3,
        low: close - 4,
        close,
        volume: 1_000,
      };
    });
    const period = 5;
    const multiplier = 2;
    const trueRanges = sample.map((candle, index) =>
      index === 0
        ? candle.high - candle.low
        : Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - sample[index - 1].close),
            Math.abs(candle.low - sample[index - 1].close),
          ),
    );
    const atr: Array<number | null> = sample.map(() => null);
    atr[period - 1] = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (let index = period; index < sample.length; index += 1) {
      atr[index] = ((atr[index - 1] as number) * (period - 1) + trueRanges[index]) / period;
    }
    const expected: Array<number | null> = sample.map(() => null);
    let upper = 0;
    let lower = 0;
    let previousLine = 0;
    for (let index = period - 1; index < sample.length; index += 1) {
      const candle = sample[index];
      const center = (candle.high + candle.low) / 2;
      const basicUpper = center + multiplier * (atr[index] as number);
      const basicLower = center - multiplier * (atr[index] as number);
      if (index === period - 1) {
        upper = basicUpper;
        lower = basicLower;
        previousLine = upper;
        expected[index] = upper;
        continue;
      }
      const previousUpper = upper;
      const previousLower = lower;
      const previousClose = sample[index - 1].close;
      upper =
        basicUpper < previousUpper || previousClose > previousUpper ? basicUpper : previousUpper;
      lower =
        basicLower > previousLower || previousClose < previousLower ? basicLower : previousLower;
      previousLine =
        previousLine === previousUpper
          ? candle.close <= upper
            ? upper
            : lower
          : candle.close >= lower
            ? lower
            : upper;
      expected[index] = previousLine;
    }

    const actual = calculateExtendedIndicator("SUPER_TREND", sample, [period, multiplier]).map(
      (point) => point.trend,
    );
    expect(actual).toEqual(expected);
  });

  it("keeps compound daily warm-up settings inside the 400-bar preload budget", () => {
    const cases: Array<[ChartIndicator, number[]]> = [
      ["ADX", [200]],
      ["AROON", [399]],
      ["MFI", [399]],
      ["HMA", [380]],
      ["MOMENTUM", [399]],
      ["HIST_VOL", [399]],
      ["AROON_OSC", [399]],
      ["CHAIKIN_VOL", [1]],
      ["CHAIKIN_VOL", [200]],
      ["MASS_INDEX", [384]],
      ["VHF", [399]],
      ["VORTEX", [399]],
      ["ACCELERATOR_OSC", [367]],
    ];
    for (const [name, params] of cases) {
      const required = indicatorRequiredHistory(name, params);
      expect(required, name).toBeLessThanOrEqual(400);
      const instance = createIndicatorInstance(name, `budget-${name.toLowerCase()}`);
      expect(
        IndicatorInstanceSchema.safeParse({ ...instance, calcParams: params, timeframe: "1d" })
          .success,
        name,
      ).toBe(true);
      const result = calculateExtendedIndicator(name, candles.slice(0, required), params);
      expect(
        result.some((point) =>
          Object.values(point).some((value) => value !== null && Number.isFinite(value)),
        ),
        `${name} should be finite within its declared history budget`,
      ).toBe(true);
    }
  });
});
