import { describe, expect, it } from "vitest";

import { runBacktest } from "@/src/domain/backtest";
import type { Strategy } from "@/src/domain/strategy";
import { getInstrumentFixture } from "@/src/fixtures/markets";

const strategy: Strategy = {
  version: 1,
  name: "NASDAQ Breakout 20",
  market: "NASDAQ",
  instrumentId: "NASDAQ:AAPL",
  timeframe: "1d",
  entry: {
    price: { kind: "rolling_high_breakout", period: 20 },
    volume: { kind: "volume_ratio_above", period: 20, ratio: 2 },
  },
  exit: { kind: "trailing_stop", percent: 5 },
  assumptions: {
    signalAt: "session_close",
    fillAt: "next_session_open",
    positionSizing: "all_in_single_asset",
  },
};

describe("runBacktest", () => {
  it("is deterministic for the same strategy and fixture", () => {
    const first = runBacktest(strategy);
    const second = runBacktest(strategy);

    expect(second).toEqual(first);
    expect(first.equityCurve.length).toBeGreaterThan(20);
    expect(first.priceSeries).toHaveLength(first.equityCurve.length);
    expect(first.market.instrumentId).toBe(strategy.instrumentId);
  });

  it("fills an entry on the session after its signal", () => {
    const result = runBacktest(strategy);
    const firstTrade = result.trades[0];

    expect(firstTrade).toBeDefined();
    expect(firstTrade.entryDate).not.toBe(firstTrade.signalDate);
    expect(new Date(firstTrade.entryDate).getTime()).toBeGreaterThan(
      new Date(firstTrade.signalDate).getTime(),
    );
    expect(firstTrade.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("20-session high")]),
    );
  });

  it("records the trailing-stop decision and next-session exit fill", () => {
    const result = runBacktest(strategy);
    const firstTrade = result.trades[0];

    expect(firstTrade.exitReason).toMatchObject({
      signalDate: firstTrade.exitSignalDate,
      fillDate: firstTrade.exitDate,
      fillPrice: firstTrade.exitPrice,
    });
    expect(firstTrade.exitReason?.signalClose).toBeLessThanOrEqual(
      firstTrade.exitReason?.stopPrice ?? Number.NEGATIVE_INFINITY,
    );
    expect(new Date(firstTrade.exitReason?.fillDate ?? 0).getTime()).toBeGreaterThan(
      new Date(firstTrade.exitReason?.signalDate ?? 0).getTime(),
    );
  });

  it("applies commission and slippage to fills", () => {
    const result = runBacktest(strategy);
    const fixture = getInstrumentFixture("NASDAQ:AAPL");
    const firstTrade = result.trades[0];
    const rawOpen = fixture.candles.find((candle) => candle.date === firstTrade.entryDate)?.open;

    expect(rawOpen).toBeDefined();
    expect(firstTrade.entryPrice).toBeGreaterThan(rawOpen ?? Number.POSITIVE_INFINITY);
    expect(firstTrade.entryPrice).toBeCloseTo((rawOpen ?? 0) * 1.0005, 4);
    expect(firstTrade.entryFee).toBeGreaterThan(0);
  });

  it("locks the independently reviewed fixture metrics", () => {
    const result = runBacktest(strategy);

    expect(result.metrics).toMatchObject({
      totalReturnPercent: -10.6488,
      maxDrawdownPercent: -14.3251,
      sharpeRatio: -3.4126,
      winRatePercent: 0,
      closedTrades: 3,
      benchmarkReturnPercent: 23,
    });
  });

  it("reconciles closed trade profit and loss exactly to ending cash", () => {
    const result = runBacktest(strategy);
    const totalPnl = result.trades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);

    expect(result.trades.every((trade) => trade.status === "CLOSED")).toBe(true);
    expect(result.metrics.initialCapital + totalPnl).toBeCloseTo(result.metrics.endingEquity, 8);
  });

  it("keeps KOSPI and NASDAQ market assumptions separate", () => {
    const nasdaq = getInstrumentFixture("NASDAQ:AAPL");
    const kospi = getInstrumentFixture("KOSPI:005930");

    expect(nasdaq.meta.currency).toBe("USD");
    expect(kospi.meta.currency).toBe("KRW");
    expect(nasdaq.meta.timeZone).not.toBe(kospi.meta.timeZone);
    expect(nasdaq.meta.calendar).not.toBe(kospi.meta.calendar);
  });

  it("runs the KOSPI fixture under its own market contract", () => {
    const result = runBacktest({
      ...strategy,
      name: "005930 Breakout 20",
      market: "KOSPI",
      instrumentId: "KOSPI:005930",
    });

    expect(result.market).toMatchObject({
      market: "KOSPI",
      instrumentId: "KOSPI:005930",
      symbol: "005930",
      currency: "KRW",
      timeZone: "Asia/Seoul",
    });
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.metrics.initialCapital).toBe(10_000_000);
  });

  it("returns a valid zero-trade result when no signal can warm up", () => {
    const noSignalStrategy: Strategy = {
      ...strategy,
      entry: {
        price: { kind: "rolling_high_breakout", period: 60 },
        volume: { kind: "volume_ratio_above", period: 60, ratio: 5 },
      },
    };

    const result = runBacktest(noSignalStrategy);
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.totalReturnPercent).toBe(0);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("No trades")]));
  });

  it("marks a final open position without pretending it was liquidated", () => {
    const result = runBacktest({ ...strategy, exit: { kind: "trailing_stop", percent: 30 } });

    expect(result.trades).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "OPEN" })]),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("final position remains open")]),
    );
  });

  it("keeps chart price points and trade fills on the selected instrument", () => {
    const result = runBacktest(strategy);
    const dates = new Set(result.priceSeries.map((point) => point.date));

    expect(result.priceSeries[0]).toMatchObject({ date: expect.any(String), close: 180 });
    expect(result.trades.every((trade) => trade.symbol === "AAPL")).toBe(true);
    expect(result.trades.every((trade) => dates.has(trade.entryDate))).toBe(true);
    expect(
      result.trades.every((trade) => trade.exitDate === undefined || dates.has(trade.exitDate)),
    ).toBe(true);
  });
});
