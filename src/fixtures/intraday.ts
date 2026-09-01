import type { InstrumentId } from "../domain/instruments";
import { getInstrumentFixture, type Candle, type MarketFixture } from "./markets";

export interface IntradayFixture extends MarketFixture {
  timeframe: "5m";
}

function weekdays(start: string, count: number, excludedDates: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  while (result.length < count) {
    const day = cursor.getUTCDay();
    const date = cursor.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !excludedDates.has(date)) result.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function sessionBias(session: number, progress: number): number {
  if (session < 12) return -0.004 + session * 0.00025;
  if (session < 15) return -0.015 - (session - 12) * 0.006;
  if (session === 15) return -0.025 + progress * 0.07;
  if (session === 16) return 0.045 + progress * 0.025;
  if (session === 17) return 0.07 - progress * 0.085;
  if (session === 18) return -0.012 + progress * 0.065;
  if (session === 19) return 0.052 - progress * 0.07;
  if (session === 20) return -0.012 + progress * 0.08;
  return 0.065 - (session - 21) * 0.015 - progress * 0.018;
}

export function getIntradayFixture(instrumentId: InstrumentId): IntradayFixture {
  const daily = getInstrumentFixture(instrumentId);
  const base = daily.candles[0].close;
  const isKospi = daily.meta.market === "KOSPI";
  const precision = daily.meta.currency === "KRW" ? 0 : 2;
  const excludedDates = isKospi
    ? new Set(["2025-05-01", "2025-05-05", "2025-05-06"])
    : new Set(["2025-04-18"]);
  const sessionDates = weekdays("2025-04-01", 24, excludedDates);
  const barsPerSession = 78;
  const sessionStartMinutes = isKospi ? 9 * 60 : 9 * 60 + 30;
  const candles: Candle[] = [];
  let previous = base;

  for (const [session, date] of sessionDates.entries()) {
    for (let bar = 0; bar < barsPerSession; bar += 1) {
      const progress = bar / (barsPerSession - 1);
      const wave = Math.sin((bar + session * 5) / 4.2) * 0.0035;
      const micro = Math.cos((bar + session) / 2.7) * 0.0012;
      const target = base * (1 + sessionBias(session, progress) + wave + micro);
      const open = previous;
      const close = target;
      const spread = base * (0.0015 + Math.abs(Math.sin(bar / 6)) * 0.0008);
      const minutes = sessionStartMinutes + bar * 5;
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      candles.push({
        date: `${date}T${hour}:${minute}:00`,
        open: Number(open.toFixed(precision)),
        high: Number((Math.max(open, close) + spread).toFixed(precision)),
        low: Number((Math.min(open, close) - spread).toFixed(precision)),
        close: Number(close.toFixed(precision)),
        volume: Math.round(20_000 * (1 + Math.abs(Math.sin(bar / 9))) * (session >= 15 ? 1.6 : 1)),
      });
      previous = close;
    }
  }

  return {
    meta: {
      ...daily.meta,
      source: "QOS synthetic 5-minute indicator fixture",
      version: "2025-5m-v2",
      calendar: `${daily.meta.calendar} · ${isKospi ? "09:00–15:30" : "09:30–16:00"} · explicit sample holidays`,
    },
    timeframe: "5m",
    candles,
  };
}
