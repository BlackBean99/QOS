import { getInstrumentFixture, type Candle, type MarketFixture } from "../fixtures/markets";
import { StrategySchema, type Strategy } from "./strategy";

export interface EquityPoint {
  date: string;
  equity: number;
  drawdownPercent: number;
}

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  symbol: string;
  side: "LONG";
  status: "CLOSED" | "OPEN";
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  entryFee: number;
  quantity: number;
  exitSignalDate?: string;
  exitDate?: string;
  exitPrice?: number;
  exitFee?: number;
  pnl?: number;
  returnPercent?: number;
  reasons: string[];
  exitReason?: {
    signalDate: string;
    fillDate: string;
    peakPrice: number;
    stopPrice: number;
    signalClose: number;
    fillPrice: number;
  };
}

export interface BacktestResult {
  strategy: Strategy;
  market: MarketFixture["meta"];
  period: { start: string; end: string; sessions: number };
  costs: { commissionBps: number; slippageBps: number; sellTaxBps: number };
  execution: { signalAt: string; fillAt: string; priceAdjustment: string };
  metrics: {
    initialCapital: number;
    endingEquity: number;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    winRatePercent: number;
    closedTrades: number;
    benchmarkReturnPercent: number;
  };
  equityCurve: EquityPoint[];
  priceSeries: PricePoint[];
  trades: BacktestTrade[];
  warnings: string[];
}

const COSTS = {
  commissionBps: 1.5,
  slippageBps: 5,
  sellTaxBps: 0,
} as const;

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function entryReasons(strategy: Strategy, candles: Candle[], index: number): string[] | null {
  const { price, volume } = strategy.entry;
  if (index < Math.max(price.period, volume.period)) return null;

  let pricePasses = false;
  let priceReason = "";

  if (price.kind === "rolling_high_breakout") {
    const priorHigh = Math.max(
      ...candles.slice(index - price.period, index).map((item) => item.high),
    );
    pricePasses = candles[index].close > priorHigh;
    priceReason = `Close broke above the prior ${price.period}-session high`;
  } else {
    const currentSma = average(
      candles.slice(index - price.period + 1, index + 1).map((item) => item.close),
    );
    const previousSma = average(
      candles.slice(index - price.period, index).map((item) => item.close),
    );
    pricePasses = candles[index - 1].close <= previousSma && candles[index].close > currentSma;
    priceReason = `Close crossed above the ${price.period}-session SMA`;
  }

  const averageVolume = average(
    candles.slice(index - volume.period, index).map((item) => item.volume),
  );
  const volumePasses = candles[index].volume >= averageVolume * volume.ratio;

  return pricePasses && volumePasses
    ? [priceReason, `Volume reached at least ${volume.ratio}× its prior average`]
    : null;
}

function calculateSharpe(curve: EquityPoint[]): number {
  const returns = curve.slice(1).map((point, index) => {
    const prior = curve[index].equity;
    return prior === 0 ? 0 : point.equity / prior - 1;
  });
  if (returns.length < 2) return 0;

  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  const deviation = Math.sqrt(variance);
  return deviation === 0 ? 0 : (mean / deviation) * Math.sqrt(252);
}

