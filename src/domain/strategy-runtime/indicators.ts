import type { Candle } from "@/src/fixtures/markets";
import type {
  IndicatorOperand,
  StrategyTimeframe,
  VwapVariant,
} from "@/src/domain/strategy-v3/schema";

export type NullableSeries = Array<number | null>;

export interface IndicatorRuntimeContext {
  primaryTimeframe: StrategyTimeframe;
  marketTimeZone: string;
  sessionOpen: string;
  sessionClose: string;
}

interface RuntimeFrame {
  candles: Candle[];
  completedAt: number[];
}

const MINUTE = 60_000;
const timeframeMinutes: Record<StrategyTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "4h": 240,
  "1d": 1_440,
  "1w": 10_080,
};

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], mean = average(values)): number {
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function dateMs(candle: Candle): number {
  const value = Date.parse(candle.date);
  return Number.isFinite(value) ? value : 0;
}

function localParts(timestamp: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(timestamp);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function sessionKey(candle: Candle, timeZone: string): string {
  const parts = localParts(dateMs(candle), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function weekKey(candle: Candle, timeZone: string): string {
  const day = sessionKey(candle, timeZone);
  const cursor = new Date(`${day}T12:00:00.000Z`);
  const weekday = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() - weekday + 1);
  return cursor.toISOString().slice(0, 10);
}

function monthKey(candle: Candle, timeZone: string): string {
  return sessionKey(candle, timeZone).slice(0, 7);
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function source(candles: Candle[], field = "close"): number[] {
  return candles.map((candle) => {
    if (field === "hl2") return (candle.high + candle.low) / 2;
    if (field === "hlc3") return (candle.high + candle.low + candle.close) / 3;
    if (field === "ohlc4") return (candle.open + candle.high + candle.low + candle.close) / 4;
    return candle[field as "open" | "high" | "low" | "close"];
  });
}

function sma(values: number[], period: number): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) output[index] = sum / period;
  }
  return output;
}

function ema(values: number[], period: number): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length < period) return output;
  const alpha = 2 / (period + 1);
  let current = average(values.slice(0, period));
  output[period - 1] = current;
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
    output[index] = current;
  }
  return output;
}

function emaNullable(values: NullableSeries, period: number): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  const first = values.findIndex((value) => value !== null);
  if (first < 0) return output;
  const compact = values.slice(first).filter((value): value is number => value !== null);
  const calculated = ema(compact, period);
  calculated.forEach((value, index) => {
    output[first + index] = value;
  });
  return output;
}

function wilder(values: number[], period: number): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length < period) return output;
  let current = average(values.slice(0, period));
  output[period - 1] = current;
  for (let index = period; index < values.length; index += 1) {
    current = (current * (period - 1) + values[index]) / period;
    output[index] = current;
  }
  return output;
}

function atr(candles: Candle[], period: number): NullableSeries {
  return wilder(
    candles.map((candle, index) => {
      if (index === 0) return candle.high - candle.low;
      const previous = candles[index - 1].close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previous),
        Math.abs(candle.low - previous),
      );
    }),
    period,
  );
}

function rsi(values: number[], period: number): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length <= period) return output;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let gain = average(changes.slice(0, period).map((value) => Math.max(value, 0)));
  let loss = average(changes.slice(0, period).map((value) => Math.max(-value, 0)));
  const current = () =>
    gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  output[period] = current();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    output[index] = current();
  }
  return output;
}

function adx(
  candles: Candle[],
  period: number,
): Record<"ADX" | "PLUS_DI" | "MINUS_DI", NullableSeries> {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - candles[index - 1].close),
      Math.abs(candle.low - candles[index - 1].close),
    );
  });
  const plus = candles.map((candle, index) => {
    if (index === 0) return 0;
    const up = candle.high - candles[index - 1].high;
    const down = candles[index - 1].low - candle.low;
    return up > down && up > 0 ? up : 0;
  });
  const minus = candles.map((candle, index) => {
    if (index === 0) return 0;
    const up = candle.high - candles[index - 1].high;
    const down = candles[index - 1].low - candle.low;
    return down > up && down > 0 ? down : 0;
  });
  const tr = wilder(trueRanges, period);
  const plusSmoothed = wilder(plus, period);
  const minusSmoothed = wilder(minus, period);
  const plusDi = tr.map((value, index) =>
    value === null || value === 0 || plusSmoothed[index] === null
      ? null
      : (plusSmoothed[index]! / value) * 100,
  );
  const minusDi = tr.map((value, index) =>
    value === null || value === 0 || minusSmoothed[index] === null
      ? null
      : (minusSmoothed[index]! / value) * 100,
  );
  const dx = plusDi.map((value, index) => {
    const other = minusDi[index];
    if (value === null || other === null || value + other === 0) return null;
    return (Math.abs(value - other) / (value + other)) * 100;
  });
  const adxSeries: NullableSeries = Array(candles.length).fill(null);
  const first = dx.findIndex((value) => value !== null);
  if (first >= 0) {
    const calculated = wilder(
      dx.slice(first).map((value) => value ?? 0),
      period,
    );
    calculated.forEach((value, index) => {
      adxSeries[first + index] = value;
    });
  }
  return { ADX: adxSeries, PLUS_DI: plusDi, MINUS_DI: minusDi };
}

