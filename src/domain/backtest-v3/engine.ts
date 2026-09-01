import type { Candle } from "@/src/fixtures/markets";
import {
  IndicatorRegistry,
  type IndicatorRuntimeContext,
} from "@/src/domain/strategy-runtime/indicators";
import { evaluateRule, type GroupDecisionTrace } from "@/src/domain/strategy-runtime/rules";
import {
  applyBreakEven,
  applyScaleOut,
  calculateInitialStop,
  calculatePositionQuantity,
  createPositionState,
  updateTrailingStops,
  type PositionStateV3,
} from "./position";
import {
  StrategyDefinitionV3Schema,
  type ExitRule,
  type IndicatorOperand,
  type RuleGroup,
  type RuleNode,
  type StrategyDefinitionV3,
} from "@/src/domain/strategy-v3/schema";

export interface BacktestRuntimeOptionsV3 extends Omit<
  IndicatorRuntimeContext,
  "primaryTimeframe"
> {
  source: string;
  adjustedPrices: boolean;
  corporateActionPolicy?: string;
  missingCandlePolicy?: "SKIP_WITH_WARNING" | "FAIL";
}

export interface BacktestFillV3 {
  at: string;
  price: number;
  rawPrice: number;
  quantity: number;
  reason: string;
  ruleId: string;
  fee: number;
  slippageCost: number;
  grossPnl: number;
  netPnl: number;
  remainingQuantity: number;
  trace?: GroupDecisionTrace;
}

export interface BacktestTradeV3 {
  status: "CLOSED" | "OPEN";
  side: "LONG" | "SHORT";
  entrySignalAt: string;
  entryAt: string;
  entryPrice: number;
  entryReason: string;
  entryTrace: GroupDecisionTrace;
  positionSize: number;
  initialStop: number | null;
  exitAt?: string;
  exitPrice?: number;
  exitReason?: string;
  exitTrace?: GroupDecisionTrace;
  fills: BacktestFillV3[];
  grossPnl: number;
  fee: number;
  slippageCost: number;
  netPnl: number;
  returnPercent: number;
  rMultiple: number | null;
  holdingBars: number;
  holdingMinutes: number;
  mfePercent: number;
  maePercent: number;
  stopPath: Array<{ at: string; value: number; reason: string }>;
}

export interface BacktestMetricsV3 {
  totalReturnPercent: number;
  cagrPercent: number;
  maximumDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRatePercent: number;
  lossRatePercent: number;
  profitFactor: number | null;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  payoffRatio: number | null;
  averageRMultiple: number | null;
  numberOfTrades: number;
  averageHoldingPeriodBars: number;
  maximumConsecutiveWins: number;
  maximumConsecutiveLosses: number;
  exposurePercent: number;
  turnoverPercent: number;
  commissionCost: number;
  slippageCost: number;
  startingCapital: number;
  endingEquity: number;
}

export interface BacktestResultV3 {
  strategy: StrategyDefinitionV3;
  period: { start: string; end: string; bars: number };
  metrics: BacktestMetricsV3;
  trades: BacktestTradeV3[];
  equityCurve: Array<{ at: string; equity: number; drawdownPercent: number }>;
  rejectedSignals: Array<{ at: string; reason: string; trace?: GroupDecisionTrace }>;
  assumptions: string[];
  limitations: string[];
  dataPolicy: {
    source: string;
    adjustedPrices: boolean;
    corporateActions: string;
    missingCandles: string;
    marketTimeZone: string;
    session: string;
  };
}

interface OpenTrade {
  position: PositionStateV3;
  record: BacktestTradeV3;
  entryFee: number;
  entrySlippageCost: number;
  entrySignalIndex: number;
}

interface PendingEntry {
  signalIndex: number;
  trace: GroupDecisionTrace;
}

interface PendingExit {
  reason: string;
  ruleId: string;
  quantityPercent: number;
  trace?: GroupDecisionTrace;
}

interface PriceExitEvent {
  kind: "STOP" | "PROFIT";
  price: number;
  reason: string;
  ruleId: string;
  priority: number;
  quantityPercent: number;
}

const timeframeMinutes: Record<StrategyDefinitionV3["timeframe"], number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "4h": 240,
  "1d": 1_440,
  "1w": 10_080,
};

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function tickRound(value: number, tick: number, buying: boolean): number {
  const units = value / tick;
  return round((buying ? Math.ceil(units - 1e-10) : Math.floor(units + 1e-10)) * tick, 8);
}

