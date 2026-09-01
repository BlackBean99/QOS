import { z } from "zod";

import { MarketSchema } from "@/src/domain/instruments";

export const TossTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.number().int().positive(),
  })
  .passthrough();

export const TossListedStockSchema = z
  .object({
    symbol: z.string().regex(/^[A-Za-z0-9.-]+$/),
    name: z.string().min(1),
    securityType: z.string().min(1),
    isCommonShare: z.boolean(),
    isinCode: z.string().min(1),
  })
  .passthrough();

export type TossListedStock = z.infer<typeof TossListedStockSchema>;

export const TossStockInfoSchema = z
  .object({
    symbol: z.string().regex(/^[A-Za-z0-9.-]+$/),
    name: z.string().min(1),
    englishName: z.string().nullish(),
    isinCode: z.string().min(1),
    market: MarketSchema,
    securityType: z.string().min(1),
    isCommonShare: z.boolean(),
    status: z.string().min(1),
    currency: z.string().min(1),
  })
  .passthrough();

export type TossStockInfo = z.infer<typeof TossStockInfoSchema>;

const DecimalSchema = z.string().refine((value) => Number.isFinite(Number(value)), {
  message: "유한한 decimal 문자열이어야 합니다.",
});

export const TossCandleSchema = z
  .object({
    timestamp: z.iso.datetime({ offset: true }),
    openPrice: DecimalSchema,
    highPrice: DecimalSchema,
    lowPrice: DecimalSchema,
    closePrice: DecimalSchema,
    volume: DecimalSchema,
    currency: z.string().min(1),
  })
  .passthrough();

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  currency: string;
}

export const CandleIntervalSchema = z.enum(["1m", "1d"]);
export type CandleInterval = z.infer<typeof CandleIntervalSchema>;

export const TossTradeMessageSchema = z
  .object({
    type: z.literal("message"),
    topic: z.string().regex(/^trade:(?:kr|us):[A-Z0-9.-]+$/),
    data: z
      .object({
        price: DecimalSchema,
        volume: DecimalSchema,
        timestamp: z.iso.datetime({ offset: true }),
        currency: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();
