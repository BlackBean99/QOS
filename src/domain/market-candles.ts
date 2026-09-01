import type { MarketCandle } from "@/src/server/toss/schemas";

export interface AggregatedMarketCandle extends MarketCandle {
  timestampMs: number;
}

export function aggregateFiveMinuteCandles(candles: MarketCandle[]): AggregatedMarketCandle[] {
  const buckets = new Map<number, AggregatedMarketCandle>();
  for (const candle of candles.toSorted(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  )) {
    const timestampMs = Date.parse(candle.timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    const bucket = Math.floor(timestampMs / 300_000) * 300_000;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, {
        ...candle,
        timestamp: new Date(bucket).toISOString(),
        timestampMs: bucket,
      });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }
  return [...buckets.values()].toSorted((left, right) => left.timestampMs - right.timestampMs);
}
