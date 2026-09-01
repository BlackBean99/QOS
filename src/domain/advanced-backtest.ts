import { getIntradayFixture, type IntradayFixture } from "../fixtures/intraday";
import type { Candle } from "../fixtures/markets";
import {
  ResearchStrategySchema,
  type ResearchExit,
  type ResearchEntryFilter,
  type ResearchStrategy,
} from "./advanced-strategy";
import { atr, ema, ichimoku, rollingSessionVwap, stochasticRsi, wilderRsi } from "./indicators";
import { calculateExtendedIndicator } from "../components/market-chart/extended-indicators";

export interface ResearchTrade {
  status: "CLOSED" | "OPEN";
  entrySignalAt: string;
  entryAt: string;
  entryPrice: number;
  exitSignalAt?: string;
  exitAt?: string;
  exitPrice?: number;
  pnl?: number;
  returnPercent?: number;
  holdingMinutes: number;
  mfePercent: number;
  maePercent: number;
  exitReason?: string;
}

export interface ResearchRun {
  exit: ResearchExit;
  label: string;
  metrics: {
    totalReturnPercent: number;
    annualizedReturnPercent: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    profitFactor: number | null;
    winRatePercent: number;
    averageWinPercent: number;
    averageLossPercent: number;
    averageHoldingMinutes: number;
    averageMfePercent: number;
    averageMaePercent: number;
    trades: number;
    initialCapital: number;
    endingEquity: number;
    grossProfit: number;
    grossLoss: number;
  };
  trades: ResearchTrade[];
  exitOverlays: Array<{
    label: string;
    values: Array<number | null>;
  }>;
}

export interface ResearchComparisonResult {
  strategy: ResearchStrategy;
  market: ReturnType<typeof getIntradayFixture>["meta"];
  timeframe: "5m";
  period: { start: string; end: string; bars: number; sessions: number };
  costs: { commissionBps: number; slippageBps: number };
  runs: ResearchRun[];
  chart: {
    candles: Candle[];
    overlays: {
      vwap: Array<{ date: string; value: number | null }>;
      emaFast: Array<{ date: string; value: number | null }>;
      emaSlow: Array<{ date: string; value: number | null }>;
      ichimoku: Array<{
        date: string;
        tenkan: number | null;
        kijun: number | null;
        spanA: number | null;
        spanB: number | null;
      }>;
      stochasticRsi: Array<{ date: string; value: number | null }>;
    };
  };
  assumptions: string[];
}

const COMMISSION_BPS = 1.5;
const SLIPPAGE_BPS = 5;
const COMMISSION = COMMISSION_BPS / 10_000;
const SLIPPAGE = SLIPPAGE_BPS / 10_000;

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function researchExitLabel(exit: ResearchExit): string {
  switch (exit.kind) {
    case "ichimoku_kijun_cross_below":
      return `일목 기준선 ${exit.period}`;
    case "vwap_confirm_below":
      return `VWAP ${exit.sessionLookback}D 하향 ${exit.confirmationBars}봉 확인`;
    case "atr_trailing":
      return `ATR ${exit.period} × ${exit.multiplier} · 초기 ${exit.initialMultiplier} ATR`;
    case "chandelier":
      return `Chandelier ${exit.period} × ${exit.multiplier} · 초기 ${exit.initialMultiplier} ATR`;
    case "ema_cross_below":
      return `EMA ${exit.fastPeriod}/${exit.slowPeriod}`;
    case "fixed_trailing":
      return `고점 대비 −${exit.percent}%`;
  }
}

interface IndicatorBundle {
  entryVwap: Array<number | null>;
  vwapByLookback: Map<number, Array<number | null>>;
  atrByPeriod: Map<number, Array<number | null>>;
  emaByPeriod: Map<number, Array<number | null>>;
  ichimokuByKijun: Map<number, ReturnType<typeof ichimoku>>;
  stochasticRsi: Array<number | null>;
  rsiByPeriod: Map<number, Array<number | null>>;
  generic: Map<string, Array<number | null>>;
}

function genericIndicatorKey(filter: Extract<ResearchEntryFilter, { indicator: string }>): string {
  return JSON.stringify({
    indicator: filter.indicator,
    params: filter.params,
    source: filter.source,
  });
}

