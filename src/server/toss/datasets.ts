import { aggregateFiveMinuteCandles } from "@/src/domain/market-candles";
import type { InstrumentSnapshotSchema } from "@/src/domain/stored-strategy";
import type { IntradayFixture } from "@/src/fixtures/intraday";
import type { MarketFixture } from "@/src/fixtures/markets";
import type { z } from "zod";
import type { StrategyTimeframe } from "@/src/domain/strategy-v3/schema";
import type { TossClient } from "./client";
import type { MarketCandle } from "./schemas";

type InstrumentSnapshot = z.infer<typeof InstrumentSnapshotSchema>;

interface LoadOptions {
  targetBars?: number;
  maxPages?: number;
}

interface ProviderRequestTelemetry {
  providerRequests: number;
}

async function loadPages(
  client: TossClient,
  symbol: string,
  interval: "1m" | "1d",
  targetCandles: number,
  maxPages: number,
): Promise<{ candles: MarketCandle[]; providerRequests: number }> {
  const candles = new Map<string, MarketCandle>();
  let before: string | undefined;
  let providerRequests = 0;
  for (let pageNumber = 0; pageNumber < maxPages && candles.size < targetCandles; pageNumber += 1) {
    const page = await client.getCandles({ symbol, interval, count: 200, before, adjusted: true });
    providerRequests += 1;
    for (const candle of page.candles) candles.set(candle.timestamp, candle);
    if (!page.nextBefore || page.nextBefore === before) break;
    before = page.nextBefore;
  }
  return {
    candles: [...candles.values()].toSorted(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
    ),
    providerRequests,
  };
}

function metadata(instrument: InstrumentSnapshot): MarketFixture["meta"] {
  return {
    instrumentId: instrument.instrumentId,
    market: instrument.market,
    symbol: instrument.symbol,
    displayName: instrument.displayName,
    currency: instrument.currency,
    synthetic: false,
    securityType: instrument.securityType,
    isinCode: instrument.isinCode,
    timeZone: instrument.timezone,
    calendar: "TOSS returned sessions · market holiday filtering is provider-defined",
    source: "TOSS OpenAPI adjusted candles",
    version: "OpenAPI 1.2.14",
    adjustedPrices: true,
  };
}

export function loadTossDataset(
  client: TossClient,
  instrument: InstrumentSnapshot,
  timeframe: "1d",
  options?: LoadOptions,
): Promise<MarketFixture & ProviderRequestTelemetry>;
export function loadTossDataset(
  client: TossClient,
  instrument: InstrumentSnapshot,
  timeframe: "5m",
  options?: LoadOptions,
): Promise<IntradayFixture & ProviderRequestTelemetry>;
export async function loadTossDataset(
  client: TossClient,
  instrument: InstrumentSnapshot,
  timeframe: "1d" | "5m",
  options: LoadOptions = {},
): Promise<(MarketFixture | IntradayFixture) & ProviderRequestTelemetry> {
  const targetBars = Math.max(1, options.targetBars ?? (timeframe === "1d" ? 200 : 1_200));
  const providerTarget = timeframe === "5m" ? targetBars * 5 : targetBars;
  const maxPages = Math.max(
    1,
    Math.min(40, options.maxPages ?? Math.ceil(providerTarget / 200) + 1),
  );
  const loaded = await loadPages(
    client,
    instrument.symbol,
    timeframe === "5m" ? "1m" : "1d",
    providerTarget,
    maxPages,
  );
  const source = loaded.candles;
  const candles =
    timeframe === "5m"
      ? aggregateFiveMinuteCandles(source).map((candle) => ({
          date: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }))
      : source.map((candle) => ({
          date: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));
  const result = { meta: metadata(instrument), candles, providerRequests: loaded.providerRequests };
  return timeframe === "5m" ? { ...result, timeframe } : result;
}

const intradayMinutes: Partial<Record<StrategyTimeframe, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "4h": 240,
};

function localClock(timestamp: string, timeZone: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(Date.parse(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function aggregateSessionAligned(
  candles: MarketCandle[],
  minutes: number,
  timeZone: string,
  sessionOpen: number,
) {
  const groups = new Map<string, MarketCandle[]>();
  for (const candle of candles) {
    const clock = localClock(candle.timestamp, timeZone);
    const bucket = Math.floor((clock.minutes - sessionOpen) / minutes);
    if (bucket < 0) continue;
    const key = `${clock.day}:${bucket}`;
    groups.set(key, [...(groups.get(key) ?? []), candle]);
  }
  return [...groups.values()].map((items) => ({
    date: items[0].timestamp,
    open: items[0].open,
    high: Math.max(...items.map((item) => item.high)),
    low: Math.min(...items.map((item) => item.low)),
    close: items.at(-1)!.close,
    volume: items.reduce((sum, item) => sum + item.volume, 0),
  }));
}

function aggregateWeekly(candles: MarketCandle[]) {
  const groups = new Map<string, MarketCandle[]>();
  for (const candle of candles) {
    const cursor = new Date(candle.timestamp);
    const weekday = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() - weekday + 1);
    const key = cursor.toISOString().slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), candle]);
  }
  return [...groups.values()].map((items) => ({
    date: items[0].timestamp,
    open: items[0].open,
    high: Math.max(...items.map((item) => item.high)),
    low: Math.min(...items.map((item) => item.low)),
    close: items.at(-1)!.close,
    volume: items.reduce((sum, item) => sum + item.volume, 0),
  }));
}

export async function loadTossStrategyDataset(
  client: TossClient,
  instrument: InstrumentSnapshot,
  timeframe: StrategyTimeframe,
  options: LoadOptions = {},
): Promise<MarketFixture & { timeframe: StrategyTimeframe } & ProviderRequestTelemetry> {
  const targetBars = Math.max(1, options.targetBars ?? 1_200);
  const minutes = intradayMinutes[timeframe];
  const sourceInterval = minutes ? ("1m" as const) : ("1d" as const);
  const providerTarget = minutes
    ? Math.min(8_000, targetBars * minutes)
    : Math.min(8_000, targetBars * (timeframe === "1w" ? 5 : 1));
  const loaded = await loadPages(
    client,
    instrument.symbol,
    sourceInterval,
    providerTarget,
    Math.max(1, Math.min(40, options.maxPages ?? Math.ceil(providerTarget / 200) + 1)),
  );
  const source = loaded.candles;
  const sessionOpen = instrument.currency === "KRW" ? 9 * 60 : 9 * 60 + 30;
  const candles = minutes
    ? aggregateSessionAligned(source, minutes, instrument.timezone, sessionOpen)
    : timeframe === "1w"
      ? aggregateWeekly(source)
      : source.map((candle) => ({
          date: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));
  return {
    meta: metadata(instrument),
    timeframe,
    candles: candles.slice(-targetBars),
    providerRequests: loaded.providerRequests,
  };
}
