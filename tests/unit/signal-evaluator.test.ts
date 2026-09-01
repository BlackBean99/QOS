import { describe, expect, it } from "vitest";

import { evaluateCompletedBarSignal } from "@/src/monitor/signal-evaluator";
import { getInstrumentFixture } from "@/src/fixtures/markets";
import type { NewStoredStrategy } from "@/src/domain/stored-strategy";

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
  });
});
