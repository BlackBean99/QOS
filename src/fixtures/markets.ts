import {
  getInstrumentDefinition,
  type InstrumentId,
  type InstrumentSummary,
} from "../domain/instruments";

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketFixture {
  meta: Omit<InstrumentSummary, "aliases" | "timezone"> & {
    timeZone: "Asia/Seoul" | "America/New_York";
    calendar: string;
    source: string;
    version: string;
    adjustedPrices: boolean;
  };
  candles: Candle[];
}

const CLOSE_PATTERN = [
  100, 99, 98, 99, 100, 101, 100, 102, 103, 102, 104, 105, 104, 106, 107, 106, 108, 109, 108, 109,
  112, 114, 116, 117, 115, 111, 108, 107, 108, 109, 110, 111, 115, 118, 120, 121, 119, 116, 113,
  112, 113, 114, 117, 120, 122, 124, 121, 118, 117, 119, 121, 123,
] as const;

const VOLUME_SPIKES = new Map([
  [20, 2.65],
  [33, 2.8],
  [45, 2.5],
]);

function createSessionDates(start: string, count: number, excludedDates: Set<string>): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);

  while (dates.length < count) {
    const isoDate = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !excludedDates.has(isoDate)) dates.push(isoDate);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function createCandles(
  basePrice: number,
  baseVolume: number,
  dates: string[],
  precision: number,
): Candle[] {
  return CLOSE_PATTERN.map((normalizedClose, index) => {
    const close = (normalizedClose / 100) * basePrice;
    const previousClose =
      index === 0 ? close * 0.998 : (CLOSE_PATTERN[index - 1] / 100) * basePrice;
    const gapPattern = [0.998, 1.001, 1.003, 0.999][index % 4];
    const open = previousClose * gapPattern;
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.996;
    const volumeFactor = VOLUME_SPIKES.get(index) ?? 0.92 + (index % 6) * 0.035;

    return {
      date: dates[index],
      open: Number(open.toFixed(precision)),
      high: Number(high.toFixed(precision)),
      low: Number(low.toFixed(precision)),
      close: Number(close.toFixed(precision)),
      volume: Math.round(baseVolume * volumeFactor),
    };
  });
}

const nasdaqDates = createSessionDates(
  "2025-01-02",
  CLOSE_PATTERN.length,
  new Set(["2025-01-20", "2025-02-17"]),
);
const kospiDates = createSessionDates(
  "2025-01-02",
  CLOSE_PATTERN.length,
  new Set(["2025-01-28", "2025-01-29", "2025-01-30"]),
);

function fixtureMeta(instrumentId: InstrumentId): MarketFixture["meta"] {
  const instrument = getInstrumentDefinition(instrumentId);
  const isKospi = instrument.market === "KOSPI";

  return {
    instrumentId: instrument.instrumentId,
    market: instrument.market,
    symbol: instrument.symbol,
    displayName: instrument.displayName,
    currency: instrument.currency,
    synthetic: instrument.synthetic,
    timeZone: isKospi ? "Asia/Seoul" : "America/New_York",
    calendar: isKospi ? "QOS-KRX sample sessions v1" : "QOS-US sample sessions v1",
    source: "QOS synthetic instrument fixture",
    version: "2025-daily-v2",
    adjustedPrices: false,
  };
}

const FIXTURES: Record<InstrumentId, MarketFixture> = {
  "NASDAQ:AAPL": {
    meta: fixtureMeta("NASDAQ:AAPL"),
    candles: createCandles(180, 1_000_000, nasdaqDates, 2),
  },
  "NASDAQ:NVDA": {
    meta: fixtureMeta("NASDAQ:NVDA"),
    candles: createCandles(135, 1_450_000, nasdaqDates, 2),
  },
  "KOSPI:005930": {
    meta: fixtureMeta("KOSPI:005930"),
    candles: createCandles(72_000, 1_800_000, kospiDates, 0),
  },
  "KOSPI:000660": {
    meta: fixtureMeta("KOSPI:000660"),
    candles: createCandles(185_000, 1_250_000, kospiDates, 0),
  },
};

export function getInstrumentFixture(instrumentId: InstrumentId): MarketFixture {
  return FIXTURES[instrumentId];
}
