import { describe, expect, it } from "vitest";

import {
  BacktestWindowInputSchema,
  estimateBacktestTargetBars,
  filterCompletedBacktestCandles,
  filterCandlesByBacktestWindow,
  resolveBacktestWindow,
} from "@/src/domain/backtest-window";

const now = new Date("2026-09-01T03:00:00.000Z");

describe("backtest window", () => {
  it("chooses an explicit timeframe-aware default in the instrument timezone", () => {
    expect(resolveBacktestWindow("5m", undefined, "Asia/Seoul", now)).toMatchObject({
      source: "DEFAULT",
      startDate: "2026-08-03",
      endDate: "2026-09-01",
    });
    expect(resolveBacktestWindow("1d", undefined, "America/New_York", now)).toMatchObject({
      source: "DEFAULT",
      startDate: "2024-08-31",
      endDate: "2026-08-31",
    });
    expect(resolveBacktestWindow("1w", undefined, "Asia/Seoul", now)).toMatchObject({
      source: "DEFAULT",
      startDate: "2021-09-01",
      endDate: "2026-09-01",
    });
  });

  it("validates explicit windows and fails closed for unavailable intraday history", () => {
    const input = BacktestWindowInputSchema.parse({
      startDate: "2026-08-10",
      endDate: "2026-08-28",
    });
    expect(resolveBacktestWindow("5m", input, "America/New_York", now)).toMatchObject({
      source: "CUSTOM",
      startDate: "2026-08-10",
      endDate: "2026-08-28",
    });
    expect(() =>
      resolveBacktestWindow(
        "5m",
        { startDate: "2026-06-01", endDate: "2026-08-28" },
        "America/New_York",
        now,
      ),
    ).toThrow(/31/);
    expect(() =>
      resolveBacktestWindow(
        "1d",
        { startDate: "2026-09-02", endDate: "2026-09-01" },
        "Asia/Seoul",
        now,
      ),
    ).toThrow(/시작일/);
  });

  it("filters inclusive local dates and sizes provider history from the start boundary", () => {
    const window = resolveBacktestWindow(
      "1d",
      { startDate: "2026-08-30", endDate: "2026-08-31" },
      "America/New_York",
      now,
    );
    const candles = [
      { date: "2026-08-30T01:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: "2026-08-30T14:30:00.000Z", open: 2, high: 2, low: 2, close: 2, volume: 2 },
      { date: "2026-09-01T01:00:00.000Z", open: 3, high: 3, low: 3, close: 3, volume: 3 },
    ];

    expect(
      filterCandlesByBacktestWindow(candles, window, "America/New_York").map(
        (candle) => candle.close,
      ),
    ).toEqual([2, 3]);
    expect(
      estimateBacktestTargetBars("1d", window, "America/New_York", now),
    ).toBeGreaterThanOrEqual(10);
    expect(
      estimateBacktestTargetBars(
        "1m",
        resolveBacktestWindow("1m", undefined, "Asia/Seoul", now),
        "Asia/Seoul",
        now,
      ),
    ).toBeLessThanOrEqual(8_000);
  });

  it("excludes the current unfinished intraday, daily and weekly candle", () => {
    const intraday = [
      { date: "2026-09-01T02:50:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: "2026-09-01T02:58:00.000Z", open: 2, high: 2, low: 2, close: 2, volume: 2 },
    ];
    expect(
      filterCompletedBacktestCandles(intraday, "5m", "Asia/Seoul", "KRW", now).map(
        (candle) => candle.close,
      ),
    ).toEqual([1]);

    const daily = [
      { date: "2026-08-30T14:30:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: "2026-08-31T14:30:00.000Z", open: 2, high: 2, low: 2, close: 2, volume: 2 },
    ];
    const beforeNewYorkClose = new Date("2026-08-31T18:00:00.000Z");
    expect(
      filterCompletedBacktestCandles(
        daily,
        "1d",
        "America/New_York",
        "USD",
        beforeNewYorkClose,
      ).map((candle) => candle.close),
    ).toEqual([1]);

    const weekly = [
      { date: "2026-08-24T14:30:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: "2026-08-31T14:30:00.000Z", open: 2, high: 2, low: 2, close: 2, volume: 2 },
    ];
    expect(
      filterCompletedBacktestCandles(
        weekly,
        "1w",
        "America/New_York",
        "USD",
        beforeNewYorkClose,
      ).map((candle) => candle.close),
    ).toEqual([1]);
  });

  it("treats the final partial intraday bucket as complete at the exchange close", () => {
    const koreanFinalHour = [
      { date: "2026-09-01T06:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    expect(
      filterCompletedBacktestCandles(
        koreanFinalHour,
        "60m",
        "Asia/Seoul",
        "KRW",
        new Date("2026-09-01T06:30:06.000Z"),
      ),
    ).toHaveLength(1);

    const usFinalFourHours = [
      { date: "2026-09-01T17:30:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    expect(
      filterCompletedBacktestCandles(
        usFinalFourHours,
        "4h",
        "America/New_York",
        "USD",
        new Date("2026-09-01T20:00:06.000Z"),
      ),
    ).toHaveLength(1);
  });
});
