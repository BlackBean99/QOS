import { describe, expect, it } from "vitest";

import {
  atr,
  ema,
  ichimoku,
  rollingSessionVwap,
  stochasticRsi,
  wilderRsi,
} from "@/src/domain/indicators";
import type { Candle } from "@/src/fixtures/markets";

function candle(date: string, close: number, volume = 10): Candle {
  return { date, open: close - 0.5, high: close + 1, low: close - 1, close, volume };
}

describe("indicator math", () => {
  it("seeds EMA with the first full-period SMA", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("calculates rolling session VWAP without future bars", () => {
    const candles = [
      candle("2025-01-02T09:00:00", 10, 1),
      candle("2025-01-02T09:05:00", 20, 3),
      candle("2025-01-03T09:00:00", 30, 2),
      candle("2025-01-03T09:05:00", 40, 2),
    ];
    const values = rollingSessionVwap(candles, 2);
    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(values[2]).toBeCloseTo((10 * 1 + 20 * 3 + 30 * 2) / 6);
    expect(values[3]).toBeCloseTo((10 * 1 + 20 * 3 + 30 * 2 + 40 * 2) / 8);
  });

  it("returns ATR and Ichimoku only after their warm-up", () => {
    const candles = Array.from({ length: 30 }, (_, index) =>
      candle(`2025-01-${String(index + 1).padStart(2, "0")}T09:00:00`, 100 + index),
    );
    expect(atr(candles, 14)[12]).toBeNull();
    expect(atr(candles, 14)[13]).not.toBeNull();
    const cloud = ichimoku(candles, 9, 26, 26);
    expect(cloud[24].kijun).toBeNull();
    expect(cloud[25].kijun).not.toBeNull();
  });

  it("uses Wilder smoothing for ATR and RSI reference vectors", () => {
    const candles: Candle[] = [
      { date: "1", open: 10, high: 11, low: 9, close: 10, volume: 1 },
      { date: "2", open: 10, high: 13, low: 10, close: 12, volume: 1 },
      { date: "3", open: 12, high: 16, low: 12, close: 15, volume: 1 },
      { date: "4", open: 15, high: 20, low: 15, close: 19, volume: 1 },
    ];
    const ranges = atr(candles, 3);
    expect(ranges.slice(0, 2)).toEqual([null, null]);
    expect(ranges[2]).toBeCloseTo(3);
    expect(ranges[3]).toBeCloseTo(11 / 3);

    const values = [10, 11, 13, 12, 14, 15, 14];
    const rsi = wilderRsi(values, 3);
    expect(rsi[3]).toBeCloseTo(75);
    expect(rsi[4]).toBeCloseTo(85.7142857);
    expect(rsi[5]).toBeCloseTo(89.1891892);
    expect(rsi[6]).toBeCloseTo(65.3465347);
  });

  it("places Ichimoku cloud spans forward without reading future candles", () => {
    const candles = Array.from({ length: 10 }, (_, index) => candle(String(index), index + 1));
    const cloud = ichimoku(candles, 2, 3, 4, 2);
    expect(cloud[3]).toEqual({ tenkan: 3.5, kijun: 3, spanA: null, spanB: null });
    expect(cloud[5].spanA).toBeCloseTo(3.25);
    expect(cloud[5].spanB).toBeCloseTo(2.5);
  });

  it("bounds Stochastic RSI between zero and one hundred", () => {
    const values = stochasticRsi(
      Array.from({ length: 80 }, (_, index) => 100 + Math.sin(index / 3) * 8 + index * 0.1),
      14,
      14,
      3,
    ).filter((value): value is number => value !== null);
    expect(values.length).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
  });

  it("matches a short Stochastic RSI reference and is prefix invariant", () => {
    const closes = [10, 11, 13, 12, 14, 15, 14, 16, 18, 17];
    const values = stochasticRsi(closes, 3, 3, 1);
    expect(values[5]).toBeCloseTo(100);
    expect(values[6]).toBeCloseTo(0);
    expect(values[7]).toBeCloseTo(64.6853);

    const candles = Array.from({ length: 90 }, (_, index) =>
      candle(String(index), 100 + Math.sin(index / 4) * 5 + index * 0.2),
    );
    const prefixLength = 70;
    expect(atr(candles, 14).slice(0, prefixLength)).toEqual(
      atr(candles.slice(0, prefixLength), 14),
    );
    expect(ichimoku(candles).slice(0, prefixLength)).toEqual(
      ichimoku(candles.slice(0, prefixLength)),
    );
    expect(stochasticRsi(candles.map((item) => item.close)).slice(0, prefixLength)).toEqual(
      stochasticRsi(candles.slice(0, prefixLength).map((item) => item.close)),
    );
  });
});
