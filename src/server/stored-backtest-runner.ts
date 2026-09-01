import { runResearchComparison } from "@/src/domain/advanced-backtest";
import { runBacktest } from "@/src/domain/backtest";
import { runBacktestV3 } from "@/src/domain/backtest-v3/engine";
import {
  BacktestWindowError,
  estimateBacktestTargetBars,
  filterCandlesByBacktestWindow,
  filterCompletedBacktestCandles,
  resolveBacktestWindow,
  type BacktestWindowInput,
} from "@/src/domain/backtest-window";
import type { StoredStrategy } from "@/src/domain/stored-strategy";
import type { Candle } from "@/src/fixtures/markets";
import { getTossClient, type TossClient } from "./toss/client";
import { loadTossDataset, loadTossStrategyDataset } from "./toss/datasets";
import type { ManagedBacktestResult } from "./strategy-management";

export async function executeStoredBacktest(
  document: StoredStrategy,
  windowInput?: BacktestWindowInput,
  client: TossClient = getTossClient(),
): Promise<ManagedBacktestResult> {
  const completedCandles = (candles: Candle[]) =>
    filterCompletedBacktestCandles(
      candles,
      document.strategy.timeframe,
      document.instrument.timezone,
      document.instrument.currency,
    );
  const window = resolveBacktestWindow(
    document.strategy.timeframe,
    windowInput,
    document.instrument.timezone,
  );
  const targetBars = estimateBacktestTargetBars(
    document.strategy.timeframe,
    window,
    document.instrument.timezone,
  );
  if (document.strategy.version === 1) {
    const dataset = await loadTossDataset(client, document.instrument, "1d", { targetBars });
    const candles = filterCandlesByBacktestWindow(
      completedCandles(dataset.candles),
      window,
      document.instrument.timezone,
    );
    if (candles.length < 2) throw new BacktestWindowError("선택한 기간의 완료 봉이 부족합니다.");
    return runBacktest(document.strategy, { ...dataset, candles });
  }
  if (document.strategy.version === 3) {
    const dataset = await loadTossStrategyDataset(
      client,
      document.instrument,
      document.strategy.timeframe,
      { targetBars },
    );
    const candles = filterCandlesByBacktestWindow(
      completedCandles(dataset.candles),
      window,
      document.instrument.timezone,
    );
    if (candles.length < 2) throw new BacktestWindowError("선택한 기간의 완료 봉이 부족합니다.");
    return runBacktestV3(document.strategy, candles, {
      marketTimeZone: document.instrument.timezone,
      sessionOpen: document.instrument.currency === "KRW" ? "09:00" : "09:30",
      sessionClose: document.instrument.currency === "KRW" ? "15:30" : "16:00",
      source: dataset.meta.source,
      adjustedPrices: dataset.meta.adjustedPrices,
      corporateActionPolicy: "TOSS adjusted=true",
      missingCandlePolicy: "SKIP_WITH_WARNING",
    });
  }
  const dataset = await loadTossDataset(client, document.instrument, "5m", { targetBars });
  const candles = filterCandlesByBacktestWindow(
    completedCandles(dataset.candles),
    window,
    document.instrument.timezone,
  );
  if (candles.length < 2) throw new BacktestWindowError("선택한 기간의 완료 봉이 부족합니다.");
  return runResearchComparison(document.strategy, { ...dataset, candles });
}
