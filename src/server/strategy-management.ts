import type { ResearchComparisonResult } from "@/src/domain/advanced-backtest";
import type { BacktestResult } from "@/src/domain/backtest";
import type { BacktestResultV3 } from "@/src/domain/backtest-v3/engine";
import type { StoredStrategy } from "@/src/domain/stored-strategy";
import type { BacktestWindowInput } from "@/src/domain/backtest-window";
import {
  NewBacktestRunSchema,
  type BacktestHistoryRepository,
  type BacktestRunListItem,
  type StoredBacktestRun,
} from "@/src/domain/strategy-history";
import { StrategyStoreError, type StrategyRepository } from "./strategy-store";

export type ManagedBacktestResult = BacktestResult | ResearchComparisonResult | BacktestResultV3;

interface StrategyManagementOptions {
  strategies: StrategyRepository;
  history: BacktestHistoryRepository;
  execute: (
    document: StoredStrategy,
    window?: BacktestWindowInput,
  ) => Promise<ManagedBacktestResult>;
}

function resultObject(result: ManagedBacktestResult): Record<string, unknown> {
  return structuredClone(result) as unknown as Record<string, unknown>;
}

function summary(result: ManagedBacktestResult) {
  if ("runs" in result) {
    const baseline = result.runs[0];
    if (!baseline) {
      throw new StrategyStoreError("invalid_response", "백테스트 비교 결과가 비어 있습니다.");
    }
    return {
      kind: "research_v2" as const,
      totalReturnPercent: baseline.metrics.totalReturnPercent,
      maxDrawdownPercent: baseline.metrics.maxDrawdownPercent,
      sharpeRatio: baseline.metrics.sharpeRatio,
      trades: baseline.metrics.trades,
      periodStart: result.period.start,
      periodEnd: result.period.end,
      runCount: result.runs.length,
      baselineLabel: baseline.label,
    };
  }
  if ("maximumDrawdownPercent" in result.metrics) {
    return {
      kind: "strategy_v3" as const,
      totalReturnPercent: result.metrics.totalReturnPercent,
      maxDrawdownPercent: result.metrics.maximumDrawdownPercent,
      sharpeRatio: result.metrics.sharpeRatio,
      trades: result.metrics.numberOfTrades,
      periodStart: result.period.start,
      periodEnd: result.period.end,
    };
  }
  return {
    kind: "strategy_v1" as const,
    totalReturnPercent: result.metrics.totalReturnPercent,
    maxDrawdownPercent: result.metrics.maxDrawdownPercent,
    sharpeRatio: result.metrics.sharpeRatio,
    trades: result.metrics.closedTrades,
    periodStart: result.period.start,
    periodEnd: result.period.end,
  };
}

export class StrategyManagementService {
  readonly #strategies: StrategyRepository;
  readonly #history: BacktestHistoryRepository;
  readonly #execute: StrategyManagementOptions["execute"];

  constructor(options: StrategyManagementOptions) {
    this.#strategies = options.strategies;
    this.#history = options.history;
    this.#execute = options.execute;
  }

  async runBacktest(
    strategyId: string,
    window?: BacktestWindowInput,
  ): Promise<{
    run: StoredBacktestRun;
    result: ManagedBacktestResult;
  }> {
    const document = await this.#strategies.get(strategyId);
    if (!document) throw new StrategyStoreError("not_found", "저장 전략을 찾지 못했습니다.");
    const result = await this.#execute(document, window);
    const run = await this.#history.create(
      NewBacktestRunSchema.parse({
        strategyId: document.id,
        strategyName: document.name,
        strategyRevision: document.revision,
        strategyVersion: document.strategy.version,
        instrumentId: document.instrument.instrumentId,
        market: document.instrument.market,
        timeframe: document.strategy.timeframe,
        engineVersion:
          document.strategy.version === 1
            ? "qos-backtest-v1"
            : document.strategy.version === 2
              ? "qos-research-v2"
              : "qos-strategy-engine-v3",
        strategySnapshot: document.strategy,
        instrumentSnapshot: document.instrument,
        summary: summary(result),
        result: resultObject(result),
      }),
    );
    return { run, result };
  }

  listBacktests(strategyId: string, limit: number): Promise<BacktestRunListItem[]> {
    return this.#history.list(strategyId, limit);
  }

  async listAllBacktests(limit: number): Promise<BacktestRunListItem[]> {
    const strategyIds = await this.#strategies.listIds();
    return this.#history.listAll(limit, strategyIds);
  }

  getBacktest(id: string): Promise<StoredBacktestRun | null> {
    return this.#history.get(id);
  }

  deleteBacktest(id: string): Promise<boolean> {
    return this.#history.delete(id);
  }

  async deleteStrategy(id: string, expectedRevision: number): Promise<boolean> {
    const removed = await this.#strategies.delete(id, expectedRevision);
    // This is intentionally idempotent even when the strategy is already absent. A retry after a
    // local history write failure or process interruption completes orphan recovery safely.
    const detached = await this.#history.detachStrategy(id);
    return removed || detached > 0;
  }
}