function macdSeries(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): { line: Array<number | null>; signal: Array<number | null> } {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const line = closes.map((_, index) =>
    fast[index] === null || slow[index] === null ? null : fast[index]! - slow[index]!,
  );
  const values = line.map((value) => value ?? 0);
  const signalRaw = ema(values, signalPeriod);
  const signal = signalRaw.map((value, index) => (line[index] === null ? null : value));
  return { line, signal };
}

function entryFiltersPass(
  filters: ResearchEntryFilter[],
  logic: "all" | "any",
  candles: Candle[],
  indicators: IndicatorBundle,
  index: number,
): boolean {
  if (filters.length === 0) return true;
  const values = filters.map((filter) => {
    if (filter.kind === "rsi_above" || filter.kind === "rsi_below") {
      const current = indicators.rsiByPeriod.get(filter.period)?.[index] ?? null;
      return current === null
        ? false
        : filter.kind === "rsi_above"
          ? current > filter.value
          : current < filter.value;
    }
    if ("indicator" in filter) {
      const series = indicators.generic.get(genericIndicatorKey(filter));
      const current = series?.[index] ?? null;
      const previous = series?.[index - 1] ?? null;
      if (current === null || previous === null) return false;
      if (filter.kind === "indicator_above") return current > filter.value;
      if (filter.kind === "indicator_below") return current < filter.value;
      return filter.kind === "indicator_cross_above"
        ? previous <= filter.value && current > filter.value
        : previous >= filter.value && current < filter.value;
    }
    const fast = indicators.emaByPeriod.get(filter.fastPeriod)?.[index];
    const slow = indicators.emaByPeriod.get(filter.slowPeriod)?.[index];
    const priorFast = indicators.emaByPeriod.get(filter.fastPeriod)?.[index - 1];
    const priorSlow = indicators.emaByPeriod.get(filter.slowPeriod)?.[index - 1];
    if (
      fast === undefined ||
      slow === undefined ||
      priorFast === undefined ||
      priorSlow === undefined ||
      fast === null ||
      slow === null ||
      priorFast === null ||
      priorSlow === null
    )
      return false;
    if (filter.kind === "ema_cross_above") return priorFast <= priorSlow && fast > slow;
    const currentMacd = macdSeries(
      candles.map((item) => item.close),
      filter.fastPeriod,
      filter.slowPeriod,
      filter.signalPeriod,
    );
    const previousMacd = macdSeries(
      candles.slice(0, index).map((item) => item.close),
      filter.fastPeriod,
      filter.slowPeriod,
      filter.signalPeriod,
    );
    const line = currentMacd.line[index];
    const signal = currentMacd.signal[index];
    const priorLine = previousMacd.line.at(-1);
    const priorSignal = previousMacd.signal.at(-1);
    if (
      line === null ||
      signal === null ||
      priorLine === null ||
      priorLine === undefined ||
      priorSignal === null ||
      priorSignal === undefined
    )
      return false;
    return filter.kind === "macd_cross_above"
      ? priorLine <= priorSignal && line > signal
      : priorLine >= priorSignal && line < signal;
  });
  return logic === "all" ? values.every(Boolean) : values.some(Boolean);
}

function atrTrailingStop(
  exit: Extract<ResearchExit, { kind: "atr_trailing" }>,
  indicators: IndicatorBundle,
  index: number,
  position: { entryPrice: number; entryIndex: number; peak: number },
): number | null {
  const currentAtr = indicators.atrByPeriod.get(exit.period)?.[index] ?? null;
  const entryAtr = indicators.atrByPeriod.get(exit.period)?.[position.entryIndex] ?? null;
  if (currentAtr === null || entryAtr === null) return null;
  return Math.max(
    position.entryPrice - entryAtr * exit.initialMultiplier,
    position.peak - currentAtr * exit.multiplier,
  );
}

function chandelierStop(
  exit: Extract<ResearchExit, { kind: "chandelier" }>,
  candles: Candle[],
  indicators: IndicatorBundle,
  index: number,
  position: { entryPrice: number; entryIndex: number },
): number | null {
  const currentAtr = indicators.atrByPeriod.get(exit.period)?.[index] ?? null;
  const entryAtr = indicators.atrByPeriod.get(exit.period)?.[position.entryIndex] ?? null;
  if (currentAtr === null || entryAtr === null) return null;
  const start = Math.max(position.entryIndex, index - exit.period + 1);
  const highest = Math.max(...candles.slice(start, index + 1).map((item) => item.high));
  return Math.max(
    position.entryPrice - entryAtr * exit.initialMultiplier,
    highest - currentAtr * exit.multiplier,
  );
}

