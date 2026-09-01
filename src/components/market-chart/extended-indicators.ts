import { IndicatorsSync } from "@ixjb94/indicators/dist/core/indicatorsSync.js";
import type { KLineData } from "klinecharts";

import type { ChartIndicator } from "@/src/domain/chart-indicators";

interface RuntimeDefinition {
  name: ChartIndicator;
  series: "price" | "normal";
  calcParams: number[];
  keys: string[];
  calculate: (data: KLineData[], params: number[]) => number[][];
}

const ta = new IndicatorsSync();
const values = (data: KLineData[], key: "open" | "high" | "low" | "close") =>
  data.map((candle) => candle[key]);
const volume = (data: KLineData[]) => data.map((candle) => candle.volume ?? 0);
const param = (params: number[], index: number, fallback: number) => params[index] ?? fallback;
const one = (series: number[]) => [series];

function align(length: number, series: number[]): Array<number | null> {
  const offset = Math.max(0, length - series.length);
  return Array.from({ length }, (_, index) => {
    const value = series[index - offset];
    return index < offset || !Number.isFinite(value) ? null : value;
  });
}

function envelope(data: KLineData[], params: number[]): number[][] {
  const middle = ta.sma(values(data, "close"), param(params, 0, 20));
  const ratio = param(params, 1, 2) / 100;
  return [
    middle.map((value) => value * (1 - ratio)),
    middle,
    middle.map((value) => value * (1 + ratio)),
  ];
}

function bollDerived(data: KLineData[], params: number[], kind: "percent" | "width"): number[][] {
  const source = values(data, "close");
  const [lower, middle, upper] = ta.bbands(source, param(params, 0, 20), param(params, 1, 2));
  const offset = Math.max(0, source.length - lower.length);
  return [
    lower.map((low, index) => {
      const high = upper[index];
      if (kind === "width") return middle[index] === 0 ? 0 : ((high - low) / middle[index]) * 100;
      const width = high - low;
      return width === 0 ? 0 : ((source[index + offset] - low) / width) * 100;
    }),
  ];
}

function superTrend(data: KLineData[], params: number[]): number[][] {
  const period = Math.max(1, Math.round(param(params, 0, 10)));
  const multiplier = param(params, 1, 3);
  const atr = align(
    data.length,
    ta.atr(values(data, "high"), values(data, "low"), values(data, "close"), period),
  );
  const line: number[] = [];
  let finalUpper = 0;
  let finalLower = 0;
  let previousLine = 0;
  let initialized = false;
  data.forEach((candle, index) => {
    const currentAtr = atr[index];
    if (currentAtr === null) {
      line.push(Number.NaN);
      return;
    }
    const center = (candle.high + candle.low) / 2;
    const basicUpper = center + multiplier * currentAtr;
    const basicLower = center - multiplier * currentAtr;
    const previousClose = data[index - 1]?.close ?? candle.close;
    if (!initialized) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      previousLine = finalUpper;
      initialized = true;
      line.push(previousLine);
      return;
    }
    const previousUpper = finalUpper;
    const previousLower = finalLower;
    finalUpper =
      basicUpper < previousUpper || previousClose > previousUpper ? basicUpper : previousUpper;
    finalLower =
      basicLower > previousLower || previousClose < previousLower ? basicLower : previousLower;
    const nextLine =
      previousLine === previousUpper
        ? candle.close <= finalUpper
          ? finalUpper
          : finalLower
        : candle.close >= finalLower
          ? finalLower
          : finalUpper;
    previousLine = nextLine;
    line.push(nextLine);
  });
  return [line];
}

function mcGinley(data: KLineData[], params: number[]): number[][] {
  const source = values(data, "close");
  const period = Math.max(1, param(params, 0, 14));
  const output: number[] = [];
  for (const price of source) {
    const previous = output.at(-1) ?? price;
    const ratio = previous === 0 ? 1 : price / previous;
    output.push(previous + (price - previous) / Math.max(1, period * ratio ** 4));
  }
  return [output];
}