function midpoint(candles: Candle[], index: number, period: number): number | null {
  if (index < period - 1) return null;
  const window = candles.slice(index - period + 1, index + 1);
  return (
    (Math.max(...window.map((candle) => candle.high)) +
      Math.min(...window.map((candle) => candle.low))) /
    2
  );
}

function percentileRank(values: number[], value: number): number {
  return (values.filter((item) => item <= value).length / values.length) * 100;
}

function rollingExtreme(
  values: number[],
  period: number,
  excludeCurrent: boolean,
  mode: "max" | "min",
): NullableSeries {
  return values.map((_, index) => {
    const end = excludeCurrent ? index : index + 1;
    const start = end - period;
    if (start < 0 || end <= start) return null;
    return mode === "max"
      ? Math.max(...values.slice(start, end))
      : Math.min(...values.slice(start, end));
  });
}

function vwap(
  candles: Candle[],
  variant: VwapVariant,
  timeZone: string,
): { value: NullableSeries; deviation: NullableSeries } {
  const sessions = candles.map((candle) => sessionKey(candle, timeZone));
  const sessionOrder = [...new Set(sessions)];
  const typical = source(candles, "hlc3");
  const value: NullableSeries = [];
  const deviation: NullableSeries = [];
  for (let index = 0; index < candles.length; index += 1) {
    let start = 0;
    if (variant.kind === "SESSION") start = sessions.lastIndexOf(sessions[index], index);
    if (variant.kind === "WEEKLY") {
      const key = weekKey(candles[index], timeZone);
      start = candles.findIndex((candle) => weekKey(candle, timeZone) === key);
    }
    if (variant.kind === "MONTHLY") {
      const key = monthKey(candles[index], timeZone);
      start = candles.findIndex((candle) => monthKey(candle, timeZone) === key);
    }
    if (variant.kind === "ANCHORED") {
      start = candles.findIndex((candle) => dateMs(candle) >= Date.parse(variant.anchor));
      if (start < 0 || index < start) {
        value.push(null);
        deviation.push(null);
        continue;
      }
    }
    if (variant.kind === "ROLLING_BARS") start = Math.max(0, index - variant.bars + 1);
    if (variant.kind === "ROLLING_DAYS") {
      const sessionIndex = sessionOrder.indexOf(sessions[index]);
      const firstSession = sessionOrder[Math.max(0, sessionIndex - variant.days + 1)];
      start = sessions.indexOf(firstSession);
      if (sessionIndex + 1 < variant.days) {
        value.push(null);
        deviation.push(null);
        continue;
      }
    }
    const window = candles.slice(start, index + 1);
    const volume = window.reduce((sum, candle) => sum + candle.volume, 0);
    if (volume <= 0) {
      value.push(null);
      deviation.push(null);
      continue;
    }
    const mean =
      window.reduce((sum, candle, offset) => sum + typical[start + offset] * candle.volume, 0) /
      volume;
    const variance =
      window.reduce(
        (sum, candle, offset) => sum + (typical[start + offset] - mean) ** 2 * candle.volume,
        0,
      ) / volume;
    value.push(mean);
    deviation.push(Math.sqrt(variance));
  }
  return { value, deviation };
}