function exitSignal(
  exit: ResearchExit,
  candles: Candle[],
  indicators: IndicatorBundle,
  index: number,
  position: { entryPrice: number; entryIndex: number; peak: number },
): string | null {
  const candle = candles[index];
  switch (exit.kind) {
    case "ichimoku_kijun_cross_below": {
      const series = indicators.ichimokuByKijun.get(exit.period);
      const current = series?.[index].kijun ?? null;
      const previous = series?.[index - 1]?.kijun ?? null;
      if (
        current !== null &&
        previous !== null &&
        candles[index - 1].close >= previous &&
        candle.close < current
      ) {
        return `Close가 Ichimoku Kijun(${exit.period}) 아래로 교차`;
      }
      return null;
    }
    case "vwap_confirm_below": {
      if (index < exit.confirmationBars - 1) return null;
      const series = indicators.vwapByLookback.get(exit.sessionLookback);
      if (!series) return null;
      const confirmed = Array.from({ length: exit.confirmationBars }, (_, offset) => index - offset)
        .map((cursor) => ({ close: candles[cursor].close, vwap: series[cursor] }))
        .every(({ close, vwap }) => vwap !== null && close < vwap);
      return confirmed ? `VWAP 아래 종가 ${exit.confirmationBars}봉 연속 확인` : null;
    }
    case "atr_trailing": {
      const stop = atrTrailingStop(exit, indicators, index, position);
      if (stop === null) return null;
      return candle.close <= stop ? `ATR trailing stop ${round(stop, 2)}` : null;
    }
    case "chandelier": {
      const stop = chandelierStop(exit, candles, indicators, index, position);
      if (stop === null) return null;
      return candle.close <= stop ? `Chandelier exit ${round(stop, 2)}` : null;
    }
    case "ema_cross_below": {
      const fast = indicators.emaByPeriod.get(exit.fastPeriod);
      const slow = indicators.emaByPeriod.get(exit.slowPeriod);
      const currentFast = fast?.[index] ?? null;
      const currentSlow = slow?.[index] ?? null;
      const priorFast = fast?.[index - 1] ?? null;
      const priorSlow = slow?.[index - 1] ?? null;
      return currentFast !== null &&
        currentSlow !== null &&
        priorFast !== null &&
        priorSlow !== null &&
        priorFast >= priorSlow &&
        currentFast < currentSlow
        ? `EMA ${exit.fastPeriod}/${exit.slowPeriod} 하향 교차`
        : null;
    }
    case "fixed_trailing": {
      const stop = position.peak * (1 - exit.percent / 100);
      return candle.close <= stop ? `최고가 대비 −${exit.percent}% trailing` : null;
    }
  }
}

function exitGuideLabels(exit: ResearchExit): string[] {
  switch (exit.kind) {
    case "ichimoku_kijun_cross_below":
    case "vwap_confirm_below":
    case "atr_trailing":
    case "chandelier":
    case "fixed_trailing":
      return [researchExitLabel(exit)];
    case "ema_cross_below":
      return [`EMA ${exit.fastPeriod}`, `EMA ${exit.slowPeriod}`];
  }
}

function exitGuideValues(
  exit: ResearchExit,
  candles: Candle[],
  indicators: IndicatorBundle,
  index: number,
  position: { entryPrice: number; entryIndex: number; peak: number } | null,
): Array<number | null> {
  switch (exit.kind) {
    case "ichimoku_kijun_cross_below":
      return [indicators.ichimokuByKijun.get(exit.period)?.[index].kijun ?? null];
    case "vwap_confirm_below":
      return [indicators.vwapByLookback.get(exit.sessionLookback)?.[index] ?? null];
    case "atr_trailing":
      return [position ? atrTrailingStop(exit, indicators, index, position) : null];
    case "chandelier":
      return [position ? chandelierStop(exit, candles, indicators, index, position) : null];
    case "ema_cross_below":
      return [
        indicators.emaByPeriod.get(exit.fastPeriod)?.[index] ?? null,
        indicators.emaByPeriod.get(exit.slowPeriod)?.[index] ?? null,
      ];
    case "fixed_trailing":
      return [position ? position.peak * (1 - exit.percent / 100) : null];
  }
}