function vortex(data: KLineData[], params: number[]): number[][] {
  const period = Math.max(1, Math.round(param(params, 0, 14)));
  const plus: number[] = [];
  const minus: number[] = [];
  for (let index = period; index < data.length; index += 1) {
    let trSum = 0;
    let plusSum = 0;
    let minusSum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const current = data[cursor];
      const previous = data[cursor - 1];
      trSum += Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );
      plusSum += Math.abs(current.high - previous.low);
      minusSum += Math.abs(current.low - previous.high);
    }
    plus.push(trSum === 0 ? 0 : plusSum / trSum);
    minus.push(trSum === 0 ? 0 : minusSum / trSum);
  }
  return [plus, minus];
}

function rollingHigh(data: KLineData[], params: number[]): number[][] {
  const period = Math.max(1, Math.round(param(params, 0, 252)));
  return [
    data
      .slice(period - 1)
      .map((_, index) =>
        Math.max(...data.slice(index, index + period).map((candle) => candle.high)),
      ),
  ];
}

function pivotPoints(data: KLineData[]): number[][] {
  const pivot: number[] = [];
  const resistance: number[] = [];
  const support: number[] = [];
  for (let index = 1; index < data.length; index += 1) {
    const previous = data[index - 1];
    const point = (previous.high + previous.low + previous.close) / 3;
    pivot.push(point);
    resistance.push(point * 2 - previous.low);
    support.push(point * 2 - previous.high);
  }
  return [pivot, resistance, support];
}

function zigZag(data: KLineData[], params: number[]): number[][] {
  const threshold = Math.max(0.1, param(params, 0, 5)) / 100;
  const output = Array<number>(data.length).fill(Number.NaN);
  if (data.length === 0) return [output];
  let pivotIndex = 0;
  let pivotPrice = data[0].close;
  let direction = 0;
  output[0] = pivotPrice;
  for (let index = 1; index < data.length; index += 1) {
    const change = (data[index].close - pivotPrice) / pivotPrice;
    if (direction >= 0 && data[index].close >= pivotPrice) {
      output[pivotIndex] = Number.NaN;
      pivotIndex = index;
      pivotPrice = data[index].close;
      output[index] = pivotPrice;
      direction = 1;
    } else if (direction <= 0 && data[index].close <= pivotPrice) {
      output[pivotIndex] = Number.NaN;
      pivotIndex = index;
      pivotPrice = data[index].close;
      output[index] = pivotPrice;
      direction = -1;
    } else if (
      (direction >= 0 && change <= -threshold) ||
      (direction <= 0 && change >= threshold)
    ) {
      pivotIndex = index;
      pivotPrice = data[index].close;
      output[index] = pivotPrice;
      direction = change > 0 ? 1 : -1;
    }
  }
  return [output];
}

function accelerator(data: KLineData[], params: number[]): number[][] {
  const ao = ta.ao(values(data, "high"), values(data, "low"));
  const average = ta.sma(ao, Math.max(1, Math.round(param(params, 0, 5))));
  const offset = ao.length - average.length;
  return [average.map((value, index) => ao[index + offset] - value)];
}

function rankCorrelation(data: KLineData[], params: number[]): number[][] {
  const source = values(data, "close");
  const period = Math.max(2, Math.round(param(params, 0, 12)));
  return [
    source.slice(period - 1).map((_, start) => {
      const window = source.slice(start, start + period);
      const ranked = window
        .map((value, index) => ({ value, index }))
        .toSorted((left, right) => left.value - right.value)
        .reduce<number[]>((result, item, rank) => {
          result[item.index] = rank + 1;
          return result;
        }, []);
      const squared = ranked.reduce((sum, rank, index) => sum + (rank - (index + 1)) ** 2, 0);
      return (1 - (6 * squared) / (period * (period ** 2 - 1))) * 100;
    }),
  ];
}

function standardErrorBands(data: KLineData[], params: number[]): number[][] {
  const source = values(data, "close");
  const period = Math.max(2, Math.round(param(params, 0, 20)));
  const multiple = param(params, 1, 2);
  const center = ta.linreg(source, period);
  const error = ta.stderr(source, period);
  return [
    center.map((value, index) => value - (error[index] ?? 0) * multiple),
    center,
    center.map((value, index) => value + (error[index] ?? 0) * multiple),
  ];
}

