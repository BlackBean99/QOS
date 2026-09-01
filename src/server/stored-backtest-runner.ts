import { runResearchComparison } from "@/src/domain/advanced-backtest";
import { runBacktest } from "@/src/domain/backtest";
import { runBacktestV3 } from "@/src/domain/backtest-v3/engine";
import type { StoredStrategy } from "@/src/domain/stored-strategy";
import { getTossClient, type TossClient } from "./toss/client";
import { loadTossDataset, loadTossStrategyDataset } from "./toss/datasets";
import type { ManagedBacktestResult } from "./strategy-management";

export async function executeStoredBacktest(
  document: StoredStrategy,
  client: TossClient = getTossClient(),
): Promise<ManagedBacktestResult> {
  if (document.strategy.version === 1) {
    const dataset = await loadTossDataset(client, document.instrument, "1d", { targetBars: 200 });
    return runBacktest(document.strategy, dataset);
  }
  if (document.strategy.version === 3) {
    const dataset = await loadTossStrategyDataset(
      client,
      document.instrument,
      document.strategy.timeframe,
      { targetBars: 1_200 },
    );
    return runBacktestV3(document.strategy, dataset.candles, {
      marketTimeZone: document.instrument.timezone,
      sessionOpen: document.instrument.currency === "KRW" ? "09:00" : "09:30",
      sessionClose: document.instrument.currency === "KRW" ? "15:30" : "16:00",
      source: dataset.meta.source,
      adjustedPrices: dataset.meta.adjustedPrices,
      corporateActionPolicy: "TOSS adjusted=true",
      missingCandlePolicy: "SKIP_WITH_WARNING",
    });
  }
  const dataset = await loadTossDataset(client, document.instrument, "5m", { targetBars: 1_200 });
  return runResearchComparison(document.strategy, dataset);
}
