import type { Period } from "klinecharts";

import type { DrawingKind } from "@/src/domain/stored-strategy";
import {
  aggregateFiveMinuteCandles,
  type AggregatedMarketCandle,
} from "@/src/domain/market-candles";
import type { CandleInterval, MarketCandle } from "@/src/server/toss/schemas";

export interface DisplayCandle extends MarketCandle {
  timestampMs: number;
}

export interface WilliamsFractalValue {
  up?: number;
  down?: number;
}

export interface HistoryPageState {
  olderCursor: string | null;
  timestamps: number[];
}

export interface FiveMinutePageState {
  oldestRawTimestamp: number | null;
  pendingOldestBucket: MarketCandle[];
}

interface ResolveFiveMinutePageInput {
  type: "init" | "forward";
  requestedCursor: string | null;
  nextBefore: string | null;
  candles: MarketCandle[];
}

export interface ResolvedFiveMinutePage {
  candles: AggregatedMarketCandle[];
  nextBefore: string | null;
  state: FiveMinutePageState;
}

export interface HistoryBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ResolveHistoryPageInput {
  type: "init" | "forward" | "backward" | "update";
  boundaryTimestamp: number | null;
  requestedCursor: string | null;
  nextBefore: string | null;
  candles: Array<
    Pick<AggregatedMarketCandle, "timestampMs" | "open" | "high" | "low" | "close" | "volume">
  >;
}

export interface ResolvedHistoryPage {
  bars: HistoryBar[];
  more: { forward: boolean; backward: boolean };
  state: HistoryPageState;
}

/**
 * KLineChart v10 calls the left/older edge `forward` and the right/newer edge
 * `backward`. This reducer also terminates inclusive or repeated provider pages.
 */
