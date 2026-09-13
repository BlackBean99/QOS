import { describe, expect, it } from "vitest";

import type { Candle } from "@/src/fixtures/markets";
import { runBacktestV3, compareBacktestsV3 } from "@/src/domain/backtest-v3/engine";
import {
  StrategyDefinitionV3Schema,
  type StrategyDefinitionV3,
} from "@/src/domain/strategy-v3/schema";

const candles: Candle[] = [
  { date: "2026-01-02T14:30:00.000Z", open: 99, high: 100, low: 98, close: 99, volume: 100 },
  { date: "2026-01-02T14:35:00.000Z", open: 99, high: 102, low: 98, close: 101, volume: 200 },
  { date: "2026-01-02T14:40:00.000Z", open: 100, high: 106, low: 94, close: 103, volume: 300 },
  { date: "2026-01-02T14:45:00.000Z", open: 104, high: 111, low: 103, close: 110, volume: 250 },
  { date: "2026-01-02T14:50:00.000Z", open: 109, high: 110, low: 106, close: 107, volume: 180 },
];

function strategy(
  intrabarPolicy: StrategyDefinitionV3["execution"]["intrabarPolicy"] = "CONSERVATIVE",
): StrategyDefinitionV3 {
  return StrategyDefinitionV3Schema.parse({
    version: 3,
    name: "Engine deterministic strategy",
    market: "NASDAQ",
    instrumentId: "NASDAQ:NVDA",
    timeframe: "5m",
    side: "LONG",
    entry: {
      type: "GROUP",
      id: "entry",
      operator: "AND",
      children: [
        {
          type: "CONDITION",
          id: "cross",
          left: { type: "INDICATOR", timeframe: "5m", offset: 0, kind: "PRICE", field: "close" },
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
        unit: "ABSOLUTE",
        value: 5,
        quantityPercent: 100,
      },
      {
        kind: "FIXED_TAKE_PROFIT",
        id: "target",
        priority: 30,
        unit: "ABSOLUTE",
        value: 5,
        quantityPercent: 100,
      },
    ],
    positionSizing: { kind: "FIXED_NOTIONAL", value: 1_000 },
    risk: { maximumPositions: 1, maximumSymbolAllocationPercent: 100 },
    execution: {
      signalAt: "BAR_CLOSE",
      fillAt: "NEXT_BAR_OPEN",
      order: { type: "MARKET" },
      intrabarPolicy,
      commissionBps: 0,
      slippageBps: 0,
      spreadBps: 0,
      minimumTick: 0.01,
      startingCapital: 10_000,
    },
    overlays: [],
  });
}

const runtime = {
  marketTimeZone: "America/New_York",
  sessionOpen: "09:30",
  sessionClose: "16:00",
  source: "deterministic-fixture",
  adjustedPrices: true,
};

describe("Strategy v3 backtest engine", () => {
  it("confirms at T close and fills at T+1 open", () => {
    const result = runBacktestV3(strategy(), candles, runtime);
    expect(result.trades[0]).toMatchObject({
      entrySignalAt: candles[1].date,
      entryAt: candles[2].date,
      entryPrice: 100,
    });
    expect(result.assumptions).toContain(
      "Signal is confirmed at bar close and market entry fills at the next bar open.",
    );
  });

  it("uses conservative stop-first handling when TP and SL touch the same OHLC candle", () => {
    const conservative = runBacktestV3(strategy("CONSERVATIVE"), candles, runtime);
    const optimistic = runBacktestV3(strategy("OPTIMISTIC"), candles, runtime);
    expect(conservative.trades[0].exitReason).toBe("stop");
    expect(conservative.trades[0].exitPrice).toBe(95);
    expect(optimistic.trades[0].exitReason).toBe("target");
    expect(optimistic.trades[0].exitPrice).toBe(105);
  });

  it("records partial fills, reasons, costs, MFE/MAE and decision traces", () => {
    const custom = strategy();
    custom.exits = [
      {
        kind: "FIXED_STOP",
        id: "stop",
        priority: 10,
        unit: "ABSOLUTE",
        value: 20,
        quantityPercent: 100,
      },
      {
        kind: "SCALE_OUT",
        id: "scale",
        priority: 30,
        levels: [
          { id: "tp-one", trigger: { kind: "PERCENT", value: 5 }, quantityPercent: 50 },
          { id: "tp-two", trigger: { kind: "PERCENT", value: 10 }, quantityPercent: 50 },
        ],
      },
    ];
    const result = runBacktestV3(custom, candles, runtime);
    expect(result.trades[0].fills.map((fill) => fill.reason)).toEqual(["tp-one", "tp-two"]);
    expect(result.trades[0].entryTrace.passed).toBe(true);
    expect(result.trades[0].mfePercent).toBeGreaterThan(0);
    expect(result.metrics.numberOfTrades).toBe(1);
    expect(result.metrics.commissionCost).toBe(0);
  });

  it("reconciles raw-price gross PnL, commission and slippage with net PnL", () => {
    const costed = strategy();
    costed.execution.commissionBps = 10;
    costed.execution.slippageBps = 10;
    costed.execution.spreadBps = 10;

    const result = runBacktestV3(costed, candles, runtime);
    const trade = result.trades[0];

    expect(trade.entryRawPrice).toBe(100);
    expect(trade.grossPnl - trade.fee - trade.slippageCost).toBeCloseTo(trade.netPnl, 6);
    expect(
      result.metrics.startingCapital + result.trades.reduce((sum, item) => sum + item.netPnl, 0),
    ).toBeCloseTo(result.metrics.endingEquity, 3);
    expect(trade.fills.reduce((sum, fill) => sum + fill.netPnl, 0)).toBeCloseTo(trade.netPnl, 4);
  });

  it("records signal-to-fill events and explains why no trade happened", () => {
    const traded = runBacktestV3(strategy(), candles, runtime);
    expect(traded.events.map((event) => event.type)).toEqual([
      "ENTRY_SIGNAL",
      "ENTRY_FILL",
      "EXIT_FILL",
    ]);
    expect(traded.diagnostics).toMatchObject({
      combinedSignals: 1,
      entryFills: 1,
      exitFills: 1,
      closedTrades: 1,
      noTradeReason: null,
    });

    const never = strategy();
    never.entry.children[0] = {
      type: "CONDITION",
      id: "never",
      left: { type: "INDICATOR", timeframe: "5m", offset: 0, kind: "PRICE", field: "close" },
      operator: "CROSS_ABOVE",
      right: { type: "CONSTANT", value: 10_000 },
    };
    const empty = runBacktestV3(never, candles, runtime);
    expect(empty.metrics.numberOfTrades).toBe(0);
    expect(empty.diagnostics).toMatchObject({
      evaluatedBars: candles.length,
      entryPasses: 0,
      combinedSignals: 0,
      entryFills: 0,
      warmupBars: 1,
      noTradeReason: "NO_ENTRY_MATCH",
    });
    expect(empty.diagnostics.conditionStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "ENTRY", ruleId: "never", warmup: 1, passed: 0 }),
      ]),
    );
  });

  it("records same-bar-close position-size and non-market fill rejections", () => {
    const zeroQuantity = strategy();
    zeroQuantity.execution.fillAt = "SAME_BAR_CLOSE";
    zeroQuantity.positionSizing = { kind: "FIXED_NOTIONAL", value: 1 };
    const sizedOut = runBacktestV3(zeroQuantity, candles, runtime);

    expect(sizedOut.trades).toHaveLength(0);
    expect(sizedOut.diagnostics.noTradeReason).toBe("POSITION_SIZE_ZERO");
    expect(sizedOut.events.map((event) => event.type)).toEqual(["ENTRY_SIGNAL", "ENTRY_REJECTED"]);

    const untouchedLimit = strategy();
    untouchedLimit.execution.fillAt = "SAME_BAR_CLOSE";
    untouchedLimit.execution.order = { type: "LIMIT", offsetUnit: "PERCENT", offset: 10 };
    const notFilled = runBacktestV3(untouchedLimit, candles, runtime);

    expect(notFilled.trades).toHaveLength(0);
    expect(notFilled.diagnostics.noTradeReason).toBe("ORDER_NOT_FILLED");
    expect(notFilled.rejectedSignals[0]?.reason).toBe("ENTRY_ORDER_NOT_FILLED");
  });

  it("compares the same entry with independent exits", () => {
    const first = strategy();
    const second = strategy("OPTIMISTIC");
    second.name = "Alternative exit";
    second.exits = [
      { kind: "TIME", id: "time", priority: 70, mode: "BARS", value: 1, quantityPercent: 100 },
    ];
    const comparison = compareBacktestsV3([first, second], candles, runtime);
    expect(comparison.runs).toHaveLength(2);
    expect(comparison.runs.map((run) => run.strategyName)).toEqual([first.name, second.name]);
  });

  it("keeps a deterministic golden signals → fills → trade → metrics projection", () => {
    const result = runBacktestV3(strategy(), candles, runtime);
    expect({
      trades: result.trades.map((trade) => ({
        signal: trade.entrySignalAt,
        entry: [trade.entryAt, trade.entryPrice, trade.positionSize],
        exit: [trade.exitAt, trade.exitPrice, trade.exitReason],
        pnl: trade.netPnl,
      })),
      metrics: {
        return: result.metrics.totalReturnPercent,
        drawdown: result.metrics.maximumDrawdownPercent,
        trades: result.metrics.numberOfTrades,
        ending: result.metrics.endingEquity,
      },
    }).toMatchInlineSnapshot(`
      {
        "metrics": {
          "drawdown": 0.5,
          "ending": 9950,
          "return": -0.5,
          "trades": 1,
        },
        "trades": [
          {
            "entry": [
              "2026-01-02T14:40:00.000Z",
              100,
              10,
            ],
            "exit": [
              "2026-01-02T14:40:00.000Z",
              95,
              "stop",
            ],
            "pnl": -50,
            "signal": "2026-01-02T14:35:00.000Z",
          },
        ],
      }
    `);
  });
});
