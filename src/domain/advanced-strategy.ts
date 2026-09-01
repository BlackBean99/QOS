import { z } from "zod";

import {
  InstrumentIdSchema,
  MarketSchema,
  getInstrumentDefinition,
  instrumentMatchesMarket,
  type InstrumentId,
  type InstrumentSummary,
} from "./instruments";
import { ChartIndicatorSchema, IndicatorSourceSchema } from "./chart-indicators";

const PeriodSchema = z.number().int().min(2).max(100);

export const ResearchEntryFilterSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("rsi_above"),
      period: PeriodSchema,
      value: z.number().min(0).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rsi_below"),
      period: PeriodSchema,
      value: z.number().min(0).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ema_cross_above"),
      fastPeriod: PeriodSchema,
      slowPeriod: PeriodSchema,
    })
    .strict()
    .refine(
      (rule) => rule.fastPeriod < rule.slowPeriod,
      "빠른 EMA 기간은 느린 EMA 기간보다 짧아야 합니다.",
    ),
  z
    .object({
      kind: z.literal("macd_cross_above"),
      fastPeriod: PeriodSchema,
      slowPeriod: PeriodSchema,
      signalPeriod: PeriodSchema,
    })
    .strict()
    .refine(
      (rule) => rule.fastPeriod < rule.slowPeriod,
      "MACD 빠른 기간은 느린 기간보다 짧아야 합니다.",
    ),
  z
    .object({
      kind: z.literal("macd_cross_below"),
      fastPeriod: PeriodSchema,
      slowPeriod: PeriodSchema,
      signalPeriod: PeriodSchema,
    })
    .strict()
    .refine(
      (rule) => rule.fastPeriod < rule.slowPeriod,
      "MACD 빠른 기간은 느린 기간보다 짧아야 합니다.",
    ),
  z
    .object({
      kind: z.enum([
        "indicator_above",
        "indicator_below",
        "indicator_cross_above",
        "indicator_cross_below",
      ]),
      indicator: ChartIndicatorSchema,
      params: z.array(z.number().finite().positive().max(100_000)).max(12),
      source: IndicatorSourceSchema,
      value: z.number().finite(),
    })
    .strict(),
]);
export type ResearchEntryFilter = z.infer<typeof ResearchEntryFilterSchema>;

export const ResearchExitSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ichimoku_kijun_cross_below"),
      period: z.number().int().min(9).max(60),
    })
    .strict(),
  z
    .object({
      kind: z.literal("vwap_confirm_below"),
      sessionLookback: z.number().int().min(2).max(30),
      confirmationBars: z.number().int().min(1).max(12),
    })
    .strict(),
  z
    .object({
      kind: z.literal("atr_trailing"),
      period: PeriodSchema,
      multiplier: z.number().min(0.5).max(6),
      initialMultiplier: z.number().min(0.5).max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chandelier"),
      period: PeriodSchema,
      multiplier: z.number().min(0.5).max(6),
      initialMultiplier: z.number().min(0.5).max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ema_cross_below"),
      fastPeriod: z.number().int().min(2).max(50),
      slowPeriod: z.number().int().min(3).max(100),
    })
    .strict()
    .refine((rule) => rule.fastPeriod < rule.slowPeriod, {
      message: "빠른 EMA 기간은 느린 EMA 기간보다 짧아야 합니다.",
    }),
  z
    .object({
      kind: z.literal("fixed_trailing"),
      percent: z.number().min(0.5).max(20),
    })
    .strict(),
]);

export const ResearchStrategySchema = z
  .object({
    version: z.literal(2),
    name: z.string().trim().min(3).max(120),
    market: MarketSchema,
    instrumentId: InstrumentIdSchema,
    timeframe: z.literal("5m"),
    entry: z
      .object({
        kind: z.literal("vwap_cross_above"),
        sessionLookback: z.number().int().min(2).max(30),
        filterLogic: z.enum(["all", "any"]).default("all"),
        filters: z.array(ResearchEntryFilterSchema).max(8).default([]),
      })
      .strict(),
    exits: z.array(ResearchExitSchema).min(1).max(12),
    overlays: z.array(z.enum(["VWAP", "EMA", "ICHIMOKU", "STOCH_RSI"])).max(4),
    assumptions: z
      .object({
        signalAt: z.literal("bar_close"),
        fillAt: z.literal("next_bar_open"),
        positionSizing: z.literal("all_in_single_asset"),
      })
      .strict(),
  })
  .strict()
  .superRefine((strategy, context) => {
    if (!instrumentMatchesMarket(strategy.instrumentId, strategy.market)) {
      context.addIssue({
        code: "custom",
        path: ["instrumentId"],
        message: "선택 종목과 전략 시장이 일치해야 합니다.",
      });
    }
    const exitConfigurations = strategy.exits.map((exit) => JSON.stringify(exit));
    if (new Set(exitConfigurations).size !== exitConfigurations.length) {
      context.addIssue({
        code: "custom",
        path: ["exits"],
        message: "완전히 같은 청산 설정은 한 번만 비교할 수 있습니다.",
      });
    }
  });

export type ResearchExit = z.infer<typeof ResearchExitSchema>;
export type ResearchStrategy = z.infer<typeof ResearchStrategySchema>;

export function createReferenceResearchStrategy(
  instrumentId: InstrumentId,
  selectedInstrument?: Pick<InstrumentSummary, "instrumentId" | "market" | "symbol">,
): ResearchStrategy {
  const instrument = selectedInstrument ?? getInstrumentDefinition(instrumentId);
  return ResearchStrategySchema.parse({
    version: 2,
    name: `${instrument.symbol} 15-session VWAP exit comparison`,
    market: instrument.market,
    instrumentId,
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
    overlays: ["VWAP", "EMA", "ICHIMOKU", "STOCH_RSI"],
    assumptions: {
      signalAt: "bar_close",
      fillAt: "next_bar_open",
      positionSizing: "all_in_single_asset",
    },
  });
}