function executionPrice(
  rawPrice: number,
  buying: boolean,
  strategy: StrategyDefinitionV3,
): { price: number; slippageCostPerUnit: number } {
  const bps = strategy.execution.slippageBps + strategy.execution.spreadBps / 2;
  const adjusted = rawPrice * (1 + ((buying ? 1 : -1) * bps) / 10_000);
  const price = tickRound(adjusted, strategy.execution.minimumTick, buying);
  return { price, slippageCostPerUnit: Math.abs(price - rawPrice) };
}

function distanceForUnit(
  entry: number,
  unit: "PERCENT" | "ABSOLUTE" | "TICK",
  value: number,
  tick: number,
): number {
  return unit === "PERCENT" ? (entry * value) / 100 : unit === "TICK" ? value * tick : value;
}

function atrOperand(strategy: StrategyDefinitionV3, period: number): IndicatorOperand {
  return { type: "INDICATOR", timeframe: strategy.timeframe, offset: 0, kind: "ATR", period };
}

function localMinute(timestamp: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(Date.parse(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function localDay(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(Date.parse(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseClock(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function mirrorNode(node: RuleNode): RuleNode {
  if (node.type === "GROUP") return { ...node, children: node.children.map(mirrorNode) };
  const mirrors = {
    GT: "LT",
    GTE: "LTE",
    LT: "GT",
    LTE: "GTE",
    EQ: "EQ",
    CROSS_ABOVE: "CROSS_BELOW",
    CROSS_BELOW: "CROSS_ABOVE",
    TOUCH: "TOUCH",
    BREAK_ABOVE: "BREAK_BELOW",
    BREAK_BELOW: "BREAK_ABOVE",
    BETWEEN: "BETWEEN",
  } as const;
  return { ...node, operator: mirrors[node.operator] };
}

function fillEntryOrder(
  pending: PendingEntry,
  candle: Candle,
  strategy: StrategyDefinitionV3,
  candles: Candle[],
): { rawPrice: number; price: number; slippageCostPerUnit: number } | null {
  const signalPrice = candles[pending.signalIndex].close;
  const order = strategy.execution.order;
  let rawPrice = candle.open;
  if (order.type !== "MARKET") {
    const distance =
      order.offsetUnit === "PERCENT"
        ? (signalPrice * order.offset) / 100
        : order.offset * strategy.execution.minimumTick;
    const trigger =
      strategy.side === "LONG"
        ? signalPrice + (order.type === "LIMIT" ? -distance : distance)
        : signalPrice + (order.type === "LIMIT" ? distance : -distance);
    const touched =
      order.type === "LIMIT"
        ? strategy.side === "LONG"
          ? candle.low <= trigger
          : candle.high >= trigger
        : strategy.side === "LONG"
          ? candle.high >= trigger
          : candle.low <= trigger;
    if (!touched) return null;
    if (order.type === "LIMIT")
      rawPrice =
        strategy.side === "LONG" ? Math.min(candle.open, trigger) : Math.max(candle.open, trigger);
    else
      rawPrice =
        strategy.side === "LONG" ? Math.max(candle.open, trigger) : Math.min(candle.open, trigger);
  }
  return { rawPrice, ...executionPrice(rawPrice, strategy.side === "LONG", strategy) };
}

function strongestStopReason(
  state: PositionStateV3,
  exits: ExitRule[],
): { reason: string; ruleId: string; priority: number; quantityPercent: number } {
  for (const [id, value] of Object.entries(state.trailingStops)) {
    if (value === state.protectiveStop) {
      const rule = exits.find(
        (exit) =>
          exit.id === id &&
          (exit.kind === "ATR_TRAILING" ||
            exit.kind === "CHANDELIER" ||
            exit.kind === "PERCENTAGE_TRAILING"),
      );
      if (rule && "quantityPercent" in rule)
        return {
          reason: rule.id,
          ruleId: rule.id,
          priority: rule.priority,
          quantityPercent: rule.quantityPercent,
        };
    }
  }
  const breakEven = exits.find(
    (exit) => exit.kind === "BREAK_EVEN" && state.triggeredExitIds.has(exit.id),
  );
  if (breakEven)
    return {
      reason: breakEven.id,
      ruleId: breakEven.id,
      priority: breakEven.priority,
      quantityPercent: 100,
    };
  const initial = exits
    .filter((exit) => exit.kind === "FIXED_STOP" || exit.kind === "ATR_STOP")
    .toSorted((a, b) => a.priority - b.priority)[0];
  return initial && "quantityPercent" in initial
    ? {
        reason: initial.id,
        ruleId: initial.id,
        priority: initial.priority,
        quantityPercent: initial.quantityPercent,
      }
    : { reason: "protective-stop", ruleId: "protective-stop", priority: 10, quantityPercent: 100 };
}

function priceExitEvents(
  openTrade: OpenTrade,
  candle: Candle,
  strategy: StrategyDefinitionV3,
): PriceExitEvent[] {
  const state = openTrade.position;
  const events: PriceExitEvent[] = [];
  if (state.protectiveStop !== null) {
    const touched =
      state.side === "LONG"
        ? candle.low <= state.protectiveStop
        : candle.high >= state.protectiveStop;
    if (touched)
      events.push({
        kind: "STOP",
        price: state.protectiveStop,
        ...strongestStopReason(state, strategy.exits),
      });
  }
  for (const exit of strategy.exits) {
    if (state.triggeredExitIds.has(exit.id)) continue;
    let target: number | null = null;
    const quantityPercent = "quantityPercent" in exit ? exit.quantityPercent : 100;
    if (exit.kind === "FIXED_TAKE_PROFIT") {
      const distance = distanceForUnit(
        state.entryPrice,
        exit.unit,
        exit.value,
        strategy.execution.minimumTick,
      );
      target = state.entryPrice + (state.side === "LONG" ? distance : -distance);
    } else if (exit.kind === "RISK_REWARD" && state.initialRiskPerUnit) {
      target =
        state.entryPrice +
        (state.side === "LONG" ? 1 : -1) * state.initialRiskPerUnit * exit.multiple;
    }
    if (target !== null) {
      const touched = state.side === "LONG" ? candle.high >= target : candle.low <= target;
      if (touched)
        events.push({
          kind: "PROFIT",
          price: target,
          reason: exit.id,
          ruleId: exit.id,
          priority: exit.priority,
          quantityPercent,
        });
    }
    if (exit.kind === "SCALE_OUT") {
      for (const level of exit.levels) {
        if (state.triggeredExitIds.has(level.id)) continue;
        const distance =
          level.trigger.kind === "PERCENT"
            ? (state.entryPrice * level.trigger.value) / 100
            : level.trigger.kind === "R_MULTIPLE"
              ? (state.initialRiskPerUnit ?? 0) * level.trigger.value
              : level.trigger.value;
        if (distance <= 0) continue;
        const levelPrice = state.entryPrice + (state.side === "LONG" ? distance : -distance);
        const touched =
          state.side === "LONG" ? candle.high >= levelPrice : candle.low <= levelPrice;
        if (touched)
          events.push({
            kind: "PROFIT",
            price: levelPrice,
            reason: level.id,
            ruleId: level.id,
            priority: exit.priority,
            quantityPercent: level.quantityPercent,
          });
      }
    }
  }
  const categoryOrder =
    strategy.execution.intrabarPolicy === "OPTIMISTIC"
      ? ["PROFIT", "STOP"]
      : strategy.execution.intrabarPolicy === "OPEN_HIGH_LOW_CLOSE"
        ? strategy.side === "LONG"
          ? ["PROFIT", "STOP"]
          : ["STOP", "PROFIT"]
        : strategy.execution.intrabarPolicy === "OPEN_LOW_HIGH_CLOSE"
          ? strategy.side === "LONG"
            ? ["STOP", "PROFIT"]
            : ["PROFIT", "STOP"]
          : ["STOP", "PROFIT"];
  return events.toSorted((left, right) => {
    const category = categoryOrder.indexOf(left.kind) - categoryOrder.indexOf(right.kind);
    if (category !== 0) return category;
    if (left.kind === "PROFIT" && left.price !== right.price)
      return strategy.side === "LONG" ? left.price - right.price : right.price - left.price;
    return left.priority - right.priority;
  });
}

function metrics(
  strategy: StrategyDefinitionV3,
  trades: BacktestTradeV3[],
  equityCurve: BacktestResultV3["equityCurve"],
  exposedBars: number,
  totalBars: number,
  turnover: number,
): BacktestMetricsV3 {
  const starting = strategy.execution.startingCapital;
  const ending = equityCurve.at(-1)?.equity ?? starting;
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const wins = closed.filter((trade) => trade.netPnl > 0);
  const losses = closed.filter((trade) => trade.netPnl < 0);
  const returns = equityCurve.slice(1).map((point, index) => {
    const previous = equityCurve[index].equity;
    return previous === 0 ? 0 : point.equity / previous - 1;
  });
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const deviation = returns.length
    ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length)
    : 0;
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length
    ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length)
    : 0;
  const periods =
    strategy.timeframe === "1d"
      ? 252
      : strategy.timeframe === "1w"
        ? 52
        : (252 * 390) / timeframeMinutes[strategy.timeframe];
  const years = Math.max(totalBars / periods, 1 / periods);
  const cagr = ending <= 0 ? -100 : ((ending / starting) ** (1 / years) - 1) * 100;
  let peak = starting;
  let maximumDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maximumDrawdown = Math.max(
      maximumDrawdown,
      peak === 0 ? 0 : ((peak - point.equity) / peak) * 100,
    );
  }
  const streak = (positive: boolean) => {
    let maximum = 0;
    let current = 0;
    for (const trade of closed) {
      if (trade.netPnl > 0 === positive && trade.netPnl !== 0) {
        current += 1;
        maximum = Math.max(maximum, current);
      } else current = 0;
    }
    return maximum;
  };
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? -grossLoss / losses.length : 0;
  const rValues = closed
    .map((trade) => trade.rMultiple)
    .filter((value): value is number => value !== null);
  return {
    totalReturnPercent: round((ending / starting - 1) * 100, 4),
    cagrPercent: round(cagr, 4),
    maximumDrawdownPercent: round(maximumDrawdown, 4),
    sharpeRatio: deviation === 0 ? 0 : round((mean / deviation) * Math.sqrt(periods), 4),
    sortinoRatio:
      downsideDeviation === 0 ? 0 : round((mean / downsideDeviation) * Math.sqrt(periods), 4),
    calmarRatio: maximumDrawdown === 0 ? 0 : round(cagr / maximumDrawdown, 4),
    winRatePercent: closed.length ? round((wins.length / closed.length) * 100, 4) : 0,
    lossRatePercent: closed.length ? round((losses.length / closed.length) * 100, 4) : 0,
    profitFactor:
      grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit / grossLoss, 4),
    expectancy: closed.length
      ? round(closed.reduce((sum, trade) => sum + trade.netPnl, 0) / closed.length, 4)
      : 0,
    averageWin: round(averageWin, 4),
    averageLoss: round(averageLoss, 4),
    payoffRatio: averageLoss === 0 ? null : round(averageWin / Math.abs(averageLoss), 4),
    averageRMultiple: rValues.length
      ? round(rValues.reduce((sum, value) => sum + value, 0) / rValues.length, 4)
      : null,
    numberOfTrades: closed.length,
    averageHoldingPeriodBars: closed.length
      ? round(closed.reduce((sum, trade) => sum + trade.holdingBars, 0) / closed.length, 2)
      : 0,
    maximumConsecutiveWins: streak(true),
    maximumConsecutiveLosses: streak(false),
    exposurePercent: totalBars ? round((exposedBars / totalBars) * 100, 4) : 0,
    turnoverPercent: round((turnover / starting) * 100, 4),
    commissionCost: round(
      trades.reduce((sum, trade) => sum + trade.fee, 0),
      4,
    ),
    slippageCost: round(
      trades.reduce((sum, trade) => sum + trade.slippageCost, 0),
      4,
    ),
    startingCapital: starting,
    endingEquity: round(ending, 4),
  };
}

export function runBacktestV3(
  input: StrategyDefinitionV3,
  candles: Candle[],
  runtime: BacktestRuntimeOptionsV3,
): BacktestResultV3 {
  const strategy = StrategyDefinitionV3Schema.parse(input);
  const registry = new IndicatorRegistry(candles, {
    ...runtime,
    primaryTimeframe: strategy.timeframe,
  });
  const trades: BacktestTradeV3[] = [];
  const rejectedSignals: BacktestResultV3["rejectedSignals"] = [];
  const equityCurve: BacktestResultV3["equityCurve"] = [];
  let openTrade: OpenTrade | null = null;
  let pendingEntry: PendingEntry | null = null;
  let pendingExit: PendingExit | null = null;
  let realizedNet = 0;
  let exposedBars = 0;
  let turnover = 0;
  let peakEquity = strategy.execution.startingCapital;
  let consecutiveLosses = 0;
  let activeDay = "";
  let sessionStartingEquity = strategy.execution.startingCapital;

  const closeQuantity = (
    event: PendingExit | PriceExitEvent,
    candle: Candle,
    rawPrice: number,
    trace?: GroupDecisionTrace,
  ) => {
    if (!openTrade) return;
    const state = openTrade.position;
    const quantity = applyScaleOut(state, event.ruleId, event.quantityPercent);
    if (quantity <= 0) return;
    const buying = state.side === "SHORT";
    const executed = executionPrice(rawPrice, buying, strategy);
    const grossPnl =
      (state.side === "LONG" ? 1 : -1) * (executed.price - state.entryPrice) * quantity;
    const fee = (executed.price * quantity * strategy.execution.commissionBps) / 10_000;
    const slippageCost = executed.slippageCostPerUnit * quantity;
    const netPnl = grossPnl - fee;
    state.realizedPnl += netPnl;
    realizedNet += netPnl;
    turnover += executed.price * quantity;
    const fill: BacktestFillV3 = {
      at: candle.date,
      price: executed.price,
      rawPrice,
      quantity,
      reason: event.reason,
      ruleId: event.ruleId,
      fee: round(fee),
      slippageCost: round(slippageCost),
      grossPnl: round(grossPnl),
      netPnl: round(netPnl),
      remainingQuantity: round(state.remainingQuantity),
      ...(trace ? { trace } : {}),
    };
    openTrade.record.fills.push(fill);
    openTrade.record.grossPnl = round(openTrade.record.grossPnl + grossPnl);
    openTrade.record.fee = round(openTrade.record.fee + fee);
    openTrade.record.slippageCost = round(openTrade.record.slippageCost + slippageCost);
    openTrade.record.netPnl = round(openTrade.record.grossPnl - openTrade.record.fee);
    if (state.remainingQuantity <= 1e-9) {
      const record = openTrade.record;
      record.status = "CLOSED";
      record.exitAt = candle.date;
      record.exitPrice = executed.price;
      record.exitReason = event.reason;
      record.exitTrace = trace;
      record.holdingBars = state.barsHeld;
      record.holdingMinutes = state.barsHeld * timeframeMinutes[strategy.timeframe];
      record.returnPercent = round(
        (record.netPnl / (record.entryPrice * record.positionSize)) * 100,
        4,
      );
      record.rMultiple = state.initialRiskPerUnit
        ? round(record.netPnl / (state.initialRiskPerUnit * state.initialQuantity), 4)
        : null;
      consecutiveLosses = record.netPnl < 0 ? consecutiveLosses + 1 : 0;
      openTrade = null;
    }
  };

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const candleDay = localDay(candle.date, runtime.marketTimeZone);
    if (candleDay !== activeDay) {
      activeDay = candleDay;
      sessionStartingEquity = strategy.execution.startingCapital + realizedNet;
    }
    if (pendingEntry && !openTrade) {
      const fill = fillEntryOrder(pendingEntry, candle, strategy, candles);
      if (fill) {
        const initialStop = calculateInitialStop(
          strategy.side,
          fill.price,
          strategy.exits,
          (period) => registry.value(atrOperand(strategy, period), pendingEntry!.signalIndex),
          strategy.execution.minimumTick,
        );
        const equity = strategy.execution.startingCapital + realizedNet;
        const quantity = calculatePositionQuantity({
          sizing: strategy.positionSizing,
          equity,
          entryPrice: fill.price,
          initialStop,
          maximumAllocationPercent: strategy.risk.maximumSymbolAllocationPercent,
        });
        if (quantity > 0) {
          const fee = (fill.price * quantity * strategy.execution.commissionBps) / 10_000;
          const slippageCost = fill.slippageCostPerUnit * quantity;
          realizedNet -= fee;
          turnover += fill.price * quantity;
          const position = createPositionState({
            side: strategy.side,
            entryPrice: fill.price,
            quantity,
            initialStop,
            entryAt: candle.date,
            entryIndex: index,
          });
          const record: BacktestTradeV3 = {
            status: "OPEN",
            side: strategy.side,
            entrySignalAt: candles[pendingEntry.signalIndex].date,
            entryAt: candle.date,
            entryPrice: fill.price,
            entryReason: "ENTRY_RULE_CHAIN",
            entryTrace: pendingEntry.trace,
            positionSize: quantity,
            initialStop,
            fills: [],
            grossPnl: 0,
            fee: round(fee),
            slippageCost: round(slippageCost),
            netPnl: round(-fee),
            returnPercent: 0,
            rMultiple: null,
            holdingBars: 0,
            holdingMinutes: 0,
            mfePercent: 0,
            maePercent: 0,
            stopPath:
              initialStop === null
                ? []
                : [{ at: candle.date, value: initialStop, reason: "initial-stop" }],
          };
          openTrade = {
            position,
            record,
            entryFee: fee,
            entrySlippageCost: slippageCost,
            entrySignalIndex: pendingEntry.signalIndex,
          };
          trades.push(record);
        } else
          rejectedSignals.push({
            at: candle.date,
            reason: "POSITION_SIZE_ZERO",
            trace: pendingEntry.trace,
          });
      } else
        rejectedSignals.push({
          at: candle.date,
          reason: "ENTRY_ORDER_NOT_FILLED",
          trace: pendingEntry.trace,
        });
      pendingEntry = null;
    }

    if (openTrade && pendingExit) {
      closeQuantity(pendingExit, candle, candle.open, pendingExit.trace);
      pendingExit = null;
    }

    if (openTrade) {
      exposedBars += 1;
      const state = openTrade.position;
      state.barsHeld += 1;
      const favorable = state.side === "LONG" ? candle.high : candle.low;
      const adverse = state.side === "LONG" ? candle.low : candle.high;
      openTrade.record.mfePercent = Math.max(
        openTrade.record.mfePercent,
        (state.side === "LONG"
          ? favorable / state.entryPrice - 1
          : 1 - favorable / state.entryPrice) * 100,
      );
      openTrade.record.maePercent = Math.min(
        openTrade.record.maePercent,
        (state.side === "LONG" ? adverse / state.entryPrice - 1 : 1 - adverse / state.entryPrice) *
          100,
      );

      const events = priceExitEvents(openTrade, candle, strategy);
      for (const event of events) {
        if (!openTrade) break;
        const rawPrice =
          event.kind === "STOP"
            ? strategy.side === "LONG"
              ? Math.min(candle.open, event.price)
              : Math.max(candle.open, event.price)
            : strategy.side === "LONG"
              ? Math.max(candle.open, event.price)
              : Math.min(candle.open, event.price);
        closeQuantity(event, candle, rawPrice);
      }

      if (openTrade) {
        for (const exit of strategy.exits) {
          if (exit.kind === "BREAK_EVEN") applyBreakEven(openTrade.position, exit, favorable);
        }
        updateTrailingStops(openTrade.position, strategy.exits, candle, (period) =>
          registry.value(atrOperand(strategy, period), index),
        );
        if (openTrade.position.protectiveStop !== null) {
          const latestStop = openTrade.record.stopPath.at(-1);
          if (!latestStop || latestStop.value !== openTrade.position.protectiveStop) {
            openTrade.record.stopPath.push({
              at: candle.date,
              value: openTrade.position.protectiveStop,
              reason: strongestStopReason(openTrade.position, strategy.exits).reason,
            });
          }
        }

        const closeSignals: PendingExit[] = [];
        for (const exit of strategy.exits) {
          if (openTrade.position.triggeredExitIds.has(exit.id)) continue;
          if (exit.kind === "CONDITION") {
            const evaluation = evaluateRule(exit.rule, index, registry, candles);
            if (evaluation.passed)
              closeSignals.push({
                reason: exit.id,
                ruleId: exit.id,
                quantityPercent: exit.quantityPercent,
                trace: evaluation.trace,
              });
          } else if (exit.kind === "OPPOSITE_SIGNAL") {
            const evaluation = evaluateRule(
              mirrorNode(strategy.entry) as RuleGroup,
              index,
              registry,
              candles,
            );
            if (evaluation.passed)
              closeSignals.push({
                reason: exit.id,
                ruleId: exit.id,
                quantityPercent: exit.quantityPercent,
                trace: evaluation.trace,
              });
          } else if (exit.kind === "TIME") {
            let triggered = false;
            if (exit.mode === "BARS") triggered = openTrade.position.barsHeld >= Number(exit.value);
            else if (exit.mode === "DAYS")
              triggered =
                (Date.parse(candle.date) - Date.parse(openTrade.position.entryAt)) / 86_400_000 >=
                Number(exit.value);
            else if (exit.mode === "CLOCK")
              triggered =
                localMinute(candle.date, runtime.marketTimeZone) +
                  timeframeMinutes[strategy.timeframe] >=
                parseClock(String(exit.value));
            else
              triggered =
                localMinute(candle.date, runtime.marketTimeZone) +
                  timeframeMinutes[strategy.timeframe] >=
                parseClock(runtime.sessionClose);
            if (triggered) {
              const event = {
                reason: exit.id,
                ruleId: exit.id,
                quantityPercent: exit.quantityPercent,
              };
              if (exit.mode === "SESSION_END" || exit.mode === "CLOCK")
                closeQuantity(event, candle, candle.close);
              else closeSignals.push(event);
            }
          }
        }
        if (openTrade && closeSignals.length) {
          const priority = new Map(strategy.exits.map((exit) => [exit.id, exit.priority]));
          pendingExit = closeSignals.toSorted(
            (a, b) => (priority.get(a.ruleId) ?? 1_000) - (priority.get(b.ruleId) ?? 1_000),
          )[0];
        }
      }
    }

    if (!openTrade && !pendingEntry && !pendingExit) {
      const entry = evaluateRule(strategy.entry, index, registry, candles);
      const filters = evaluateRule(strategy.filters, index, registry, candles);
      if (entry.passed && filters.passed) {
        const equity = strategy.execution.startingCapital + realizedNet;
        const drawdown = peakEquity === 0 ? 0 : ((peakEquity - equity) / peakEquity) * 100;
        const dailyLoss =
          sessionStartingEquity === 0
            ? 0
            : ((sessionStartingEquity - equity) / sessionStartingEquity) * 100;
        const blocked =
          strategy.risk.consecutiveLossLimit !== undefined &&
          consecutiveLosses >= strategy.risk.consecutiveLossLimit
            ? "CONSECUTIVE_LOSS_CIRCUIT_BREAKER"
            : strategy.risk.maximumDailyLossPercent !== undefined &&
                dailyLoss >= strategy.risk.maximumDailyLossPercent
              ? "MAXIMUM_DAILY_LOSS"
              : strategy.risk.maximumStrategyDrawdownPercent !== undefined &&
                  drawdown >= strategy.risk.maximumStrategyDrawdownPercent
                ? "MAXIMUM_STRATEGY_DRAWDOWN"
                : strategy.risk.maximumPortfolioDrawdownPercent !== undefined &&
                    drawdown >= strategy.risk.maximumPortfolioDrawdownPercent
                  ? "MAXIMUM_PORTFOLIO_DRAWDOWN"
                  : null;
        if (blocked) rejectedSignals.push({ at: candle.date, reason: blocked, trace: entry.trace });
        else if (strategy.execution.fillAt === "SAME_BAR_CLOSE") {
          pendingEntry = { signalIndex: index, trace: entry.trace };
          const fill = fillEntryOrder(
            pendingEntry,
            { ...candle, open: candle.close },
            strategy,
            candles,
          );
          if (fill) {
            const next = pendingEntry;
            pendingEntry = next;
            // Same-close is deliberately explicit; execute through the normal branch on a synthetic close.
            const synthetic = {
              ...candle,
              open: candle.close,
              high: candle.close,
              low: candle.close,
            };
            const saved = strategy.execution.order;
            if (saved.type === "MARKET") {
              const initialStop = calculateInitialStop(
                strategy.side,
                fill.price,
                strategy.exits,
                (period) => registry.value(atrOperand(strategy, period), index),
                strategy.execution.minimumTick,
              );
              const quantity = calculatePositionQuantity({
                sizing: strategy.positionSizing,
                equity,
                entryPrice: fill.price,
                initialStop,
                maximumAllocationPercent: strategy.risk.maximumSymbolAllocationPercent,
              });
              if (quantity > 0) {
                const fee = (fill.price * quantity * strategy.execution.commissionBps) / 10_000;
                realizedNet -= fee;
                turnover += fill.price * quantity;
                const position = createPositionState({
                  side: strategy.side,
                  entryPrice: fill.price,
                  quantity,
                  initialStop,
                  entryAt: synthetic.date,
                  entryIndex: index,
                });
                const record: BacktestTradeV3 = {
                  status: "OPEN",
                  side: strategy.side,
                  entrySignalAt: candle.date,
                  entryAt: candle.date,
                  entryPrice: fill.price,
                  entryReason: "ENTRY_RULE_CHAIN",
                  entryTrace: entry.trace,
                  positionSize: quantity,
                  initialStop,
                  fills: [],
                  grossPnl: 0,
                  fee: round(fee),
                  slippageCost: round(fill.slippageCostPerUnit * quantity),
                  netPnl: round(-fee),
                  returnPercent: 0,
                  rMultiple: null,
                  holdingBars: 0,
                  holdingMinutes: 0,
                  mfePercent: 0,
                  maePercent: 0,
                  stopPath:
                    initialStop === null
                      ? []
                      : [{ at: candle.date, value: initialStop, reason: "initial-stop" }],
                };
                openTrade = {
                  position,
                  record,
                  entryFee: fee,
                  entrySlippageCost: fill.slippageCostPerUnit * quantity,
                  entrySignalIndex: index,
                };
                trades.push(record);
              }
            }
          }
          pendingEntry = null;
        } else if (index + 1 < candles.length)
          pendingEntry = { signalIndex: index, trace: entry.trace };
      }
    }

    const unrealized = openTrade
      ? (openTrade.position.side === "LONG" ? 1 : -1) *
        (candle.close - openTrade.position.entryPrice) *
        openTrade.position.remainingQuantity
      : 0;
    const equity = strategy.execution.startingCapital + realizedNet + unrealized;
    peakEquity = Math.max(peakEquity, equity);
    equityCurve.push({
      at: candle.date,
      equity: round(equity, 4),
      drawdownPercent: round(peakEquity === 0 ? 0 : ((peakEquity - equity) / peakEquity) * 100, 4),
    });
  }

  if (openTrade && candles.length)
    closeQuantity(
      { reason: "END_OF_DATA", ruleId: "end-of-data", quantityPercent: 100 },
      candles.at(-1)!,
      candles.at(-1)!.close,
    );
  if (equityCurve.length)
    equityCurve[equityCurve.length - 1] = {
      ...equityCurve.at(-1)!,
      equity: round(strategy.execution.startingCapital + realizedNet, 4),
    };

  const assumptions = [
    strategy.execution.fillAt === "NEXT_BAR_OPEN"
      ? "Signal is confirmed at bar close and market entry fills at the next bar open."
      : "Same-bar close fill is explicitly enabled and may overstate executable performance.",
    `Intrabar conflict policy: ${strategy.execution.intrabarPolicy}.`,
    `Commission ${strategy.execution.commissionBps} bps, slippage ${strategy.execution.slippageBps} bps, spread ${strategy.execution.spreadBps} bps, minimum tick ${strategy.execution.minimumTick}.`,
  ];
  const limitations = [
    "Historical constituents and delisted securities are not provided; survivorship bias is not resolved.",
    "OHLC bars do not reveal the true intrabar path; the selected deterministic policy is an assumption.",
    ...(strategy.risk.maximumSectorExposurePercent !== undefined
      ? [
          "Sector exposure control is unsupported because the current instrument feed has no historical sector field.",
        ]
      : []),
  ];
  return {
    strategy,
    period: {
      start: candles[0]?.date ?? "",
      end: candles.at(-1)?.date ?? "",
      bars: candles.length,
    },
    metrics: metrics(strategy, trades, equityCurve, exposedBars, candles.length, turnover),
    trades,
    equityCurve,
    rejectedSignals,
    assumptions,
    limitations,
    dataPolicy: {
      source: runtime.source,
      adjustedPrices: runtime.adjustedPrices,
      corporateActions:
        runtime.corporateActionPolicy ??
        (runtime.adjustedPrices
          ? "Provider-adjusted OHLCV"
          : "Unadjusted; corporate actions may create discontinuities"),
      missingCandles: runtime.missingCandlePolicy ?? "SKIP_WITH_WARNING",
      marketTimeZone: runtime.marketTimeZone,
      session: `${runtime.sessionOpen}-${runtime.sessionClose}`,
    },
  };
}

export function compareBacktestsV3(
  strategies: StrategyDefinitionV3[],
  candles: Candle[],
  runtime: BacktestRuntimeOptionsV3,
): { runs: Array<{ strategyName: string; metrics: BacktestMetricsV3; result: BacktestResultV3 }> } {
  return {
    runs: strategies.map((strategy) => {
      const result = runBacktestV3(strategy, candles, runtime);
      return { strategyName: strategy.name, metrics: result.metrics, result };
    }),
  };
}