function connorsRsi(data: KLineData[], params: number[]): number[][] {
  const source = values(data, "close");
  const rsiPeriod = Math.max(1, Math.round(param(params, 0, 3)));
  const streakPeriod = Math.max(1, Math.round(param(params, 1, 2)));
  const rankPeriod = Math.max(2, Math.round(param(params, 2, 100)));
  const streaks: number[] = [0];
  for (let index = 1; index < source.length; index += 1) {
    const direction = Math.sign(source[index] - source[index - 1]);
    const previous = index > 1 ? Math.sign(source[index - 1] - source[index - 2]) : 0;
    streaks.push(
      direction === 0
        ? 0
        : direction === previous
          ? (streaks[index - 1] ?? 0) + direction
          : direction,
    );
  }
  const priceRsi = align(source.length, ta.rsi(source, rsiPeriod));
  const streakRsi = align(source.length, ta.rsi(streaks, streakPeriod));
  const returns = source.map((value, index) =>
    index === 0 ? Number.NaN : ((value - source[index - 1]) / source[index - 1]) * 100,
  );
  const rank = returns.map((change, index) => {
    if (index <= rankPeriod) return null;
    const comparison = returns.slice(index - rankPeriod, index);
    return (comparison.filter((item) => item < change).length / rankPeriod) * 100;
  });
  return [
    source.map((_, index) => {
      const valuesAtIndex = [priceRsi[index], streakRsi[index], rank[index]];
      return valuesAtIndex.some((value) => value === null)
        ? Number.NaN
        : (valuesAtIndex as number[]).reduce((sum, value) => sum + value, 0) / 3;
    }),
  ];
}

