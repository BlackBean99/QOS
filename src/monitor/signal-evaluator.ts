import { runResearchComparison } from "@/src/domain/advanced-backtest";
import { runBacktest } from "@/src/domain/backtest";
import { runBacktestV3 } from "@/src/domain/backtest-v3/engine";
import type { NewStoredStrategy } from "@/src/domain/stored-strategy";
import type { IntradayFixture } from "@/src/fixtures/intraday";
import type { MarketFixture } from "@/src/fixtures/markets";

export interface DetectedSignal {
  instrumentId: string;
  side: "BUY" | "SELL";
  barTimestamp: string;
  price: number;
  reason: string;
}

const timeframeMilliseconds = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "60m": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
} as const;

function materializingBar(fixture: MarketFixture, timeframe: keyof typeof timeframeMilliseconds) {
  const latest = fixture.candles.at(-1);
  if (!latest) return null;
  const timestamp = Date.parse(latest.date);
  return {
    date: Number.isFinite(timestamp)
      ? new Date(timestamp + timeframeMilliseconds[timeframe]).toISOString()
      : `${latest.date}#next`,
    open: latest.close,
    high: latest.close,
    low: latest.close,
    close: latest.close,
    volume: 0,
  };
}

export function evaluateCompletedBarSignal(
  document: NewStoredStrategy,
  fixture: MarketFixture | IntradayFixture,
): DetectedSignal | null {
  const latest = fixture.candles.at(-1);
  const next = materializingBar(fixture, document.strategy.timeframe);
  if (!latest || !next) return null;

  if (document.strategy.version === 1) {
    const result = runBacktest(document.strategy, {
      ...fixture,
      candles: [...fixture.candles, next],
    });
    const sold = result.trades.find((trade) => trade.exitSignalDate === latest.date);
    if (sold) {
      return {
        instrumentId: document.strategy.instrumentId,
        side: "SELL",
        barTimestamp: latest.date,
        price: latest.close,
        reason: sold.exitReason
          ? `종가가 trailing stop ${sold.exitReason.stopPrice.toLocaleString("ko-KR")} 이하`
          : "청산 조건 충족",
      };
    }
    const bought = result.trades.find((trade) => trade.signalDate === latest.date);
    return bought
      ? {
          instrumentId: document.strategy.instrumentId,
          side: "BUY",
          barTimestamp: latest.date,
          price: latest.close,
          reason: bought.reasons.join(" · "),
        }
      : null;
  }

  if (document.strategy.version === 3) {
    const result = runBacktestV3(document.strategy, [...fixture.candles, next], {
      marketTimeZone: document.instrument.timezone,
      sessionOpen: document.instrument.currency === "KRW" ? "09:00" : "09:30",
      sessionClose: document.instrument.currency === "KRW" ? "15:30" : "16:00",
      source: fixture.meta.source,
      adjustedPrices: fixture.meta.adjustedPrices,
      corporateActionPolicy: "TOSS adjusted=true",
      missingCandlePolicy: "SKIP_WITH_WARNING",
    });
    const sold = result.trades.find(
      (trade) =>
        trade.exitReason !== "END_OF_DATA" &&
        (trade.exitAt === next.date || trade.exitAt === latest.date),
    );
    if (sold) {
      return {
        instrumentId: document.strategy.instrumentId,
        side: "SELL",
        barTimestamp: latest.date,
        price: latest.close,
        reason: sold.exitReason ?? "Strategy v3 exit rule chain",
      };
    }
    const bought = result.trades.find((trade) => trade.entrySignalAt === latest.date);
    return bought
      ? {
          instrumentId: document.strategy.instrumentId,
          side: "BUY",
          barTimestamp: latest.date,
          price: latest.close,
          reason: "Strategy v3 entry/filter rule chain passed",
        }
      : null;
  }

  const researchFixture: IntradayFixture = {
    ...fixture,
    timeframe: "5m",
    candles: [...fixture.candles, next],
  };
  const comparison = runResearchComparison(document.strategy, researchFixture);
  const run = comparison.runs[0];
  const sold = run?.trades.find((trade) => trade.exitSignalAt === latest.date);
  if (sold) {
    return {
      instrumentId: document.strategy.instrumentId,
      side: "SELL",
      barTimestamp: latest.date,
      price: latest.close,
      reason: sold.exitReason ?? run.label,
    };
  }
  const bought = run?.trades.find((trade) => trade.entrySignalAt === latest.date);
  return bought
    ? {
        instrumentId: document.strategy.instrumentId,
        side: "BUY",
        barTimestamp: latest.date,
        price: latest.close,
        reason: `${document.strategy.entry.sessionLookback}-session VWAP 상향 돌파`,
      }
    : null;
}
