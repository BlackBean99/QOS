import { describe, expect, it } from "vitest";

import { evaluateCompletedBarSignal } from "@/src/monitor/signal-evaluator";
import { getInstrumentFixture } from "@/src/fixtures/markets";
import type { NewStoredStrategy } from "@/src/domain/stored-strategy";
import { createPresetStrategyV3 } from "@/src/domain/strategy-v3/catalog";

const document: NewStoredStrategy = {
  name: "AAPL breakout",
  description: "",
  instrument: {
    instrumentId: "NASDAQ:AAPL",
    market: "NASDAQ",
    symbol: "AAPL",
    displayName: "Apple",
    currency: "USD",
    timezone: "America/New_York",
    synthetic: false,
    securityType: "STOCK",
    isinCode: "US0378331005",
  },
  strategy: {
    version: 1,
    name: "AAPL Breakout 20",
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
  },
  chart: {
    version: 1,
    period: "1d",
    theme: "upbit-light",
    mainIndicators: ["MA"],
    subIndicators: ["VOL"],
    drawings: [],
    visibleRange: null,
  },
  monitor: { enabled: true, interval: "1d" },
};

describe("completed bar signal evaluator", () => {
  it("materializes a latest-bar BUY without using a future market candle", () => {
    const fixture = getInstrumentFixture("NASDAQ:AAPL");
    const signalBarIndex = 20;
    const truncated = { ...fixture, candles: fixture.candles.slice(0, signalBarIndex + 1) };

    const signal = evaluateCompletedBarSignal(document, truncated);

    expect(signal).toMatchObject({
      side: "BUY",
      barTimestamp: fixture.candles[signalBarIndex].date,
      instrumentId: "NASDAQ:AAPL",
    });
  });

  it("returns null when the latest completed bar has no new signal", () => {
    const fixture = getInstrumentFixture("NASDAQ:AAPL");
    expect(
      evaluateCompletedBarSignal(document, { ...fixture, candles: fixture.candles.slice(0, 20) }),
    ).toBeNull();
  });

  it("evaluates a Strategy v3 rule chain on the latest completed bar without treating end-of-data as SELL", () => {
    const fixture = getInstrumentFixture("NASDAQ:AAPL");
    const candles = fixture.candles.slice(0, 8).map((candle, index) => ({
      ...candle,
      close: index === 7 ? 101 : 99,
      open: 99,
      high: index === 7 ? 102 : 100,
      low: 98,
    }));
    const v3: NewStoredStrategy = {
      ...document,
      name: "AAPL v3",
      strategy: {
        version: 3,
        name: "AAPL price cross v3",
        market: "NASDAQ",
        instrumentId: "NASDAQ:AAPL",
        timeframe: "1d",
        side: "LONG",
        entry: {
          type: "GROUP",
          id: "entry",
          operator: "AND",
          children: [
            {
              type: "CONDITION",
              id: "cross",
              left: {
                type: "INDICATOR",
                timeframe: "1d",
                offset: 0,
                kind: "PRICE",
                field: "close",
              },
              operator: "CROSS_ABOVE",
              right: { type: "CONSTANT", value: 100 },
            },
          ],
        },
        filters: { type: "GROUP", id: "filters", operator: "AND", children: [] },
        exits: [
          {
            kind: "FIXED_STOP",
            id: "stop",
            priority: 10,
            unit: "PERCENT",
            value: 5,
            quantityPercent: 100,
          },
        ],
        positionSizing: { kind: "EQUITY_PERCENT", value: 10 },
        risk: { maximumPositions: 1, maximumSymbolAllocationPercent: 100 },
        execution: {
          signalAt: "BAR_CLOSE",
          fillAt: "NEXT_BAR_OPEN",
          order: { type: "MARKET" },
          intrabarPolicy: "CONSERVATIVE",
          commissionBps: 1,
          slippageBps: 2,
          spreadBps: 1,
          minimumTick: 0.01,
          startingCapital: 100_000,
        },
        overlays: [],
      },
    };

    expect(evaluateCompletedBarSignal(v3, { ...fixture, candles })).toMatchObject({
      side: "BUY",
      barTimestamp: candles[7].date,
    });
    expect(evaluateCompletedBarSignal(v3, { ...fixture, candles })?.reason).toContain("cross");
  });

  it("detects completed 15-minute open crosses above and below Session VWAP", () => {
    const fixture = getInstrumentFixture("NASDAQ:AAPL");
    const entry = createPresetStrategyV3("session-vwap-open-cross", "NASDAQ:AAPL", {
      timeframe: "15m",
    });
    const exit = createPresetStrategyV3("session-vwap-open-breakdown-exit", "NASDAQ:AAPL", {
      timeframe: "15m",
    });
    const strategy = { ...entry, exits: exit.exits };
    const base = Date.parse("2026-09-11T13:30:00.000Z");
    const candles = Array.from({ length: 17 }, (_, index) => {
      const breakout = index === 14 || index === 15;
      const breakdown = index === 16;
      return {
        date: new Date(base + index * 15 * 60_000).toISOString(),
        open: breakout ? 102 : breakdown ? 98 : 99,
        high: breakout ? 102 : 101,
        low: breakout ? 98 : breakdown ? 97 : 99,
        close: breakout ? 98 : breakdown ? 99 : 100,
        volume: 1_000,
      };
    });
    const v3: NewStoredStrategy = {
      ...document,
      name: "15m VWAP open cross",
      strategy,
      monitor: { enabled: true, interval: "15m" },
    };

    expect(
      evaluateCompletedBarSignal(v3, {
        ...fixture,
        candles: candles.slice(0, 15),
      }),
    ).toMatchObject({ side: "BUY", barTimestamp: candles[14].date });
    expect(evaluateCompletedBarSignal(v3, { ...fixture, candles })).toMatchObject({
      side: "SELL",
      barTimestamp: candles[16].date,
    });

    const changedFuture = [
      ...candles.slice(0, 15),
      { ...candles[15], open: 1_000, high: 1_001, low: 999, close: 1_000 },
    ];
    expect(
      evaluateCompletedBarSignal(v3, { ...fixture, candles: changedFuture }),
    ).not.toMatchObject({ barTimestamp: candles[14].date });
  });
});