export function resolveHistoryPage(
  previous: HistoryPageState,
  input: ResolveHistoryPageInput,
): ResolvedHistoryPage {
  const previousTimestamps = input.type === "init" ? [] : previous.timestamps;
  const seen = new Set(previousTimestamps);
  const uniquePage = new Map(
    input.candles.map((candle) => [
      candle.timestampMs,
      {
        timestamp: candle.timestampMs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
    ]),
  );
  const boundary = input.boundaryTimestamp;
  const bars = [...uniquePage.values()]
    .filter((bar) => {
      if (seen.has(bar.timestamp)) return false;
      if (input.type === "forward") return boundary !== null && bar.timestamp < boundary;
      if (input.type === "backward") return boundary !== null && bar.timestamp > boundary;
      return input.type === "init";
    })
    .toSorted((left, right) => left.timestamp - right.timestamp);

  const cursorAdvanced =
    input.nextBefore !== null && input.nextBefore !== input.requestedCursor && bars.length > 0;
  const hasOlder = (input.type === "init" || input.type === "forward") && cursorAdvanced;
  const timestamps = [
    ...new Set([...previousTimestamps, ...bars.map((bar) => bar.timestamp)]),
  ].toSorted((left, right) => left - right);

  return {
    bars,
    more: { forward: hasOlder, backward: false },
    state: {
      olderCursor: hasOlder ? input.nextBefore : null,
      timestamps,
    },
  };
}

/**
 * Provider pages contain raw one-minute bars and may split a five-minute bucket.
 * Keep only the oldest boundary bucket pending until the next older page arrives,
 * then aggregate the union so OHLCV is not lost at an inclusive page boundary.
 */
export function resolveFiveMinuteProviderPage(
  previous: FiveMinutePageState,
  input: ResolveFiveMinutePageInput,
): ResolvedFiveMinutePage {
  const pageByTimestamp = new Map(
    input.candles
      .map((candle) => [Date.parse(candle.timestamp), candle] as const)
      .filter(([timestamp]) => Number.isFinite(timestamp)),
  );
  const pageTimestamps = [...pageByTimestamp.keys()];
  const pageOldest = pageTimestamps.length > 0 ? Math.min(...pageTimestamps) : null;
  const rawProgress =
    input.type === "init" ||
    (pageOldest !== null &&
      (previous.oldestRawTimestamp === null || pageOldest < previous.oldestRawTimestamp));
  const canLoadOlder =
    rawProgress && input.nextBefore !== null && input.nextBefore !== input.requestedCursor;
  const combined = new Map(
    [...previous.pendingOldestBucket, ...pageByTimestamp.values()].map((candle) => [
      Date.parse(candle.timestamp),
      candle,
    ]),
  );
  const aggregated = aggregateFiveMinuteCandles([...combined.values()]);
  const pendingTimestamp = canLoadOlder ? aggregated.at(0)?.timestampMs : undefined;
  const candles =
    pendingTimestamp === undefined
      ? aggregated
      : aggregated.filter((candle) => candle.timestampMs !== pendingTimestamp);
  const pendingOldestBucket =
    pendingTimestamp === undefined
      ? []
      : [...combined.entries()]
          .filter(([timestamp]) => Math.floor(timestamp / 300_000) * 300_000 === pendingTimestamp)
          .map(([, candle]) => candle);

  return {
    candles,
    nextBefore: canLoadOlder ? input.nextBefore : null,
    state: {
      oldestRawTimestamp:
        pageOldest === null
          ? previous.oldestRawTimestamp
          : Math.min(previous.oldestRawTimestamp ?? pageOldest, pageOldest),
      pendingOldestBucket,
    },
  };
}

const OVERLAY_NAMES: Record<DrawingKind, string> = {
  trend_line: "segment",
  straight_line: "straightLine",
  ray: "rayLine",
  horizontal_ray: "horizontalRayLine",
  horizontal_segment: "horizontalSegment",
  horizontal_line: "horizontalStraightLine",
  vertical_ray: "verticalRayLine",
  vertical_segment: "verticalSegment",
  vertical_line: "verticalStraightLine",
  parallel_lines: "parallelStraightLine",
  price_channel: "priceChannelLine",
  price_line: "priceLine",
  brush: "brush",
  rectangle: "qosRectangle",
  fibonacci: "fibonacciLine",
  pitchfork: "qosPitchfork",
  fan: "qosFan",
  annotation: "simpleAnnotation",
  tag: "simpleTag",
};

export function overlayNameForDrawing(kind: DrawingKind): string {
  return OVERLAY_NAMES[kind];
}

export function periodForChart(period: "1m" | "5m" | "1d"): {
  chart: Period;
  provider: CandleInterval;
} {
  if (period === "1d") return { chart: { type: "day", span: 1 }, provider: "1d" };
  return {
    chart: { type: "minute", span: period === "5m" ? 5 : 1 },
    provider: "1m",
  };
}

/** Standard 2-left/2-right Williams Fractal; the center is known two bars later. */
export function calculateWilliamsFractals(
  candles: Array<Pick<MarketCandle, "high" | "low">>,
): WilliamsFractalValue[] {
  return candles.map((candle, index) => {
    if (index < 2 || index + 2 >= candles.length) return {};
    const neighbors = [
      candles[index - 2],
      candles[index - 1],
      candles[index + 1],
      candles[index + 2],
    ];
    const value: WilliamsFractalValue = {};
    if (neighbors.every((neighbor) => candle.high > neighbor.high)) value.up = candle.high;
    if (neighbors.every((neighbor) => candle.low < neighbor.low)) value.down = candle.low;
    return value;
  });
}

function zonedDateParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** Returns the UTC instant corresponding to midnight on the market's local trading date. */
export function dailyBucketStart(timestamp: number, timezone: string): number {
  const date = zonedDateParts(timestamp, timezone);
  const desiredLocalTime = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = desiredLocalTime;
  // Re-evaluating the offset also handles dates close to a daylight-saving transition.
  for (let pass = 0; pass < 2; pass += 1) {
    const observed = zonedDateParts(candidate, timezone);
    const observedLocalTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    candidate += desiredLocalTime - observedLocalTime;
  }
  return candidate;
}

export { aggregateFiveMinuteCandles } from "@/src/domain/market-candles";

export function toDisplayCandles(
  candles: MarketCandle[],
  period: "1m" | "5m" | "1d",
): DisplayCandle[] {
  if (period === "5m") return aggregateFiveMinuteCandles(candles);
  return candles
    .map((candle) => ({ ...candle, timestampMs: Date.parse(candle.timestamp) }))
    .filter((candle) => Number.isFinite(candle.timestampMs))
    .toSorted((left, right) => left.timestampMs - right.timestampMs);
}
