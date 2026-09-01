import { z } from "zod";

import type { StrategyTimeframe } from "./strategy-v3/schema";
import type { Candle } from "../fixtures/markets";

const DAY_MILLISECONDS = 86_400_000;
const INTRADAY_MINUTES: Partial<Record<StrategyTimeframe, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "4h": 240,
};

export const BacktestWindowInputSchema = z
  .object({
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.startDate === undefined) !== (value.endDate === undefined)) {
      context.addIssue({
        code: "custom",
        message: "백테스트 시작일과 종료일을 함께 입력해 주세요.",
      });
    }
  });

export type BacktestWindowInput = z.infer<typeof BacktestWindowInputSchema>;

export interface ResolvedBacktestWindow {
  source: "DEFAULT" | "CUSTOM";
  startDate: string;
  endDate: string;
  label: string;
}

export class BacktestWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestWindowError";
  }
}

function localDate(timestamp: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof timestamp === "string" ? new Date(timestamp) : timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localSeconds(timestamp: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return part("hour") * 3_600 + part("minute") * 60 + part("second");
}

function shiftDate(date: string, options: { days?: number; years?: number }): string {
  const cursor = new Date(`${date}T12:00:00.000Z`);
  if (options.days) cursor.setUTCDate(cursor.getUTCDate() + options.days);
  if (options.years) cursor.setUTCFullYear(cursor.getUTCFullYear() + options.years);
  return cursor.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.round(
    (Date.parse(`${endDate}T12:00:00.000Z`) - Date.parse(`${startDate}T12:00:00.000Z`)) /
      DAY_MILLISECONDS,
  );
}

export function resolveBacktestWindow(
  timeframe: StrategyTimeframe,
  input: BacktestWindowInput | undefined,
  timeZone: string,
  now = new Date(),
): ResolvedBacktestWindow {
  const today = localDate(now, timeZone);
  const custom = input?.startDate !== undefined || input?.endDate !== undefined;
  let startDate: string;
  let endDate: string;

  if (custom) {
    if (!input?.startDate || !input.endDate) {
      throw new BacktestWindowError("백테스트 시작일과 종료일을 함께 입력해 주세요.");
    }
    startDate = input.startDate;
    endDate = input.endDate;
  } else {
    endDate = today;
    startDate = INTRADAY_MINUTES[timeframe]
      ? shiftDate(today, { days: -29 })
      : shiftDate(today, { years: timeframe === "1w" ? -5 : -2 });
  }

  const spanDays = daysBetween(startDate, endDate);
  if (spanDays < 0) throw new BacktestWindowError("백테스트 시작일은 종료일보다 늦을 수 없습니다.");
  if (endDate > today)
    throw new BacktestWindowError("백테스트 종료일은 오늘보다 늦을 수 없습니다.");

  if (INTRADAY_MINUTES[timeframe]) {
    if (spanDays > 30) {
      throw new BacktestWindowError("분봉 백테스트는 TOSS 데이터 한도상 최대 31일입니다.");
    }
    if (daysBetween(endDate, today) > 31) {
      throw new BacktestWindowError("분봉 백테스트 종료일은 최근 31일 안에서 선택해 주세요.");
    }
  } else {
    const maximumDays = timeframe === "1w" ? 20 * 366 : 10 * 366;
    if (spanDays > maximumDays) {
      throw new BacktestWindowError(
        timeframe === "1w"
          ? "주봉 백테스트는 최대 20년입니다."
          : "일봉 백테스트는 최대 10년입니다.",
      );
    }
  }

  return {
    source: custom ? "CUSTOM" : "DEFAULT",
    startDate,
    endDate,
    label: `${startDate} — ${endDate}${custom ? " · 직접 설정" : " · 자동 설정"}`,
  };
}

export function filterCandlesByBacktestWindow<T extends Candle>(
  candles: T[],
  window: ResolvedBacktestWindow,
  timeZone: string,
): T[] {
  return candles.filter((candle) => {
    const date = localDate(candle.date, timeZone);
    return date >= window.startDate && date <= window.endDate;
  });
}

export function filterCompletedBacktestCandles<T extends Candle>(
  candles: T[],
  timeframe: StrategyTimeframe,
  timeZone: string,
  currency: "KRW" | "USD",
  now = new Date(),
): T[] {
  const minutes = INTRADAY_MINUTES[timeframe];
  if (minutes) {
    const today = localDate(now, timeZone);
    const currentSeconds = localSeconds(now, timeZone);
    const closeSeconds = (currency === "KRW" ? 15 * 60 + 30 : 16 * 60) * 60;
    return candles.filter((candle) => {
      const candleDate = localDate(candle.date, timeZone);
      if (candleDate < today) return true;
      if (candleDate > today) return false;
      const candleStartSeconds = localSeconds(new Date(candle.date), timeZone);
      const completionSeconds = Math.min(candleStartSeconds + minutes * 60, closeSeconds);
      return currentSeconds >= completionSeconds + 5;
    });
  }

  const today = localDate(now, timeZone);
  const currentMinutes = Math.floor(localSeconds(now, timeZone) / 60);
  const closeMinutes = currency === "KRW" ? 15 * 60 + 30 : 16 * 60;
  if (timeframe === "1d") {
    return candles.filter((candle) => {
      const date = localDate(candle.date, timeZone);
      return date < today || (date === today && currentMinutes >= closeMinutes + 5);
    });
  }

  const weekStart = (date: string) => {
    const cursor = new Date(`${date}T12:00:00.000Z`);
    const weekday = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() - weekday + 1);
    return cursor.toISOString().slice(0, 10);
  };
  const currentWeek = weekStart(today);
  const currentWeekday = new Date(`${today}T12:00:00.000Z`).getUTCDay() || 7;
  const currentWeekComplete =
    currentWeekday > 5 || (currentWeekday === 5 && currentMinutes >= closeMinutes + 5);
  return candles.filter((candle) => {
    const candleWeek = weekStart(localDate(candle.date, timeZone));
    return candleWeek < currentWeek || (candleWeek === currentWeek && currentWeekComplete);
  });
}

export function estimateBacktestTargetBars(
  timeframe: StrategyTimeframe,
  window: ResolvedBacktestWindow,
  timeZone: string,
  now = new Date(),
): number {
  const today = localDate(now, timeZone);
  const elapsedDays = Math.max(1, daysBetween(window.startDate, today) + 1);
  const minutes = INTRADAY_MINUTES[timeframe];
  if (minutes) {
    const estimatedSessions = Math.ceil((elapsedDays * 5) / 7);
    return Math.min(8_000, Math.max(120, Math.ceil((estimatedSessions * 390) / minutes) + 100));
  }
  if (timeframe === "1w") {
    return Math.min(1_600, Math.max(260, Math.ceil(elapsedDays / 7) + 20));
  }
  return Math.min(3_000, Math.max(260, Math.ceil((elapsedDays * 5) / 7) + 30));
}
