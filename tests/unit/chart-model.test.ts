import { describe, expect, it } from "vitest";

import {
  aggregateFiveMinuteCandles,
  calculateWilliamsFractals,
  dailyBucketStart,
  overlayNameForDrawing,
  periodForChart,
  resolveFiveMinuteProviderPage,
  resolveHistoryPage,
} from "@/src/components/market-chart/chart-model";

describe("market chart model", () => {
  it("reconciles a five-minute candle split across inclusive provider pages", () => {
    const origin = Date.UTC(2026, 7, 24, 13, 30);
    const minute = (index: number) => ({
      timestamp: new Date(origin + index * 60_000).toISOString(),
      open: index,
      high: index + 2,
      low: index - 1,
      close: index + 1,
      volume: 1,
      currency: "USD" as const,
    });
    const initial = resolveFiveMinuteProviderPage(
      { oldestRawTimestamp: null, pendingOldestBucket: [] },
      {
        type: "init",
        requestedCursor: null,
        nextBefore: "cursor-1",
        candles: Array.from({ length: 200 }, (_, offset) => minute(offset + 2)),
      },
    );
    expect(initial.candles[0]?.timestampMs).toBe(origin + 5 * 60_000);
    expect(initial.state.pendingOldestBucket).toHaveLength(3);

    const older = resolveFiveMinuteProviderPage(initial.state, {
      type: "forward",
      requestedCursor: "cursor-1",
      nextBefore: "cursor-2",
      candles: Array.from({ length: 200 }, (_, offset) => minute(offset - 197)),
    });
    expect(older.candles.find((candle) => candle.timestampMs === origin)).toEqual(
      expect.objectContaining({ open: 0, high: 6, low: -1, close: 5, volume: 5 }),
    );
  });

  it("loads historical pages only to the older/forward side and stops repeated cursors", () => {
    const initial = resolveHistoryPage(
      { olderCursor: null, timestamps: [] },
      {
        type: "init",
        boundaryTimestamp: null,
        requestedCursor: null,
        nextBefore: "cursor-1",
        candles: [
          { timestampMs: 300, open: 3, high: 4, low: 2, close: 3, volume: 30 },
          { timestampMs: 400, open: 4, high: 5, low: 3, close: 4, volume: 40 },
        ],
      },
    );

    expect(initial.bars.map((bar) => bar.timestamp)).toEqual([300, 400]);
    expect(initial.more).toEqual({ forward: true, backward: false });

    const older = resolveHistoryPage(initial.state, {
      type: "forward",
      boundaryTimestamp: 300,
      requestedCursor: "cursor-1",
      nextBefore: "cursor-2",
      candles: [
        { timestampMs: 100, open: 1, high: 2, low: 0, close: 1, volume: 10 },
        { timestampMs: 200, open: 2, high: 3, low: 1, close: 2, volume: 20 },
        { timestampMs: 300, open: 3, high: 4, low: 2, close: 3, volume: 30 },
      ],
    });

    expect(older.bars.map((bar) => bar.timestamp)).toEqual([100, 200]);
    expect(older.more).toEqual({ forward: true, backward: false });
    expect(new Set(older.state.timestamps).size).toBe(older.state.timestamps.length);

    const repeated = resolveHistoryPage(older.state, {
      type: "forward",
      boundaryTimestamp: 100,
      requestedCursor: "cursor-2",
      nextBefore: "cursor-2",
      candles: [
        { timestampMs: 100, open: 1, high: 2, low: 0, close: 1, volume: 10 },
        { timestampMs: 200, open: 2, high: 3, low: 1, close: 2, volume: 20 },
      ],
    });

    expect(repeated.bars).toEqual([]);
    expect(repeated.more).toEqual({ forward: false, backward: false });
  });

  it("never appends an older provider page on the newer/backward side", () => {
    const result = resolveHistoryPage(
      { olderCursor: "cursor-1", timestamps: [300, 400] },
      {
        type: "backward",
        boundaryTimestamp: 400,
        requestedCursor: null,
        nextBefore: null,
        candles: [
          { timestampMs: 100, open: 1, high: 2, low: 0, close: 1, volume: 10 },
          { timestampMs: 200, open: 2, high: 3, low: 1, close: 2, volume: 20 },
        ],
      },
    );

    expect(result.bars).toEqual([]);
    expect(result.more).toEqual({ forward: false, backward: false });
    expect(result.state.timestamps).toEqual([300, 400]);
  });

  it("aggregates ordered one-minute candles into exact five-minute OHLCV", () => {
    const result = aggregateFiveMinuteCandles([
      {
        timestamp: "2026-03-25T09:00:00+09:00",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 10,
        currency: "KRW",
      },
      {
        timestamp: "2026-03-25T09:01:00+09:00",
        open: 102,
        high: 105,
        low: 101,
        close: 104,
        volume: 20,
        currency: "KRW",
      },
      {
        timestamp: "2026-03-25T09:05:00+09:00",
        open: 104,
        high: 106,
        low: 103,
        close: 105,
        volume: 30,
        currency: "KRW",
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ open: 100, high: 105, low: 99, close: 104, volume: 30 }),
      expect.objectContaining({ open: 104, high: 106, low: 103, close: 105, volume: 30 }),
    ]);
  });

  it("maps every requested drawing to a built-in or registered overlay", () => {
    expect(
      (
        [
          "trend_line",
          "straight_line",
          "ray",
          "horizontal_ray",
          "horizontal_segment",
          "horizontal_line",
          "vertical_ray",
          "vertical_segment",
          "vertical_line",
          "parallel_lines",
          "price_channel",
          "price_line",
          "brush",
          "rectangle",
          "fibonacci",
          "pitchfork",
          "fan",
          "annotation",
          "tag",
        ] as const
      ).map(overlayNameForDrawing),
    ).toEqual([
      "segment",
      "straightLine",
      "rayLine",
      "horizontalRayLine",
      "horizontalSegment",
      "horizontalStraightLine",
      "verticalRayLine",
      "verticalSegment",
      "verticalStraightLine",
      "parallelStraightLine",
      "priceChannelLine",
      "priceLine",
      "brush",
      "qosRectangle",
      "fibonacciLine",
      "qosPitchfork",
      "qosFan",
      "simpleAnnotation",
      "simpleTag",
    ]);
  });

  it("maps display periods to KLineChart periods and provider intervals", () => {
    expect(periodForChart("1m")).toEqual({ chart: { type: "minute", span: 1 }, provider: "1m" });
    expect(periodForChart("5m")).toEqual({ chart: { type: "minute", span: 5 }, provider: "1m" });
    expect(periodForChart("1d")).toEqual({ chart: { type: "day", span: 1 }, provider: "1d" });
  });

  it("starts a new daily live candle at midnight in the instrument timezone", () => {
    expect(dailyBucketStart(Date.parse("2026-08-23T14:30:00Z"), "Asia/Seoul")).toBe(
      Date.parse("2026-08-22T15:00:00Z"),
    );
    expect(dailyBucketStart(Date.parse("2026-08-23T14:30:00Z"), "America/New_York")).toBe(
      Date.parse("2026-08-23T04:00:00Z"),
    );
  });

  it("confirms a Williams fractal only after two lower highs or higher lows on each side", () => {
    const result = calculateWilliamsFractals([
      { high: 8, low: 6 },
      { high: 10, low: 5 },
      { high: 12, low: 4 },
      { high: 11, low: 5 },
      { high: 9, low: 6 },
      { high: 13, low: 3 },
      { high: 8, low: 7 },
    ]);

    expect(result).toEqual([{}, {}, { up: 12, down: 4 }, {}, {}, {}, {}]);
  });
});