export function runBacktest(rawStrategy: Strategy, dataset?: MarketFixture): BacktestResult {
  const strategy = StrategySchema.parse(rawStrategy);
  const fixture = dataset ?? getInstrumentFixture(strategy.instrumentId);
  if (
    !fixture ||
    fixture.meta.instrumentId !== strategy.instrumentId ||
    fixture.meta.market !== strategy.market
  ) {
    throw new Error("전략과 시장 데이터 종목이 일치해야 합니다.");
  }
  const { candles, meta } = fixture;
  if (candles.length === 0) throw new Error("일봉 시장 데이터가 없습니다.");
  const initialCapital = strategy.market === "KOSPI" ? 10_000_000 : 100_000;
  const commissionRate = COSTS.commissionBps / 10_000;
  const slippageRate = COSTS.slippageBps / 10_000;
  const sellTaxRate = COSTS.sellTaxBps / 10_000;

  let cash = initialCapital;
  let peakEquity = initialCapital;
  let latestEquity = initialCapital;
  let position: {
    quantity: number;
    peakPrice: number;
    entryCost: number;
    trade: BacktestTrade;
  } | null = null;
  let pending:
    | { kind: "BUY"; signalDate: string; reasons: string[] }
    | {
        kind: "SELL";
        signalDate: string;
        peakPrice: number;
        stopPrice: number;
        signalClose: number;
      }
    | null = null;

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (const [index, candle] of candles.entries()) {
    if (pending?.kind === "BUY" && !position) {
      const fillPrice = candle.open * (1 + slippageRate);
      const quantity = Math.floor(cash / (fillPrice * (1 + commissionRate)));
      if (quantity > 0) {
        const notional = quantity * fillPrice;
        const entryFee = notional * commissionRate;
        cash -= notional + entryFee;
        position = {
          quantity,
          peakPrice: candle.high,
          entryCost: notional + entryFee,
          trade: {
            symbol: meta.symbol,
            side: "LONG",
            status: "OPEN",
            signalDate: pending.signalDate,
            entryDate: candle.date,
            entryPrice: fillPrice,
            entryFee,
            quantity,
            reasons: pending.reasons,
          },
        };
      }
      pending = null;
    } else if (pending?.kind === "SELL" && position) {
      const fillPrice = candle.open * (1 - slippageRate);
      const notional = position.quantity * fillPrice;
      const exitFee = notional * (commissionRate + sellTaxRate);
      const pnl = notional - exitFee - position.entryCost;
      cash += notional - exitFee;
      trades.push({
        ...position.trade,
        status: "CLOSED",
        exitSignalDate: pending.signalDate,
        exitDate: candle.date,
        exitPrice: fillPrice,
        exitFee,
        pnl,
        returnPercent: round((pnl / position.entryCost) * 100),
        exitReason: {
          signalDate: pending.signalDate,
          fillDate: candle.date,
          peakPrice: pending.peakPrice,
          stopPrice: pending.stopPrice,
          signalClose: pending.signalClose,
          fillPrice,
        },
      });
      position = null;
      pending = null;
    }

    if (position) position.peakPrice = Math.max(position.peakPrice, candle.high);

    latestEquity = cash + (position ? position.quantity * candle.close : 0);
    peakEquity = Math.max(peakEquity, latestEquity);
    equityCurve.push({
      date: candle.date,
      equity: round(latestEquity, 2),
      drawdownPercent: round(((latestEquity - peakEquity) / peakEquity) * 100),
    });

    const hasNextSession = index < candles.length - 1;
    if (!hasNextSession || pending) continue;

    if (position) {
      const stopPrice: number = position.peakPrice * (1 - strategy.exit.percent / 100);
      if (candle.close <= stopPrice) {
        pending = {
          kind: "SELL",
          signalDate: candle.date,
          peakPrice: position.peakPrice,
          stopPrice,
          signalClose: candle.close,
        };
      }
      continue;
    }

    const reasons = entryReasons(strategy, candles, index);
    if (reasons) pending = { kind: "BUY", signalDate: candle.date, reasons };
  }

  if (position) trades.push(position.trade);

  const endingEquity = latestEquity;
  const closedTrades = trades.filter(
    (trade): trade is BacktestTrade & { pnl: number } => trade.status === "CLOSED",
  );
  const wins = closedTrades.filter((trade) => trade.pnl > 0).length;
  const warnings = [
    meta.synthetic
      ? "Synthetic bundled fixture: this result is not actual market performance or investment advice."
      : "TOSS historical market data backtest; this result is not investment advice or a future-performance guarantee.",
    meta.adjustedPrices
      ? "Adjusted prices are provider-defined; survivorship bias, missing values and corporate-action methodology still require review."
      : "Prices are unadjusted; corporate actions, survivorship bias and missing real-market data are not modeled.",
    "Daily trailing stops are evaluated at close and filled at the next session open; intraday stop prices are not simulated.",
  ];
  if (trades.length === 0)
    warnings.push(
      "No trades: the fixture did not complete indicator warm-up or trigger every entry rule.",
    );
  if (position)
    warnings.push("The final position remains open and is valued at the last fixture close.");

  return {
    strategy,
    market: meta,
    period: {
      start: candles[0].date,
      end: candles.at(-1)?.date ?? candles[0].date,
      sessions: candles.length,
    },
    costs: { ...COSTS },
    execution: {
      signalAt: "Session close",
      fillAt: `Next listed ${meta.synthetic ? "fixture " : ""}session open`,
      priceAdjustment: "Slippage worsens buy and sell fills; commission applies to both sides",
    },
    metrics: {
      initialCapital,
      endingEquity,
      totalReturnPercent: round((endingEquity / initialCapital - 1) * 100),
      maxDrawdownPercent: round(Math.min(...equityCurve.map((point) => point.drawdownPercent))),
      sharpeRatio: round(calculateSharpe(equityCurve)),
      winRatePercent: closedTrades.length === 0 ? 0 : round((wins / closedTrades.length) * 100),
      closedTrades: closedTrades.length,
      benchmarkReturnPercent: round(
        ((candles.at(-1)?.close ?? candles[0].close) / candles[0].close - 1) * 100,
      ),
    },
    equityCurve,
    priceSeries: candles.map(({ date, open, high, low, close, volume }) => ({
      date,
      open,
      high,
      low,
      close,
      volume,
    })),
    trades,
    warnings,
  };
}