function aggregateFrame(
  candles: Candle[],
  timeframe: StrategyTimeframe,
  context: IndicatorRuntimeContext,
): RuntimeFrame {
  const duration = timeframeMinutes[timeframe];
  const primaryDuration = timeframeMinutes[context.primaryTimeframe];
  if (timeframe === context.primaryTimeframe) {
    return {
      candles,
      completedAt: candles.map((candle) => dateMs(candle) + primaryDuration * MINUTE),
    };
  }
  if (duration < primaryDuration) return { candles: [], completedAt: [] };
  const grouped = new Map<string, Candle[]>();
  const intradayCompletedAt = new Map<string, number>();
  for (const candle of candles) {
    let key: string;
    if (timeframe === "1d") key = sessionKey(candle, context.marketTimeZone);
    else if (timeframe === "1w") key = weekKey(candle, context.marketTimeZone);
    else {
      const timestamp = dateMs(candle);
      const parts = localParts(timestamp, context.marketTimeZone);
      const sessionOpen = clockMinutes(context.sessionOpen);
      const sessionClose = clockMinutes(context.sessionClose);
      const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
      const bucket = Math.floor((localMinute - sessionOpen) / duration);
      const bucketStart = sessionOpen + bucket * duration;
      const bucketEnd = Math.min(bucketStart + duration, sessionClose);
      key = `${parts.year}-${parts.month}-${parts.day}:${bucket}`;
      intradayCompletedAt.set(key, timestamp + (bucketEnd - localMinute) * MINUTE);
    }
    const items = grouped.get(key) ?? [];
    items.push(candle);
    grouped.set(key, items);
  }
  const entries = [...grouped.entries()];
  const groups = entries.map(([, items]) => items);
  const aggregated = groups.map((items) => ({
    date: items[0].date,
    open: items[0].open,
    high: Math.max(...items.map((candle) => candle.high)),
    low: Math.min(...items.map((candle) => candle.low)),
    close: items.at(-1)!.close,
    volume: items.reduce((sum, candle) => sum + candle.volume, 0),
  }));
  const completedAt = groups.map((items, index) => {
    if (timeframe === "1d" || timeframe === "1w")
      return groups[index + 1] ? dateMs(groups[index + 1][0]) : Number.POSITIVE_INFINITY;
    return (
      intradayCompletedAt.get(entries[index][0]) ?? dateMs(items.at(-1)!) + primaryDuration * MINUTE
    );
  });
  return { candles: aggregated, completedAt };
}

function alignSeries(
  primary: Candle[],
  frame: RuntimeFrame,
  values: NullableSeries,
  primaryMinutes: number,
): NullableSeries {
  return primary.map((candle) => {
    const signalAt = dateMs(candle) + primaryMinutes * MINUTE;
    let match = -1;
    for (let index = 0; index < frame.completedAt.length; index += 1) {
      if (frame.completedAt[index] <= signalAt) match = index;
      else break;
    }
    return match < 0 ? null : (values[match] ?? null);
  });
}

function parabolicSar(candles: Candle[], step: number, maximum: number): NullableSeries {
  if (candles.length < 2) return candles.map(() => null);
  const output: NullableSeries = [null, candles[0].low];
  let long = candles[1].close >= candles[0].close;
  let extreme = long
    ? Math.max(candles[0].high, candles[1].high)
    : Math.min(candles[0].low, candles[1].low);
  let acceleration = step;
  for (let index = 2; index < candles.length; index += 1) {
    let sar = output[index - 1]! + acceleration * (extreme - output[index - 1]!);
    if (long) {
      sar = Math.min(sar, candles[index - 1].low, candles[index - 2].low);
      if (candles[index].low < sar) {
        long = false;
        sar = extreme;
        extreme = candles[index].low;
        acceleration = step;
      } else if (candles[index].high > extreme) {
        extreme = candles[index].high;
        acceleration = Math.min(maximum, acceleration + step);
      }
    } else {
      sar = Math.max(sar, candles[index - 1].high, candles[index - 2].high);
      if (candles[index].high > sar) {
        long = true;
        sar = extreme;
        extreme = candles[index].high;
        acceleration = step;
      } else if (candles[index].low < extreme) {
        extreme = candles[index].low;
        acceleration = Math.min(maximum, acceleration + step);
      }
    }
    output.push(sar);
  }
  return output;
}

export class IndicatorRegistry {
  private readonly cache = new Map<string, NullableSeries>();

  constructor(
    private readonly candles: Candle[],
    private readonly context: IndicatorRuntimeContext,
  ) {}

  series(operand: IndicatorOperand): NullableSeries {
    const key = JSON.stringify(operand);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const frame = aggregateFrame(this.candles, operand.timeframe, this.context);
    let values = this.calculate(frame.candles, {
      ...operand,
      timeframe: this.context.primaryTimeframe,
      offset: 0,
    });
    if (operand.timeframe !== this.context.primaryTimeframe) {
      values = alignSeries(
        this.candles,
        frame,
        values,
        timeframeMinutes[this.context.primaryTimeframe],
      );
    }
    if (operand.offset > 0)
      values = values.map((_, index) => values[index - operand.offset] ?? null);
    this.cache.set(key, values);
    return values;
  }

