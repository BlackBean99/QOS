import { describe, expect, it, vi } from "vitest";

import { loadTossDataset } from "@/src/server/toss/datasets";
import type { NewStoredStrategy } from "@/src/domain/stored-strategy";
import type { TossClient } from "@/src/server/toss/client";

const instrument: NewStoredStrategy["instrument"] = {
  instrumentId: "NASDAQ:AAPL",
  market: "NASDAQ",
  symbol: "AAPL",
  displayName: "애플",
  currency: "USD",
  timezone: "America/New_York",
  synthetic: false,
  securityType: "STOCK",
  isinCode: "US0378331005",
};

describe("TOSS backtest datasets", () => {
  it("deduplicates inclusive page boundaries and returns chronological daily candles", async () => {
    const getCandles = vi
      .fn()
      .mockResolvedValueOnce({
        candles: [
          {
            timestamp: "2026-03-24T09:00:00+09:00",
            open: 2,
            high: 3,
            low: 1,
            close: 2,
            volume: 2,
            currency: "USD",
          },
          {
            timestamp: "2026-03-25T09:00:00+09:00",
            open: 3,
            high: 4,
            low: 2,
            close: 3,
            volume: 3,
            currency: "USD",
          },
        ],
        nextBefore: "2026-03-24T09:00:00+09:00",
      })
      .mockResolvedValueOnce({
        candles: [
          {
            timestamp: "2026-03-23T09:00:00+09:00",
            open: 1,
            high: 2,
            low: 1,
            close: 2,
            volume: 1,
            currency: "USD",
          },
          {
            timestamp: "2026-03-24T09:00:00+09:00",
            open: 2,
            high: 3,
            low: 1,
            close: 2,
            volume: 2,
            currency: "USD",
          },
        ],
        nextBefore: null,
      });
    const client = { getCandles } as unknown as TossClient;

    const dataset = await loadTossDataset(client, instrument, "1d", { targetBars: 4 });

    expect(dataset.candles.map((candle) => candle.date)).toEqual([
      "2026-03-23T09:00:00+09:00",
      "2026-03-24T09:00:00+09:00",
      "2026-03-25T09:00:00+09:00",
    ]);
    expect(dataset.meta).toMatchObject({
      source: "TOSS OpenAPI adjusted candles",
      synthetic: false,
      timeZone: "America/New_York",
    });
    expect(getCandles).toHaveBeenCalledTimes(2);
  });

  it("aggregates one-minute provider candles for 5m research", async () => {
    const client = {
      getCandles: vi.fn(async () => ({
        candles: [
          {
            timestamp: "2026-03-25T13:30:00.000Z",
            open: 10,
            high: 12,
            low: 9,
            close: 11,
            volume: 2,
            currency: "USD",
          },
          {
            timestamp: "2026-03-25T13:31:00.000Z",
            open: 11,
            high: 13,
            low: 10,
            close: 12,
            volume: 3,
            currency: "USD",
          },
        ],
        nextBefore: null,
      })),
    } as unknown as TossClient;

    const dataset = await loadTossDataset(client, instrument, "5m", { targetBars: 1 });

    expect(dataset).toMatchObject({ timeframe: "5m" });
    expect(dataset.candles).toEqual([
      expect.objectContaining({ open: 10, high: 13, low: 9, close: 12, volume: 5 }),
    ]);
  });
});
