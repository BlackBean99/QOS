import { describe, expect, it, vi } from "vitest";

import { createStrategyRecommendationHandler } from "@/app/api/strategy-recommendations/route";
import { ENTRY_PRESETS_V3 } from "@/src/domain/strategy-v3/catalog";
import type { BacktestMetricsV3 } from "@/src/domain/backtest-v3/engine";

const instrument = {
  instrumentId: "NASDAQ:NVDA" as const,
  market: "NASDAQ" as const,
  symbol: "NVDA",
  displayName: "NVIDIA",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
};

const candles = Array.from({ length: 260 }, (_, index) => ({
  date: new Date(Date.parse("2025-09-01T14:30:00.000Z") + index * 86_400_000).toISOString(),
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100.5 + index,
  volume: 1_000 + index,
}));

function metrics(totalReturnPercent: number): BacktestMetricsV3 {
  return {
    totalReturnPercent,
    cagrPercent: totalReturnPercent,
    maximumDrawdownPercent: 3,
    sharpeRatio: 1.2,
    sortinoRatio: 1.3,
    calmarRatio: 2,
    winRatePercent: 55,
    lossRatePercent: 45,
    profitFactor: 1.4,
    expectancy: 1,
    averageWin: 2,
    averageLoss: -1,
    payoffRatio: 2,
    averageRMultiple: 0.5,
    numberOfTrades: 4,
    averageHoldingPeriodBars: 5,
    maximumConsecutiveWins: 3,
    maximumConsecutiveLosses: 2,
    exposurePercent: 20,
    turnoverPercent: 30,
    commissionCost: 1,
    slippageCost: 2,
    startingCapital: 100_000,
    endingEquity: 100_000 + totalReturnPercent * 1_000,
  };
}

describe("strategy recommendation route", () => {
  it("evaluates every entry preset once, ranks the top return and caches the result", async () => {
    const loader = vi.fn(async () => ({
      candles,
      runtime: {
        marketTimeZone: instrument.timezone,
        sessionOpen: "09:30",
        sessionClose: "16:00",
        source: "fixture",
        adjustedPrices: true,
      },
    }));
    const evaluate = vi.fn((_strategy, _candles, _runtime, preset) =>
      metrics(preset.id === "rolling-vwap-breakout" ? 42 : 1),
    );
    const handler = createStrategyRecommendationHandler({
      loader,
      evaluate,
      now: () => new Date("2026-09-01T03:00:00.000Z"),
    });
    const body = JSON.stringify({ instrument, timeframe: "1d" });

    const first = await handler(
      new Request("http://qos.local/api/strategy-recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    const firstPayload = await first.json();
    const second = await handler(
      new Request("http://qos.local/api/strategy-recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(firstPayload.methodology.candidatesEvaluated).toBe(43);
    expect(firstPayload.recommendation).toMatchObject({
      presetId: "rolling-vwap-breakout",
      metrics: { totalReturnPercent: 42 },
    });
    expect(firstPayload.recommendation.strategy.version).toBe(3);
    expect(firstPayload.rankings).toHaveLength(5);
    expect(firstPayload.window.source).toBe("DEFAULT");
    expect(firstPayload.dataPeriod).toMatchObject({ bars: 260 });
    expect(firstPayload.cache).toBe("MISS");
    expect(secondPayload.cache).toBe("HIT");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(ENTRY_PRESETS_V3.length);
  });
});
