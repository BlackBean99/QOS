import { describe, expect, it } from "vitest";

import {
  StrategyDefinitionV3Schema,
  type ConditionRule,
  type StrategyDefinitionV3,
} from "@/src/domain/strategy-v3/schema";

function emaCondition(id: string, offset = 0): ConditionRule {
  return {
    type: "CONDITION",
    id,
    left: { type: "INDICATOR", kind: "EMA", timeframe: "1d", period: 20, offset },
    operator: "GT",
    right: { type: "INDICATOR", kind: "EMA", timeframe: "1d", period: 60, offset },
  };
}

function strategy(
  entryChildren: ConditionRule[] = [emaCondition("ema-trend")],
): StrategyDefinitionV3 {
  return {
    version: 3,
    name: "Rule chain contract",
    market: "NASDAQ",
    instrumentId: "NASDAQ:AAPL",
    timeframe: "5m",
    side: "LONG",
    entry: { type: "GROUP", id: "entry", operator: "AND", children: entryChildren },
    filters: {
      type: "GROUP",
      id: "filters",
      operator: "AND",
      children: [
        {
          type: "GROUP",
          id: "not-overheated",
          operator: "NOT",
          children: [
            {
              type: "CONDITION",
              id: "rsi-cap",
              left: {
                type: "INDICATOR",
                kind: "RSI",
                timeframe: "5m",
                period: 14,
                offset: 0,
              },
              operator: "GT",
              right: { type: "CONSTANT", value: 80 },
            },
          ],
        },
      ],
    },
    exits: [
      {
        kind: "ATR_STOP",
        id: "initial-stop",
        priority: 10,
        period: 14,
        multiplier: 2,
        quantityPercent: 100,
      },
      {
        kind: "SCALE_OUT",
        id: "scale-out",
        priority: 30,
        levels: [
          { id: "one-r", trigger: { kind: "R_MULTIPLE", value: 1 }, quantityPercent: 30 },
          { id: "two-r", trigger: { kind: "R_MULTIPLE", value: 2 }, quantityPercent: 30 },
        ],
      },
      {
        kind: "ATR_TRAILING",
        id: "runner",
        priority: 40,
        period: 14,
        multiplier: 2,
        quantityPercent: 100,
      },
    ],
    positionSizing: { kind: "RISK_PERCENT", value: 1 },
    risk: {
      maximumPositions: 1,
      maximumSymbolAllocationPercent: 100,
      maximumDailyLossPercent: 3,
      maximumStrategyDrawdownPercent: 20,
      maximumPortfolioDrawdownPercent: 20,
      consecutiveLossLimit: 5,
    },
    execution: {
      signalAt: "BAR_CLOSE",
      fillAt: "NEXT_BAR_OPEN",
      order: { type: "MARKET" },
      intrabarPolicy: "CONSERVATIVE",
      commissionBps: 1.5,
      slippageBps: 5,
      spreadBps: 2,
      minimumTick: 0.01,
      startingCapital: 100_000,
    },
    overlays: [],
  };
}

describe("Strategy v3 schema", () => {
  it("accepts a nested multi-timeframe rule chain and independent exit/risk layers", () => {
    expect(StrategyDefinitionV3Schema.parse(strategy())).toEqual(strategy());
  });

  it("accepts sixty-four entry leaves but rejects the sixty-fifth", () => {
    const allowed = Array.from({ length: 64 }, (_, index) => emaCondition(`ema-${index}`));
    const rejected = [...allowed, emaCondition("ema-64")];

    expect(StrategyDefinitionV3Schema.safeParse(strategy(allowed)).success).toBe(true);
    const result = StrategyDefinitionV3Schema.safeParse(strategy(rejected));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("64"))).toBe(true);
    }
  });

  it("rejects future offsets and malformed NOT groups", () => {
    const future = strategy([emaCondition("future", -1)]);
    expect(StrategyDefinitionV3Schema.safeParse(future).success).toBe(false);

    const invalidNot = strategy();
    invalidNot.filters = {
      type: "GROUP",
      id: "bad-not",
      operator: "NOT",
      children: [emaCondition("one"), emaCondition("two")],
    };
    expect(StrategyDefinitionV3Schema.safeParse(invalidNot).success).toBe(false);
  });

  it("keeps session and rolling-day VWAP structurally distinct", () => {
    const definition = strategy([
      {
        type: "CONDITION",
        id: "rolling-vwap",
        left: { type: "INDICATOR", kind: "PRICE", timeframe: "5m", field: "close", offset: 0 },
        operator: "CROSS_ABOVE",
        right: {
          type: "INDICATOR",
          kind: "VWAP",
          timeframe: "5m",
          variant: { kind: "ROLLING_DAYS", days: 15 },
          output: "VALUE",
          offset: 0,
        },
      },
    ]);
    expect(StrategyDefinitionV3Schema.parse(definition).entry).toEqual(definition.entry);

    const malformed = structuredClone(definition) as unknown as Record<string, unknown>;
    const entry = malformed.entry as { children: Array<{ right: Record<string, unknown> }> };
    entry.children[0].right.variant = { kind: "SESSION", days: 15 };
    expect(StrategyDefinitionV3Schema.safeParse(malformed).success).toBe(false);
  });

  it("rejects scale-out quantities above the initial position", () => {
    const definition = strategy();
    definition.exits = [
      {
        kind: "SCALE_OUT",
        id: "invalid-scale",
        priority: 30,
        levels: [
          { id: "first", trigger: { kind: "PERCENT", value: 5 }, quantityPercent: 60 },
          { id: "second", trigger: { kind: "PERCENT", value: 10 }, quantityPercent: 50 },
        ],
      },
    ];
    expect(StrategyDefinitionV3Schema.safeParse(definition).success).toBe(false);
  });

  it("rejects R-dependent exits when no initial risk stop exists", () => {
    const definition = strategy();
    definition.positionSizing = { kind: "EQUITY_PERCENT", value: 25 };
    definition.exits = [
      {
        kind: "RISK_REWARD",
        id: "orphan-r-target",
        priority: 30,
        multiple: 2,
        quantityPercent: 100,
      },
    ];

    const result = StrategyDefinitionV3Schema.safeParse(definition);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("R-based"))).toBe(true);
    }
  });
});
