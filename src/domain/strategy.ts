import { z } from "zod";

import { InstrumentIdSchema, MarketSchema, instrumentMatchesMarket } from "./instruments";

export { MarketSchema } from "./instruments";
export type { InstrumentId, Market } from "./instruments";

const PeriodSchema = z.number().int().min(2).max(60);

export const StrategySchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(3).max(80),
    market: MarketSchema,
    instrumentId: InstrumentIdSchema,
    timeframe: z.literal("1d"),
    entry: z
      .object({
        price: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("rolling_high_breakout"), period: PeriodSchema }).strict(),
          z.object({ kind: z.literal("sma_cross_above"), period: PeriodSchema }).strict(),
        ]),
        volume: z
          .object({
            kind: z.literal("volume_ratio_above"),
            period: PeriodSchema,
            ratio: z.number().min(1).max(5),
          })
          .strict(),
      })
      .strict(),
    exit: z
      .object({
        kind: z.literal("trailing_stop"),
        percent: z.number().min(0.5).max(30),
      })
      .strict(),
    assumptions: z
      .object({
        signalAt: z.literal("session_close"),
        fillAt: z.literal("next_session_open"),
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
  });

export type Strategy = z.infer<typeof StrategySchema>;

export interface InterpretationIssue {
  field: "prompt" | "market" | "instrument" | "timeframe" | "entry" | "volume" | "exit";
  message: string;
}

export type InterpretationResult =
  | { ok: true; strategy: Strategy; warnings: string[] }
  | { ok: false; issues: InterpretationIssue[] };