  value(operand: IndicatorOperand, index: number): number | null {
    return this.series(operand)[index] ?? null;
  }

  private calculate(candles: Candle[], operand: IndicatorOperand): NullableSeries {
    const closes = source(candles, "close");
    if (operand.kind === "PRICE") return source(candles, operand.field);
    if (operand.kind === "VOLUME") return candles.map((candle) => candle.volume);
    if (operand.kind === "SMA" || operand.kind === "EMA")
      return (operand.kind === "SMA" ? sma : ema)(source(candles, operand.source), operand.period);
    if (operand.kind === "RSI") return rsi(closes, operand.period);
    if (operand.kind === "MACD") {
      const fast = ema(closes, operand.fastPeriod);
      const slow = ema(closes, operand.slowPeriod);
      const line = closes.map((_, index) =>
        fast[index] === null || slow[index] === null ? null : fast[index]! - slow[index]!,
      );
      const signal = emaNullable(line, operand.signalPeriod);
      if (operand.output === "LINE") return line;
      if (operand.output === "SIGNAL") return signal;
      return line.map((value, index) =>
        value === null || signal[index] === null ? null : value - signal[index]!,
      );
    }
    if (operand.kind === "ATR" || operand.kind === "ATRP") {
      const values = atr(candles, operand.period);
      if (operand.kind === "ATR") return values;
      return values.map((value, index) =>
        value === null || closes[index] === 0 ? null : (value / closes[index]) * 100,
      );
    }
    if (operand.kind === "ATR_EXPANSION") {
      const values = atr(candles, operand.period);
      const base = values.map((_, index) => {
        const window = values.slice(index - operand.averagePeriod + 1, index + 1);
        return window.length !== operand.averagePeriod || window.some((value) => value === null)
          ? null
          : average(window as number[]);
      });
      return values.map((value, index) =>
        value === null || base[index] === null || base[index] === 0 ? null : value / base[index]!,
      );
    }
    if (operand.kind === "ADX") return adx(candles, operand.period)[operand.output];
    if (operand.kind === "ICHIMOKU") {
      return candles.map((_, index) => {
        const tenkan = midpoint(candles, index, operand.tenkanPeriod);
        const kijun = midpoint(candles, index, operand.kijunPeriod);
        const spanA = tenkan === null || kijun === null ? null : (tenkan + kijun) / 2;
        const spanB = midpoint(candles, index, operand.spanBPeriod);
        if (operand.output === "TENKAN") return tenkan;
        if (operand.output === "KIJUN") return kijun;
        if (operand.output === "SPAN_A_SOURCE") return spanA;
        if (operand.output === "SPAN_B_SOURCE") return spanB;
        if (spanA === null || spanB === null) return null;
        return operand.output === "CLOUD_TOP_SOURCE"
          ? Math.max(spanA, spanB)
          : Math.min(spanA, spanB);
      });
    }
    if (operand.kind === "STOCHASTIC") {
      const raw = candles.map((candle, index) => {
        if (index < operand.kPeriod - 1) return null;
        const window = candles.slice(index - operand.kPeriod + 1, index + 1);
        const low = Math.min(...window.map((item) => item.low));
        const high = Math.max(...window.map((item) => item.high));
        return high === low ? 50 : ((candle.close - low) / (high - low)) * 100;
      });
      const smooth = (values: NullableSeries, period: number) =>
        values.map((_, index) => {
          const window = values.slice(index - period + 1, index + 1);
          return window.length !== period || window.some((value) => value === null)
            ? null
            : average(window as number[]);
        });
      const k = smooth(raw, operand.kSmoothing);
      return operand.output === "K" ? k : smooth(k, operand.dPeriod);
    }
    if (operand.kind === "ROC" || operand.kind === "MOMENTUM") {
      const values = source(candles, operand.source);
      return values.map((value, index) =>
        index < operand.period
          ? null
          : operand.kind === "ROC"
            ? (value / values[index - operand.period] - 1) * 100
            : value - values[index - operand.period],
      );
    }
    if (operand.kind === "BOLLINGER" || operand.kind === "BB_WIDTH_PERCENTILE") {
      const values = source(candles, operand.kind === "BOLLINGER" ? operand.source : "close");
      const middle = sma(values, operand.period);
      const deviation = values.map((_, index) =>
        index < operand.period - 1
          ? null
          : standardDeviation(values.slice(index - operand.period + 1, index + 1)),
      );
      const width = middle.map((value, index) =>
        value === null || deviation[index] === null || value === 0
          ? null
          : ((deviation[index]! * operand.standardDeviations * 2) / value) * 100,
      );
      if (operand.kind === "BB_WIDTH_PERCENTILE")
        return width.map((value, index) => {
          const window = width.slice(index - operand.lookback + 1, index + 1);
          return value === null ||
            window.length !== operand.lookback ||
            window.some((item) => item === null)
            ? null
            : percentileRank(window as number[], value);
        });
      if (operand.output === "MIDDLE") return middle;
      if (operand.output === "WIDTH") return width;
      if (operand.output === "PERCENT_B")
        return middle.map((value, index) =>
          value === null || deviation[index] === null || deviation[index] === 0
            ? null
            : (values[index] - (value - deviation[index]! * operand.standardDeviations)) /
              (deviation[index]! * operand.standardDeviations * 2),
        );
      return middle.map((value, index) =>
        value === null || deviation[index] === null
          ? null
          : value +
            (operand.output === "UPPER" ? 1 : -1) * deviation[index]! * operand.standardDeviations,
      );
    }
    if (operand.kind === "DONCHIAN") {
      const upper = rollingExtreme(
        source(candles, "high"),
        operand.period,
        operand.excludeCurrent,
        "max",
      );
      const lower = rollingExtreme(
        source(candles, "low"),
        operand.period,
        operand.excludeCurrent,
        "min",
      );
      if (operand.output === "UPPER") return upper;
      if (operand.output === "LOWER") return lower;
      return upper.map((value, index) =>
        value === null || lower[index] === null ? null : (value + lower[index]!) / 2,
      );
    }
    if (operand.kind === "KELTNER") {
      const middle = ema(closes, operand.emaPeriod);
      const range = atr(candles, operand.atrPeriod);
      if (operand.output === "MIDDLE") return middle;
      return middle.map((value, index) =>
        value === null || range[index] === null
          ? null
          : value + (operand.output === "UPPER" ? 1 : -1) * range[index]! * operand.multiplier,
      );
    }
    if (operand.kind === "VWAP") {
      const result = vwap(candles, operand.variant, this.context.marketTimeZone);
      if (operand.output === "VALUE") return result.value;
      if (operand.output === "UPPER_BAND" || operand.output === "LOWER_BAND")
        return result.value.map((value, index) =>
          value === null || result.deviation[index] === null
            ? null
            : value +
              (operand.output === "UPPER_BAND" ? 1 : -1) *
                result.deviation[index]! *
                (operand.bandStandardDeviations ?? 1),
        );
      if (operand.output === "DISTANCE_PERCENT")
        return result.value.map((value, index) =>
          value === null || value === 0 ? null : ((closes[index] - value) / value) * 100,
        );
      if (operand.output === "DISTANCE_ATR") {
        const range = atr(candles, 14);
        return result.value.map((value, index) =>
          value === null || range[index] === null || range[index] === 0
            ? null
            : (closes[index] - value) / range[index]!,
        );
      }
      return result.value.map((value, index) =>
        value === null || result.deviation[index] === null || result.deviation[index] === 0
          ? null
          : (closes[index] - value) / result.deviation[index]!,
      );
    }
    if (operand.kind === "VOLUME_SMA" || operand.kind === "RELATIVE_VOLUME") {
      const volume = candles.map((candle) => candle.volume);
      const mean = sma(volume, operand.period);
      return operand.kind === "VOLUME_SMA"
        ? mean
        : mean.map((value, index) =>
            value === null || value === 0 ? null : volume[index] / value,
          );
    }
    if (operand.kind === "OBV") {
      let current = 0;
      const values = candles.map((candle, index) => {
        if (index > 0)
          current +=
            candle.close > candles[index - 1].close
              ? candle.volume
              : candle.close < candles[index - 1].close
                ? -candle.volume
                : 0;
        return current;
      });
      if (operand.output === "PREVIOUS_HIGH") {
        return rollingExtreme(values, operand.period!, true, "max");
      }
      if (operand.output === "PREVIOUS_LOW") {
        return rollingExtreme(values, operand.period!, true, "min");
      }
      return values;
    }
    if (operand.kind === "CMF") {
      const flow = candles.map((candle) =>
        candle.high === candle.low
          ? 0
          : ((candle.close - candle.low - (candle.high - candle.close)) /
              (candle.high - candle.low)) *
            candle.volume,
      );
      return candles.map((_, index) => {
        if (index < operand.period - 1) return null;
        const window = candles.slice(index - operand.period + 1, index + 1);
        const volume = window.reduce((sum, candle) => sum + candle.volume, 0);
        return volume === 0
          ? null
          : flow
              .slice(index - operand.period + 1, index + 1)
              .reduce((sum, value) => sum + value, 0) / volume;
      });
    }
    if (operand.kind === "ZSCORE") {
      const values = source(candles, operand.source);
      return values.map((value, index) => {
        if (index < operand.period - 1) return null;
        const window = values.slice(index - operand.period + 1, index + 1);
        const mean = average(window);
        const deviation = standardDeviation(window, mean);
        return deviation === 0 ? 0 : (value - mean) / deviation;
      });
    }
    if (operand.kind === "MA_DEVIATION" || operand.kind === "MA_SLOPE") {
      const values = source(candles, operand.source);
      const mean = (operand.average === "SMA" ? sma : ema)(values, operand.period);
      if (operand.kind === "MA_DEVIATION")
        return mean.map((value, index) =>
          value === null || value === 0 ? null : ((values[index] - value) / value) * 100,
        );
      return mean.map((value, index) =>
        value === null || index < operand.lookback || mean[index - operand.lookback] === null
          ? null
          : (value - mean[index - operand.lookback]!) / operand.lookback,
      );
    }
    if (operand.kind === "HIGHEST" || operand.kind === "LOWEST")
      return rollingExtreme(
        source(candles, operand.field),
        operand.period,
        operand.excludeCurrent,
        operand.kind === "HIGHEST" ? "max" : "min",
      );
    if (operand.kind === "OPENING_RANGE") {
      return candles.map((candle, index) => {
        const key = sessionKey(candle, this.context.marketTimeZone);
        const parts = localParts(dateMs(candle), this.context.marketTimeZone);
        const currentMinute =
          Number(parts.hour) * 60 +
          Number(parts.minute) +
          timeframeMinutes[this.context.primaryTimeframe];
        const [hour, minute] = this.context.sessionOpen.split(":").map(Number);
        const end = hour * 60 + minute + operand.minutes;
        if (currentMinute < end) return null;
        const session = candles
          .slice(0, index + 1)
          .filter((item) => sessionKey(item, this.context.marketTimeZone) === key)
          .filter((item) => {
            const local = localParts(dateMs(item), this.context.marketTimeZone);
            return Number(local.hour) * 60 + Number(local.minute) < end;
          });
        if (session.length === 0) return null;
        const high = Math.max(...session.map((item) => item.high));
        const low = Math.min(...session.map((item) => item.low));
        return operand.output === "HIGH" ? high : operand.output === "LOW" ? low : (high + low) / 2;
      });
    }
    if (operand.kind === "MARKET_STRUCTURE") {
      if (operand.output === "PREVIOUS_HIGH")
        return candles.map((_, index) => candles[index - 1]?.high ?? null);
      if (operand.output === "PREVIOUS_LOW")
        return candles.map((_, index) => candles[index - 1]?.low ?? null);
      if (operand.output === "PIVOT")
        return candles.map((_, index) =>
          index === 0
            ? null
            : (candles[index - 1].high + candles[index - 1].low + candles[index - 1].close) / 3,
        );
      if (operand.output === "SUPPORT")
        return rollingExtreme(source(candles, "low"), operand.lookback, true, "min");
      if (operand.output === "RESISTANCE")
        return rollingExtreme(source(candles, "high"), operand.lookback, true, "max");
      let latest: number | null = null;
      return candles.map((_, index) => {
        const candidate = index - operand.rightBars;
        if (candidate >= operand.leftBars) {
          const start = candidate - operand.leftBars;
          const end = candidate + operand.rightBars + 1;
          const window = candles.slice(start, end);
          if (window.length === operand.leftBars + operand.rightBars + 1) {
            const high = candles[candidate].high;
            const low = candles[candidate].low;
            if (
              operand.output === "SWING_HIGH" &&
              high === Math.max(...window.map((item) => item.high))
            )
              latest = high;
            if (
              operand.output === "SWING_LOW" &&
              low === Math.min(...window.map((item) => item.low))
            )
              latest = low;
          }
        }
        return latest;
      });
    }
    if (operand.kind === "PARABOLIC_SAR") {
      return parabolicSar(candles, operand.accelerationStep, operand.accelerationMaximum);
    }
    return candles.map(() => null);
  }
}
