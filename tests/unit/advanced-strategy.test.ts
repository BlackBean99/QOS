import { describe, expect, it } from "vitest";

import { ResearchStrategySchema } from "@/src/domain/advanced-strategy";

const reference = {
  version: 2,
  name: "NVDA 15-session VWAP exit comparison",
  market: "NASDAQ",
  instrumentId: "NASDAQ:NVDA",
  timeframe: "5m",
  entry: { kind: "vwap_cross_above", sessionLookback: 15 },
  exits: [
    { kind: "ichimoku_kijun_cross_below", period: 26 },
    { kind: "vwap_confirm_below", sessionLookback: 15, confirmationBars: 1 },
    { kind: "vwap_confirm_below", sessionLookback: 15, confirmationBars: 3 },
    { kind: "atr_trailing", period: 14, multiplier: 2, initialMultiplier: 1.5 },
    { kind: "atr_trailing", period: 14, multiplier: 3, initialMultiplier: 1.5 },
    { kind: "chandelier", period: 22, multiplier: 3, initialMultiplier: 1.5 },
    { kind: "ema_cross_below", fastPeriod: 9, slowPeriod: 21 },
    { kind: "fixed_trailing", percent: 2 },
  ],
  overlays: ["VWAP", "ICHIMOKU", "EMA", "STOCH_RSI"],
  assumptions: {
    signalAt: "bar_close",
    fillAt: "next_bar_open",
    positionSizing: "all_in_single_asset",
  },
} as const;

describe("Strategy v2", () => {
  it("accepts the supplied VWAP/exit-comparison strategy", () => {
    expect(ResearchStrategySchema.parse(reference).exits).toHaveLength(8);
  });

  it("rejects unknown model fields and market mismatch", () => {
    expect(() => ResearchStrategySchema.parse({ ...reference, code: "eval(prompt)" })).toThrow();
    expect(() =>
      ResearchStrategySchema.parse({ ...reference, instrumentId: "KOSPI:005930" }),
    ).toThrow();
  });

  it("allows parameter comparisons but rejects an identical duplicate", () => {
    expect(() =>
      ResearchStrategySchema.parse({
        ...reference,
        exits: [
          { kind: "fixed_trailing", percent: 2 },
          { kind: "fixed_trailing", percent: 3 },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      ResearchStrategySchema.parse({
        ...reference,
        exits: [
          { kind: "fixed_trailing", percent: 2 },
          { kind: "fixed_trailing", percent: 2 },
        ],
      }),
    ).toThrow();
  });

  it("accepts composable RSI, EMA and MACD entry filters", () => {
    const parsed = ResearchStrategySchema.parse({
      ...reference,
      entry: {
        kind: "vwap_cross_above",
        sessionLookback: 15,
        filterLogic: "all",
        filters: [
          { kind: "rsi_below", period: 14, value: 70 },
          { kind: "ema_cross_above", fastPeriod: 9, slowPeriod: 21 },
          { kind: "macd_cross_above", fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        ],
      },
    });
    expect(parsed.entry.filters).toHaveLength(3);
  });
});
