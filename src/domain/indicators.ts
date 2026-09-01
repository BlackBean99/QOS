import type { Candle } from "../fixtures/markets";

export type NullableSeries = Array<number | null>;

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function ema(values: number[], period: number): NullableSeries {
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

export function atr(candles: Candle[], period: number): NullableSeries {
  const ranges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  const output: NullableSeries = Array(ranges.length).fill(null);
  if (ranges.length < period) return output;
  let current = average(ranges.slice(0, period));
  output[period - 1] = current;
  for (let index = period; index < ranges.length; index += 1) {
    current = (current * (period - 1) + ranges[index]) / period;
    output[index] = current;
  }
  return output;
}

export function rollingSessionVwap(candles: Candle[], sessionLookback: number): NullableSeries {
  const output: NullableSeries = [];
  const sessions: string[] = [];
  for (const [index, candle] of candles.entries()) {
    const session = candle.date.slice(0, 10);
    if (sessions.at(-1) !== session) sessions.push(session);
    if (sessions.length < sessionLookback) {
      output.push(null);
      continue;
    }
    const allowed = new Set(sessions.slice(-sessionLookback));
    let notional = 0;
    let volume = 0;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const item = candles[cursor];
      if (!allowed.has(item.date.slice(0, 10))) break;
      const typical = (item.high + item.low + item.close) / 3;
      notional += typical * item.volume;
      volume += item.volume;
    }
    output.push(volume === 0 ? null : notional / volume);
  }
  return output;
}

export interface IchimokuPoint {
  tenkan: number | null;
  kijun: number | null;
  spanA: number | null;
  spanB: number | null;
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

export function ichimoku(
  candles: Candle[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  spanBPeriod = 52,
  displacement = 26,
): IchimokuPoint[] {
  const output: IchimokuPoint[] = candles.map(() => ({
    tenkan: null,
    kijun: null,
    spanA: null,
    spanB: null,
  }));
  candles.forEach((_, index) => {
    const tenkan = midpoint(candles, index, tenkanPeriod);
    const kijun = midpoint(candles, index, kijunPeriod);
    output[index].tenkan = tenkan;
    output[index].kijun = kijun;
    const target = index + displacement;
    if (target < output.length) {
      output[target].spanA = tenkan === null || kijun === null ? null : (tenkan + kijun) / 2;
      output[target].spanB = midpoint(candles, index, spanBPeriod);
    }
  });
  return output;
}

export function wilderRsi(values: number[], period: number): NullableSeries {
  const output: NullableSeries = Array(values.length).fill(null);
  if (values.length <= period) return output;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let averageGain = average(changes.slice(0, period).map((change) => Math.max(change, 0)));
  let averageLoss = average(changes.slice(0, period).map((change) => Math.max(-change, 0)));
  const toRsi = () => {
    if (averageGain === 0 && averageLoss === 0) return 50;
    if (averageLoss === 0) return 100;
    return 100 - 100 / (1 + averageGain / averageLoss);
  };
  output[period] = toRsi();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[index] = toRsi();
  }
  return output;
}

export function stochasticRsi(
  values: number[],
  rsiPeriod = 14,
  stochasticPeriod = 14,
  smoothing = 3,
): NullableSeries {
  const rsiValues = wilderRsi(values, rsiPeriod);
  const raw: NullableSeries = rsiValues.map((value, index) => {
    if (value === null || index < rsiPeriod + stochasticPeriod - 1) return null;
    const window = rsiValues
      .slice(index - stochasticPeriod + 1, index + 1)
      .filter((item): item is number => item !== null);
    if (window.length !== stochasticPeriod) return null;
    const minimum = Math.min(...window);
    const maximum = Math.max(...window);
    return maximum === minimum ? 50 : ((value - minimum) / (maximum - minimum)) * 100;
  });
  return raw.map((value, index) => {
    if (value === null || index < smoothing - 1) return null;
    const window = raw.slice(index - smoothing + 1, index + 1);
    return window.some((item) => item === null) ? null : average(window as number[]);
  });
}
