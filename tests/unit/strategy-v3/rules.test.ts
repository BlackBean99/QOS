import { describe, expect, it } from "vitest";

import type { Candle } from "@/src/fixtures/markets";
import { evaluateRule } from "@/src/domain/strategy-runtime/rules";
import { IndicatorRegistry } from "@/src/domain/strategy-runtime/indicators";
import type { RuleGroup } from "@/src/domain/strategy-v3/schema";

const candles: Candle[] = [
  { date: "2026-01-02T14:30:00.000Z", open: 10, high: 11, low: 9, close: 10, volume: 100 },
  { date: "2026-01-02T14:35:00.000Z", open: 10, high: 13, low: 9.5, close: 12, volume: 200 },
  { date: "2026-01-02T14:40:00.000Z", open: 12, high: 12.5, low: 10.5, close: 11, volume: 150 },
];

const registry = new IndicatorRegistry(candles, {
  primaryTimeframe: "5m",
  marketTimeZone: "America/New_York",
  sessionOpen: "09:30",
  sessionClose: "16:00",
});

const price = {
  type: "INDICATOR" as const,
  timeframe: "5m" as const,
  offset: 0,
  kind: "PRICE" as const,
  field: "close" as const,
};

const volume = {
  type: "INDICATOR" as const,
  timeframe: "5m" as const,
  offset: 0,
  kind: "VOLUME" as const,
};

describe("Strategy v3 rule evaluator", () => {
  it("supports nested AND, OR and NOT with a full decision trace", () => {
    const rule: RuleGroup = {
      type: "GROUP",
      id: "root",
      operator: "AND",
      children: [
        {
          type: "CONDITION",
          id: "cross",
          left: price,
          operator: "CROSS_ABOVE",
          right: { type: "CONSTANT", value: 11 },
        },
        {
          type: "GROUP",
          id: "or",
          operator: "OR",
          children: [
            {
              type: "CONDITION",
              id: "volume",
              left: volume,
              operator: "GT",
              right: { type: "CONSTANT", value: 150 },
            },
            {
              type: "GROUP",
              id: "not",
              operator: "NOT",
              children: [
                {
                  type: "CONDITION",
                  id: "below",
                  left: price,
                  operator: "LT",
                  right: { type: "CONSTANT", value: 8 },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = evaluateRule(rule, 1, registry, candles);
    expect(result.passed).toBe(true);
    expect(result.trace.children).toHaveLength(2);
    expect(result.trace.children[0]).toMatchObject({
      id: "cross",
      passed: true,
      current: { left: 12, right: 11 },
      previous: { left: 10, right: 11 },
    });
  });

  it.each([
    ["GT", 12, 11, true],
    ["GTE", 12, 12, true],
    ["LT", 12, 13, true],
    ["LTE", 12, 12, true],
    ["EQ", 12, 12, true],
    ["BETWEEN", 12, undefined, true],
    ["TOUCH", 12, 12.05, true],
    ["BREAK_ABOVE", 12, 11, true],
    ["BREAK_BELOW", 11, 11.5, true],
  ] as const)("evaluates %s", (operator, left, right, expected) => {
    const customCandles = candles.map((candle, index) => ({
      ...candle,
      close: index === 1 ? left : operator === "BREAK_BELOW" && index === 0 ? 12 : candle.close,
    }));
    const customRegistry = new IndicatorRegistry(customCandles, {
      primaryTimeframe: "5m",
      marketTimeZone: "America/New_York",
      sessionOpen: "09:30",
      sessionClose: "16:00",
    });
    const rule: RuleGroup = {
      type: "GROUP",
      id: "root",
      operator: "AND",
      children: [
        {
          type: "CONDITION",
          id: "test",
          left: price,
          operator,
          ...(operator === "BETWEEN"
            ? {
                range: {
                  lower: { type: "CONSTANT", value: 11 },
                  upper: { type: "CONSTANT", value: 13 },
                },
              }
            : { right: { type: "CONSTANT", value: right! } }),
          ...(operator === "TOUCH" ? { tolerance: 0.1 } : {}),
        },
      ],
    };
    expect(evaluateRule(rule, 1, customRegistry, customCandles).passed).toBe(expected);
  });

  it("returns false, not an accidental signal, during indicator warm-up", () => {
    const rule: RuleGroup = {
      type: "GROUP",
      id: "root",
      operator: "AND",
      children: [
        {
          type: "CONDITION",
          id: "warmup",
          left: { type: "INDICATOR", timeframe: "5m", offset: 0, kind: "EMA", period: 20 },
          operator: "GT",
          right: { type: "CONSTANT", value: 0 },
        },
      ],
    };
    const result = evaluateRule(rule, 1, registry, candles);
    expect(result.passed).toBe(false);
    expect(result.trace.children[0]).toMatchObject({ status: "WARM_UP", passed: false });
  });
});
