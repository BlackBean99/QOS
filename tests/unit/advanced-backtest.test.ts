import { describe, expect, it } from "vitest";

import { runResearchComparison } from "@/src/domain/advanced-backtest";
import { createReferenceResearchStrategy } from "@/src/domain/advanced-strategy";
import { getIntradayFixture } from "@/src/fixtures/intraday";

describe("intraday exit comparison", () => {
  it("runs eight exits deterministically over the same five-minute fixture", () => {
    const strategy = createReferenceResearchStrategy("NASDAQ:NVDA");
    const first = runResearchComparison(strategy);
    const second = runResearchComparison(strategy);
    expect(first).toEqual(second);
    expect(first.runs).toHaveLength(8);
    expect(first.timeframe).toBe("5m");
    expect(first.runs[0]).not.toHaveProperty("equityCurve");
    expect(new Set(first.runs.map((run) => run.label)).size).toBe(first.runs.length);
    expect(
      first.runs.every((run) =>
        run.exitOverlays.every((overlay) => overlay.values.length === first.chart.candles.length),
      ),
    ).toBe(true);
    expect(first.chart.candles.length).toBeGreaterThan(100);
    expect(first.chart.overlays.vwap.some((value) => value.value !== null)).toBe(true);
  });

  it("applies entry indicator filters without changing the execution contract", () => {
    const base = createReferenceResearchStrategy("NASDAQ:NVDA");
    const result = runResearchComparison({
      ...base,
      entry: {
        ...base.entry,
        filterLogic: "all",
        filters: [
          { kind: "rsi_below", period: 14, value: 70 },
          { kind: "ema_cross_above", fastPeriod: 9, slowPeriod: 21 },
          { kind: "macd_cross_above", fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        ],
      },
    });
    expect(result.strategy.entry.filters).toHaveLength(3);
    expect(result.runs).toHaveLength(8);
    expect(result.chart.candles.length).toBeGreaterThan(100);
  });

  it("labels same-kind parameters uniquely and returns their actual selected overlays", () => {
    const base = createReferenceResearchStrategy("NASDAQ:NVDA");
    const result = runResearchComparison({
      ...base,
      exits: [
        { kind: "vwap_confirm_below", sessionLookback: 2, confirmationBars: 3 },
        { kind: "vwap_confirm_below", sessionLookback: 20, confirmationBars: 3 },
        { kind: "ema_cross_below", fastPeriod: 2, slowPeriod: 3 },
        { kind: "ema_cross_below", fastPeriod: 40, slowPeriod: 80 },
      ],
      overlays: ["EMA"],
    });
    expect(result.runs.map((run) => run.label)).toEqual([
      "VWAP 2D 하향 3봉 확인",
      "VWAP 20D 하향 3봉 확인",
      "EMA 2/3",
      "EMA 40/80",
    ]);
    expect(result.runs[2].exitOverlays.map((overlay) => overlay.label)).toEqual(["EMA 2", "EMA 3"]);
    expect(result.runs[3].exitOverlays.map((overlay) => overlay.label)).toEqual([
      "EMA 40",
      "EMA 80",
    ]);
    expect(result.runs[2].exitOverlays).not.toEqual(result.runs[3].exitOverlays);
  });

  it("fills every recorded signal at the next bar open", () => {
    const result = runResearchComparison(createReferenceResearchStrategy("NASDAQ:NVDA"));
    const timestamps = getIntradayFixture("NASDAQ:NVDA").candles.map((candle) => candle.date);
    for (const run of result.runs) {
      for (const trade of run.trades) {
        expect(timestamps.indexOf(trade.entryAt)).toBe(timestamps.indexOf(trade.entrySignalAt) + 1);
        if (trade.exitAt && trade.exitSignalAt) {
          expect(timestamps.indexOf(trade.exitAt)).toBe(timestamps.indexOf(trade.exitSignalAt) + 1);
        }
      }
    }
  });

  it("reports exit-quality metrics including profit factor, holding, MFE and MAE", () => {
    const result = runResearchComparison(createReferenceResearchStrategy("NASDAQ:NVDA"));
    for (const run of result.runs) {
      expect(run.metrics).toEqual(
        expect.objectContaining({
          totalReturnPercent: expect.any(Number),
          maxDrawdownPercent: expect.any(Number),
          sharpeRatio: expect.any(Number),
          profitFactor: expect.toSatisfy(
            (value: unknown) => value === null || (typeof value === "number" && value >= 0),
          ),
          averageHoldingMinutes: expect.any(Number),
          averageMfePercent: expect.any(Number),
          averageMaePercent: expect.any(Number),
        }),
      );
    }
  });

  it("uses each exit parameter instead of silently falling back to defaults", () => {
    const base = createReferenceResearchStrategy("NASDAQ:NVDA");
    const variants = [
      [{ kind: "atr_trailing", period: 2, multiplier: 1, initialMultiplier: 1 }],
      [{ kind: "atr_trailing", period: 60, multiplier: 5, initialMultiplier: 5 }],
      [{ kind: "ema_cross_below", fastPeriod: 2, slowPeriod: 3 }],
      [{ kind: "ema_cross_below", fastPeriod: 40, slowPeriod: 80 }],
      [{ kind: "vwap_confirm_below", sessionLookback: 2, confirmationBars: 1 }],
      [{ kind: "vwap_confirm_below", sessionLookback: 30, confirmationBars: 8 }],
      [{ kind: "ichimoku_kijun_cross_below", period: 9 }],
      [{ kind: "ichimoku_kijun_cross_below", period: 60 }],
      [{ kind: "chandelier", period: 2, multiplier: 1, initialMultiplier: 1 }],
      [{ kind: "chandelier", period: 60, multiplier: 5, initialMultiplier: 5 }],
    ] as const;
    const fingerprints = variants.map((exits) => {
      const run = runResearchComparison({ ...base, exits: [...exits] }).runs[0];
      return JSON.stringify({ metrics: run.metrics, trades: run.trades });
    });
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
    expect(fingerprints[2]).not.toBe(fingerprints[3]);
    expect(fingerprints[4]).not.toBe(fingerprints[5]);
    expect(fingerprints[6]).not.toBe(fingerprints[7]);
    expect(fingerprints[8]).not.toBe(fingerprints[9]);
  });

  it("calculates profit factor from gross realized P&L", () => {
    const result = runResearchComparison(createReferenceResearchStrategy("NASDAQ:NVDA"));
    for (const run of result.runs) {
      const closed = run.trades.filter((trade) => trade.status === "CLOSED");
      expect(closed.every((trade) => typeof trade.pnl === "number")).toBe(true);
      if (run.metrics.grossLoss > 0) {
        expect(run.metrics.profitFactor).toBeCloseTo(
          run.metrics.grossProfit / run.metrics.grossLoss,
          3,
        );
      } else {
        expect(run.metrics.profitFactor).toBeNull();
      }
      expect(run.metrics.averageMfePercent).toBeGreaterThanOrEqual(0);
      expect(run.metrics.averageMaePercent).toBeLessThanOrEqual(0);
    }
  });

  it("separates KOSPI and NASDAQ sessions, holidays and provenance", () => {
    const kospi = getIntradayFixture("KOSPI:005930");
    const nasdaq = getIntradayFixture("NASDAQ:NVDA");
    expect(kospi.candles[0].date).toContain("T09:00:00");
    expect(nasdaq.candles[0].date).toContain("T09:30:00");
    expect(kospi.meta.calendar).not.toBe(nasdaq.meta.calendar);
    expect(kospi.meta.timeZone).toBe("Asia/Seoul");
    expect(nasdaq.meta.timeZone).toBe("America/New_York");
    expect(kospi.meta.version).toBe("2025-5m-v2");
  });
});