function calculateSharpe(equity: number[]): number {
  if (equity.length < 3) return 0;
  const returns = equity.slice(1).map((value, index) => value / equity[index] - 1);
  const mean = average(returns);
  const deviation = Math.sqrt(average(returns.map((value) => (value - mean) ** 2)));
  return deviation === 0 ? 0 : (mean / deviation) * Math.sqrt(252 * 78);
}

function runExit(
  strategy: ResearchStrategy,
  exit: ResearchExit,
  candles: Candle[],
  indicators: IndicatorBundle,
): ResearchRun {
  const initialCapital = strategy.market === "KOSPI" ? 10_000_000 : 100_000;
  let cash = initialCapital;
  let peakEquity = initialCapital;
  let pending:
    | { kind: "BUY"; signalIndex: number }
    | { kind: "SELL"; signalIndex: number; reason: string }
    | null = null;
  let position: {
    quantity: number;
    entryPrice: number;
    entryCost: number;
    entryIndex: number;
    signalIndex: number;
    peak: number;
    trough: number;
  } | null = null;
  const trades: ResearchTrade[] = [];
  const equityCurve: Array<{ date: string; equity: number; drawdownPercent: number }> = [];
  const guideLabels = exitGuideLabels(exit);
  const guideValues = guideLabels.map((): Array<number | null> => Array(candles.length).fill(null));

  for (const [index, candle] of candles.entries()) {
    if (pending?.kind === "BUY" && !position) {
      const entryPrice = candle.open * (1 + SLIPPAGE);
      const quantity = Math.floor(cash / (entryPrice * (1 + COMMISSION)));
      if (quantity > 0) {
        const entryCost = quantity * entryPrice * (1 + COMMISSION);
        cash -= entryCost;
        position = {
          quantity,
          entryPrice,
          entryCost,
          entryIndex: index,
          signalIndex: pending.signalIndex,
          peak: candle.high,
          trough: candle.low,
        };
      }
      pending = null;
    } else if (pending?.kind === "SELL" && position) {
      const exitPrice = candle.open * (1 - SLIPPAGE);
      const proceeds = position.quantity * exitPrice * (1 - COMMISSION);
      const pnl = proceeds - position.entryCost;
      cash += proceeds;
      const returnPercent = (proceeds / position.entryCost - 1) * 100;
      trades.push({
        status: "CLOSED",
        entrySignalAt: candles[position.signalIndex].date,
        entryAt: candles[position.entryIndex].date,
        entryPrice: round(position.entryPrice, 4),
        exitSignalAt: candles[pending.signalIndex].date,
        exitAt: candle.date,
        exitPrice: round(exitPrice, 4),
        pnl: round(pnl, 4),
        returnPercent: round(returnPercent),
        holdingMinutes: (index - position.entryIndex) * 5,
        mfePercent: round((position.peak / position.entryPrice - 1) * 100),
        maePercent: round((position.trough / position.entryPrice - 1) * 100),
        exitReason: pending.reason,
      });
      position = null;
      pending = null;
    }

    if (position) {
      position.peak = Math.max(position.peak, candle.high);
      position.trough = Math.min(position.trough, candle.low);
    }

    exitGuideValues(exit, candles, indicators, index, position).forEach((value, guideIndex) => {
      guideValues[guideIndex][index] = value;
    });

    const equity = cash + (position ? position.quantity * candle.close : 0);
    peakEquity = Math.max(peakEquity, equity);
    equityCurve.push({
      date: candle.date,
      equity: round(equity, 2),
      drawdownPercent: round(((equity - peakEquity) / peakEquity) * 100),
    });

    if (pending || index === 0 || index === candles.length - 1) continue;
    if (position) {
      const reason = exitSignal(exit, candles, indicators, index, position);
      if (reason) pending = { kind: "SELL", signalIndex: index, reason };
      continue;
    }
    const currentVwap = indicators.entryVwap[index];
    const previousVwap = indicators.entryVwap[index - 1];
    if (
      currentVwap !== null &&
      previousVwap !== null &&
      candles[index - 1].close <= previousVwap &&
      candle.close > currentVwap
    ) {
      if (
        entryFiltersPass(
          strategy.entry.filters,
          strategy.entry.filterLogic,
          candles,
          indicators,
          index,
        )
      ) {
        pending = { kind: "BUY", signalIndex: index };
      }
    }
  }

  if (position) {
    trades.push({
      status: "OPEN",
      entrySignalAt: candles[position.signalIndex].date,
      entryAt: candles[position.entryIndex].date,
      entryPrice: round(position.entryPrice, 4),
      holdingMinutes: (candles.length - 1 - position.entryIndex) * 5,
      mfePercent: round((position.peak / position.entryPrice - 1) * 100),
      maePercent: round((position.trough / position.entryPrice - 1) * 100),
    });
  }

  const endingEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const closed = trades.filter(
    (trade): trade is ResearchTrade & { returnPercent: number; pnl: number } =>
      trade.status === "CLOSED" && trade.pnl !== undefined,
  );
  const wins = closed.filter((trade) => trade.pnl > 0);
  const losses = closed.filter((trade) => trade.pnl < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const sessionCount = new Set(candles.map((candle) => candle.date.slice(0, 10))).size;

  return {
    exit,
    label: researchExitLabel(exit),
    trades,
    exitOverlays: guideLabels.map((label, guideIndex) => ({
      label,
      values: guideValues[guideIndex].slice(-780),
    })),
    metrics: {
      totalReturnPercent: round((endingEquity / initialCapital - 1) * 100),
      annualizedReturnPercent: round(
        (Math.pow(Math.max(endingEquity / initialCapital, 0.0001), 252 / sessionCount) - 1) * 100,
      ),
      maxDrawdownPercent: round(Math.min(...equityCurve.map((point) => point.drawdownPercent))),
      sharpeRatio: round(calculateSharpe(equityCurve.map((point) => point.equity))),
      profitFactor: grossLoss === 0 ? null : round(grossWin / grossLoss),
      winRatePercent: closed.length === 0 ? 0 : round((wins.length / closed.length) * 100),
      averageWinPercent: round(average(wins.map((trade) => trade.returnPercent))),
      averageLossPercent: round(average(losses.map((trade) => trade.returnPercent))),
      averageHoldingMinutes: round(average(closed.map((trade) => trade.holdingMinutes)), 1),
      averageMfePercent: round(average(closed.map((trade) => trade.mfePercent))),
      averageMaePercent: round(average(closed.map((trade) => trade.maePercent))),
      trades: closed.length,
      initialCapital,
      endingEquity,
      grossProfit: round(grossWin, 4),
      grossLoss: round(grossLoss, 4),
    },
  };
}

export function runResearchComparison(
  raw: ResearchStrategy,
  dataset?: IntradayFixture,
): ResearchComparisonResult {
  const strategy = ResearchStrategySchema.parse(raw);
  const fixture = dataset ?? getIntradayFixture(strategy.instrumentId);
  if (
    !fixture ||
    fixture.meta.instrumentId !== strategy.instrumentId ||
    fixture.meta.market !== strategy.market
  ) {
    throw new Error("전략과 시장 데이터 종목이 일치해야 합니다.");
  }
  const candles = fixture.candles;
  if (candles.length === 0) throw new Error("5분봉 시장 데이터가 없습니다.");
  const closes = candles.map((candle) => candle.close);
  const vwapLookbacks = new Set([
    strategy.entry.sessionLookback,
    ...strategy.exits
      .filter((exit) => exit.kind === "vwap_confirm_below")
      .map((exit) => exit.sessionLookback),
  ]);
  const atrPeriods = new Set(
    strategy.exits
      .filter((exit) => exit.kind === "atr_trailing" || exit.kind === "chandelier")
      .map((exit) => exit.period),
  );
  const emaPeriods = new Set(
    strategy.exits
      .filter((exit) => exit.kind === "ema_cross_below")
      .flatMap((exit) => [exit.fastPeriod, exit.slowPeriod]),
  );
  for (const filter of strategy.entry.filters) {
    if (filter.kind === "rsi_above" || filter.kind === "rsi_below") {
      // collected below
    } else if ("fastPeriod" in filter) {
      emaPeriods.add(filter.fastPeriod);
      emaPeriods.add(filter.slowPeriod);
    }
  }
  emaPeriods.add(9);
  emaPeriods.add(21);
  const kijunPeriods = new Set(
    strategy.exits
      .filter((exit) => exit.kind === "ichimoku_kijun_cross_below")
      .map((exit) => exit.period),
  );
  kijunPeriods.add(26);
  const vwapByLookback = new Map(
    [...vwapLookbacks].map((period) => [period, rollingSessionVwap(candles, period)]),
  );
  const atrByPeriod = new Map([...atrPeriods].map((period) => [period, atr(candles, period)]));
  const emaByPeriod = new Map([...emaPeriods].map((period) => [period, ema(closes, period)]));
  const rsiPeriods = new Set(
    strategy.entry.filters
      .filter((filter) => filter.kind === "rsi_above" || filter.kind === "rsi_below")
      .map((filter) => filter.period),
  );
  const rsiByPeriod = new Map([...rsiPeriods].map((period) => [period, wilderRsi(closes, period)]));
  const genericFilters = strategy.entry.filters.filter(
    (filter): filter is Extract<ResearchEntryFilter, { indicator: string }> =>
      "indicator" in filter,
  );
  const generic = new Map(
    genericFilters.map((filter) => {
      const dataList = candles.map((candle) => ({
        timestamp: Date.parse(candle.date),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }));
      const rows = calculateExtendedIndicator(filter.indicator, dataList, filter.params);
      return [genericIndicatorKey(filter), rows.map((row) => Object.values(row)[0] ?? null)];
    }),
  );
  const ichimokuByKijun = new Map(
    [...kijunPeriods].map((period) => [period, ichimoku(candles, 9, period, 52)]),
  );
  const indicators: IndicatorBundle = {
    entryVwap: vwapByLookback.get(strategy.entry.sessionLookback) ?? [],
    vwapByLookback,
    atrByPeriod,
    emaByPeriod,
    ichimokuByKijun,
    stochasticRsi: stochasticRsi(closes),
    rsiByPeriod,
    generic,
  };
  const chartStart = Math.max(0, candles.length - 780);
  const chartCandles = candles.slice(chartStart);
  const mapSeries = (values: Array<number | null>) =>
    chartCandles.map((candle, offset) => ({
      date: candle.date,
      value: values[chartStart + offset],
    }));

  return {
    strategy,
    market: fixture.meta,
    timeframe: fixture.timeframe,
    period: {
      start: candles[0].date,
      end: candles.at(-1)?.date ?? candles[0].date,
      bars: candles.length,
      sessions: new Set(candles.map((candle) => candle.date.slice(0, 10))).size,
    },
    costs: { commissionBps: COMMISSION_BPS, slippageBps: SLIPPAGE_BPS },
    runs: strategy.exits.map((exit) => runExit(strategy, exit, candles, indicators)),
    chart: {
      candles: chartCandles,
      overlays: {
        vwap: mapSeries(indicators.entryVwap),
        emaFast: mapSeries(indicators.emaByPeriod.get(9) ?? []),
        emaSlow: mapSeries(indicators.emaByPeriod.get(21) ?? []),
        ichimoku: chartCandles.map((candle, offset) => ({
          date: candle.date,
          ...(indicators.ichimokuByKijun.get(26)?.[chartStart + offset] ?? {
            tenkan: null,
            kijun: null,
            spanA: null,
            spanB: null,
          }),
        })),
        stochasticRsi: mapSeries(indicators.stochasticRsi),
      },
    },
    assumptions: [
      fixture.meta.synthetic
        ? "Synthetic 5-minute fixture; not actual market data or investment advice."
        : "TOSS adjusted 1-minute candles aggregated locally to 5 minutes; not investment advice.",
      `${strategy.entry.sessionLookback}-session VWAP uses typical price × volume up to the current bar; no future bar is included.`,
      "ATR and RSI use Wilder smoothing; Ichimoku cloud spans are displaced 26 bars forward.",
      `Signals are evaluated at bar close and filled at the next ${fixture.meta.synthetic ? "fixture " : ""}bar open with costs.`,
      "Annualized return uses 252 sessions; Sharpe uses 252 × 78 five-minute bars and zero risk-free rate.",
      "Open positions are marked at the final close and are not charged a hypothetical exit cost.",
      "Corporate actions, queue position, spread dynamics, halts and real exchange calendars are not modeled.",
    ],
  };
}