const definitions: RuntimeDefinition[] = [
  {
    name: "ATR",
    series: "normal",
    calcParams: [14],
    keys: ["atr"],
    calculate: (d, p) =>
      one(ta.atr(values(d, "high"), values(d, "low"), values(d, "close"), param(p, 0, 14))),
  },
  {
    name: "ADX",
    series: "normal",
    calcParams: [14],
    keys: ["adx"],
    calculate: (d, p) => one(ta.adx(values(d, "high"), values(d, "low"), param(p, 0, 14))),
  },
  {
    name: "AROON",
    series: "normal",
    calcParams: [14],
    keys: ["up", "down"],
    calculate: (d, p) => ta.aroon(values(d, "high"), values(d, "low"), param(p, 0, 14)),
  },
  {
    name: "DONCHIAN",
    series: "price",
    calcParams: [20],
    keys: ["upper", "middle", "lower"],
    calculate: (d, p) => ta.dc(values(d, "high"), values(d, "low"), param(p, 0, 20)),
  },
  {
    name: "KELTNER",
    series: "price",
    calcParams: [20, 2],
    keys: ["lower", "middle", "upper"],
    calculate: (d, p) =>
      ta.kc(
        values(d, "high"),
        values(d, "low"),
        values(d, "close"),
        param(p, 0, 20),
        param(p, 1, 2),
      ),
  },
  {
    name: "MFI",
    series: "normal",
    calcParams: [14],
    keys: ["mfi"],
    calculate: (d, p) =>
      one(
        ta.mfi(values(d, "high"), values(d, "low"), values(d, "close"), volume(d), param(p, 0, 14)),
      ),
  },
  {
    name: "SUPER_TREND",
    series: "price",
    calcParams: [10, 3],
    keys: ["trend"],
    calculate: superTrend,
  },
  {
    name: "HMA",
    series: "price",
    calcParams: [20],
    keys: ["hma"],
    calculate: (d, p) => one(ta.hma(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "DEMA",
    series: "price",
    calcParams: [20],
    keys: ["dema"],
    calculate: (d, p) => one(ta.dema(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "TEMA",
    series: "price",
    calcParams: [20],
    keys: ["tema"],
    calculate: (d, p) => one(ta.tema(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "WMA",
    series: "price",
    calcParams: [20],
    keys: ["wma"],
    calculate: (d, p) => one(ta.wma(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "VWMA",
    series: "price",
    calcParams: [20],
    keys: ["vwma"],
    calculate: (d, p) => one(ta.vwma(values(d, "close"), volume(d), param(p, 0, 20))),
  },
  {
    name: "CMF",
    series: "normal",
    calcParams: [20],
    keys: ["cmf"],
    calculate: (d, p) =>
      one(
        ta.cmf(values(d, "high"), values(d, "low"), values(d, "close"), volume(d), param(p, 0, 20)),
      ),
  },
  {
    name: "CHAIKIN_OSC",
    series: "normal",
    calcParams: [3, 10],
    keys: ["osc"],
    calculate: (d, p) =>
      one(
        ta.adosc(
          values(d, "high"),
          values(d, "low"),
          values(d, "close"),
          volume(d),
          param(p, 0, 3),
          param(p, 1, 10),
        ),
      ),
  },
  {
    name: "KST",
    series: "normal",
    calcParams: [10, 15, 20, 30, 10, 10, 10, 15],
    keys: ["kst", "signal"],
    calculate: (d, p) =>
      ta.kst(
        values(d, "close"),
        ...([10, 15, 20, 30, 10, 10, 10, 15].map((fallback, index) =>
          param(p, index, fallback),
        ) as [number, number, number, number, number, number, number, number]),
      ),
  },
  {
    name: "ULTIMATE_OSC",
    series: "normal",
    calcParams: [7, 14, 28],
    keys: ["uo"],
    calculate: (d, p) =>
      one(
        ta.ultosc(
          values(d, "high"),
          values(d, "low"),
          values(d, "close"),
          param(p, 0, 7),
          param(p, 1, 14),
          param(p, 2, 28),
        ),
      ),
  },
  {
    name: "STDDEV",
    series: "normal",
    calcParams: [20],
    keys: ["stddev"],
    calculate: (d, p) => one(ta.stddev(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "ENVELOPE",
    series: "price",
    calcParams: [20, 2],
    keys: ["lower", "middle", "upper"],
    calculate: envelope,
  },
  {
    name: "RVI",
    series: "normal",
    calcParams: [14, 10],
    keys: ["rvi"],
    calculate: (d, p) => one(ta.rvi(values(d, "close"), param(p, 0, 14), param(p, 1, 10))),
  },
  {
    name: "SMI",
    series: "normal",
    calcParams: [14, 3, 3],
    keys: ["smi"],
    calculate: (d, p) =>
      one(
        ta.smi(
          values(d, "high"),
          values(d, "low"),
          values(d, "close"),
          param(p, 0, 14),
          param(p, 1, 3),
          param(p, 2, 3),
        ),
      ),
  },
  {
    name: "TSI",
    series: "normal",
    calcParams: [25, 13],
    keys: ["tsi"],
    calculate: (d, p) => one(ta.tsi(values(d, "close"), param(p, 0, 25), param(p, 1, 13))),
  },
  {
    name: "MOMENTUM",
    series: "normal",
    calcParams: [10],
    keys: ["momentum"],
    calculate: (d, p) => one(ta.mom(values(d, "close"), param(p, 0, 10))),
  },
  {
    name: "DPO",
    series: "normal",
    calcParams: [20],
    keys: ["dpo"],
    calculate: (d, p) => one(ta.dpo(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "FORCE_INDEX",
    series: "normal",
    calcParams: [13],
    keys: ["force"],
    calculate: (d, p) => one(ta.fi(values(d, "close"), volume(d), param(p, 0, 13))),
  },
  {
    name: "HIST_VOL",
    series: "normal",
    calcParams: [20],
    keys: ["volatility"],
    calculate: (d, p) => one(ta.volatility(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "BOLL_PERCENT_B",
    series: "normal",
    calcParams: [20, 2],
    keys: ["percentB"],
    calculate: (d, p) => bollDerived(d, p, "percent"),
  },
  {
    name: "BOLL_WIDTH",
    series: "normal",
    calcParams: [20, 2],
    keys: ["width"],
    calculate: (d, p) => bollDerived(d, p, "width"),
  },
  {
    name: "ACC_DIST",
    series: "normal",
    calcParams: [],
    keys: ["ad"],
    calculate: (d) =>
      one(ta.ad(values(d, "high"), values(d, "low"), values(d, "close"), volume(d))),
  },
  {
    name: "AROON_OSC",
    series: "normal",
    calcParams: [14],
    keys: ["osc"],
    calculate: (d, p) => one(ta.aroonosc(values(d, "high"), values(d, "low"), param(p, 0, 14))),
  },
  {
    name: "APO",
    series: "normal",
    calcParams: [12, 26],
    keys: ["apo"],
    calculate: (d, p) => one(ta.apo(values(d, "close"), param(p, 0, 12), param(p, 1, 26))),
  },
  {
    name: "AVG_PRICE",
    series: "price",
    calcParams: [],
    keys: ["average"],
    calculate: (d) =>
      one(ta.avgprice(values(d, "open"), values(d, "high"), values(d, "low"), values(d, "close"))),
  },
  {
    name: "BOP",
    series: "normal",
    calcParams: [],
    keys: ["bop"],
    calculate: (d) =>
      one(ta.bop(values(d, "open"), values(d, "high"), values(d, "low"), values(d, "close"))),
  },
  {
    name: "CMO",
    series: "normal",
    calcParams: [14],
    keys: ["cmo"],
    calculate: (d, p) => one(ta.cmo(values(d, "close"), param(p, 0, 14))),
  },
  {
    name: "CHAIKIN_VOL",
    series: "normal",
    calcParams: [10],
    keys: ["volatility"],
    calculate: (d, p) => one(ta.cvi(values(d, "high"), values(d, "low"), param(p, 0, 10))),
  },
  {
    name: "FISHER",
    series: "normal",
    calcParams: [10],
    keys: ["fisher", "signal"],
    calculate: (d, p) => ta.fisher(values(d, "high"), values(d, "low"), param(p, 0, 10)),
  },
  {
    name: "KAMA",
    series: "price",
    calcParams: [20],
    keys: ["kama"],
    calculate: (d, p) => one(ta.kama(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "KVO",
    series: "normal",
    calcParams: [34, 55],
    keys: ["kvo"],
    calculate: (d, p) =>
      one(
        ta.kvo(
          values(d, "high"),
          values(d, "low"),
          values(d, "close"),
          volume(d),
          param(p, 0, 34),
          param(p, 1, 55),
        ),
      ),
  },
  {
    name: "LINREG",
    series: "price",
    calcParams: [20],
    keys: ["curve"],
    calculate: (d, p) => one(ta.linreg(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "LINREG_SLOPE",
    series: "normal",
    calcParams: [20],
    keys: ["slope"],
    calculate: (d, p) => one(ta.linregslope(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "MASS_INDEX",
    series: "normal",
    calcParams: [25],
    keys: ["mass"],
    calculate: (d, p) => one(ta.mass(values(d, "high"), values(d, "low"), param(p, 0, 25))),
  },
  {
    name: "MEDIAN_PRICE",
    series: "price",
    calcParams: [],
    keys: ["median"],
    calculate: (d) => one(ta.medprice(values(d, "high"), values(d, "low"))),
  },
  {
    name: "NATR",
    series: "normal",
    calcParams: [14],
    keys: ["natr"],
    calculate: (d, p) =>
      one(ta.natr(values(d, "high"), values(d, "low"), values(d, "close"), param(p, 0, 14))),
  },
  {
    name: "NVI",
    series: "normal",
    calcParams: [],
    keys: ["nvi"],
    calculate: (d) => one(ta.nvi(values(d, "close"), volume(d))),
  },
  {
    name: "PPO",
    series: "normal",
    calcParams: [12, 26],
    keys: ["ppo"],
    calculate: (d, p) => one(ta.ppo(values(d, "close"), param(p, 0, 12), param(p, 1, 26))),
  },
  {
    name: "PVI",
    series: "normal",
    calcParams: [],
    keys: ["pvi"],
    calculate: (d) => one(ta.pvi(values(d, "close"), volume(d))),
  },
  {
    name: "QSTICK",
    series: "normal",
    calcParams: [14],
    keys: ["qstick"],
    calculate: (d, p) => one(ta.qstick(values(d, "open"), values(d, "close"), param(p, 0, 14))),
  },
  {
    name: "STOCHASTIC",
    series: "normal",
    calcParams: [14, 3, 3],
    keys: ["k", "d"],
    calculate: (d, p) =>
      ta.stoch(
        values(d, "high"),
        values(d, "low"),
        values(d, "close"),
        param(p, 0, 14),
        param(p, 1, 3),
        param(p, 2, 3),
      ),
  },
  {
    name: "TRUE_RANGE",
    series: "normal",
    calcParams: [],
    keys: ["tr"],
    calculate: (d) => one(ta.tr(values(d, "high"), values(d, "low"), values(d, "close"))),
  },
  {
    name: "TRIMA",
    series: "price",
    calcParams: [20],
    keys: ["trima"],
    calculate: (d, p) => one(ta.trima(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "TYPICAL_PRICE",
    series: "price",
    calcParams: [],
    keys: ["typical"],
    calculate: (d) => one(ta.typprice(values(d, "high"), values(d, "low"), values(d, "close"))),
  },
  {
    name: "VHF",
    series: "normal",
    calcParams: [28],
    keys: ["vhf"],
    calculate: (d, p) => one(ta.vhf(values(d, "close"), param(p, 0, 28))),
  },
  {
    name: "VIDYA",
    series: "price",
    calcParams: [9, 30, 0.2],
    keys: ["vidya"],
    calculate: (d, p) =>
      one(ta.vidya(values(d, "close"), param(p, 0, 9), param(p, 1, 30), param(p, 2, 0.2))),
  },
  {
    name: "VOLUME_OSC",
    series: "normal",
    calcParams: [5, 10],
    keys: ["osc"],
    calculate: (d, p) => one(ta.vosc(volume(d), param(p, 0, 5), param(p, 1, 10))),
  },
  {
    name: "WAD",
    series: "normal",
    calcParams: [],
    keys: ["wad"],
    calculate: (d) => one(ta.wad(values(d, "high"), values(d, "low"), values(d, "close"))),
  },
  {
    name: "WEIGHTED_CLOSE",
    series: "price",
    calcParams: [],
    keys: ["price"],
    calculate: (d) => one(ta.wcprice(values(d, "high"), values(d, "low"), values(d, "close"))),
  },
  {
    name: "WILDERS",
    series: "price",
    calcParams: [14],
    keys: ["wilders"],
    calculate: (d, p) => one(ta.wilders(values(d, "close"), param(p, 0, 14))),
  },
  {
    name: "ZLEMA",
    series: "price",
    calcParams: [20],
    keys: ["zlema"],
    calculate: (d, p) => one(ta.zlema(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "ALMA",
    series: "price",
    calcParams: [20, 0.85, 6],
    keys: ["alma"],
    calculate: (d, p) =>
      one(ta.alma(values(d, "close"), param(p, 0, 20), param(p, 1, 0.85), param(p, 2, 6))),
  },
  {
    name: "CHANDELIER_EXIT",
    series: "price",
    calcParams: [22, 3],
    keys: ["long", "short"],
    calculate: (d, p) =>
      ta.ce(
        values(d, "high"),
        values(d, "low"),
        values(d, "close"),
        param(p, 0, 22),
        param(p, 1, 3),
      ),
  },
  {
    name: "PFE",
    series: "normal",
    calcParams: [10, 5],
    keys: ["pfe"],
    calculate: (d, p) => one(ta.pfe(values(d, "close"), param(p, 0, 10), param(p, 1, 5))),
  },
  {
    name: "RMI",
    series: "normal",
    calcParams: [14, 5],
    keys: ["rmi"],
    calculate: (d, p) => one(ta.rmi(values(d, "close"), param(p, 0, 14), param(p, 1, 5))),
  },
  {
    name: "GMMA",
    series: "price",
    calcParams: [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60],
    keys: ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11", "e12"],
    calculate: (d, p) => p.map((period) => ta.ema(values(d, "close"), period)),
  },
  { name: "MCGINLEY", series: "price", calcParams: [14], keys: ["mcginley"], calculate: mcGinley },
  {
    name: "VORTEX",
    series: "normal",
    calcParams: [14],
    keys: ["plus", "minus"],
    calculate: vortex,
  },
  {
    name: "NET_VOLUME",
    series: "normal",
    calcParams: [],
    keys: ["net"],
    calculate: (d) =>
      one(
        d.map((candle, index) =>
          index === 0 ? 0 : Math.sign(candle.close - d[index - 1].close) * (candle.volume ?? 0),
        ),
      ),
  },
  {
    name: "WEEK_52_HIGH",
    series: "price",
    calcParams: [252],
    keys: ["high"],
    calculate: rollingHigh,
  },
  {
    name: "PIVOT_POINTS",
    series: "price",
    calcParams: [],
    keys: ["pivot", "r1", "s1"],
    calculate: pivotPoints,
  },
  { name: "ZIGZAG", series: "price", calcParams: [5], keys: ["zigzag"], calculate: zigZag },
  {
    name: "PRICE_CHANNEL",
    series: "price",
    calcParams: [20],
    keys: ["upper", "middle", "lower"],
    calculate: (d, p) => ta.dc(values(d, "high"), values(d, "low"), param(p, 0, 20)),
  },
  {
    name: "ACCELERATOR_OSC",
    series: "normal",
    calcParams: [5],
    keys: ["ac"],
    calculate: accelerator,
  },
  {
    name: "RANK_CORRELATION",
    series: "normal",
    calcParams: [12],
    keys: ["rci"],
    calculate: rankCorrelation,
  },
  {
    name: "STANDARD_ERROR",
    series: "normal",
    calcParams: [20],
    keys: ["stderr"],
    calculate: (d, p) => one(ta.stderr(values(d, "close"), param(p, 0, 20))),
  },
  {
    name: "STANDARD_ERROR_BANDS",
    series: "price",
    calcParams: [20, 2],
    keys: ["lower", "middle", "upper"],
    calculate: standardErrorBands,
  },
  {
    name: "CONNORS_RSI",
    series: "normal",
    calcParams: [3, 2, 100],
    keys: ["connors"],
    calculate: connorsRsi,
  },
];

const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));
export const EXTENDED_INDICATOR_NAMES = definitions.map((definition) => definition.name);

export function calculateExtendedIndicator(
  name: ChartIndicator,
  dataList: KLineData[],
  params?: number[],
): Array<Record<string, number | null>> {
  const definition = definitionByName.get(name);
  if (!definition) throw new Error(`확장 지표 계산기를 찾을 수 없습니다: ${name}`);
  const series = definition.calculate(dataList, params ?? definition.calcParams);
  const aligned = series.map((item) => align(dataList.length, item));
  return dataList.map((_, index) =>
    Object.fromEntries(
      definition.keys.map((key, keyIndex) => [key, aligned[keyIndex]?.[index] ?? null]),
    ),
  );
}

let registered = false;

export function registerExtendedIndicators(module: typeof import("klinecharts")): void {
  if (registered) return;
  for (const definition of definitions) {
    module.registerIndicator<Record<string, number | null>>({
      name: definition.name,
      shortName: definition.name,
      series: definition.series,
      precision: 4,
      shouldOhlc: definition.series === "price",
      calcParams: definition.calcParams,
      figures: definition.keys.map((key) => ({
        key,
        title: `${key.toUpperCase()}: `,
        type: "line",
      })),
      calc: (dataList, indicator) => {
        try {
          return calculateExtendedIndicator(
            definition.name,
            dataList,
            indicator.calcParams.map(Number),
          );
        } catch {
          return dataList.map(() => Object.fromEntries(definition.keys.map((key) => [key, null])));
        }
      },
    });
  }
  registered = true;
}
