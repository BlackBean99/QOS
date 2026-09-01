import type { BacktestMetricsV3, BacktestRuntimeOptionsV3 } from "@/src/domain/backtest-v3/engine";
import type {
  StrategyCatalogCategory,
  StrategyCatalogPreset,
} from "@/src/domain/strategy-v3/catalog";
import type { StrategyDefinitionV3 } from "@/src/domain/strategy-v3/schema";
import type { Candle } from "@/src/fixtures/markets";

export interface RecommendationMetrics {
  totalReturnPercent: number;
  maximumDrawdownPercent: number;
  sharpeRatio: number;
  numberOfTrades: number;
}

export interface RecommendationCandidate {
  presetId: string;
  presetName: string;
  category: StrategyCatalogCategory;
  strategy: StrategyDefinitionV3;
  metrics: RecommendationMetrics;
}

export interface RankedRecommendationCandidate extends RecommendationCandidate {
  rank: number;
}

export type RecommendationEvaluator = (
  strategy: StrategyDefinitionV3,
  candles: Candle[],
  runtime: BacktestRuntimeOptionsV3,
  preset: StrategyCatalogPreset,
) => BacktestMetricsV3;

export function recommendationMetrics(metrics: BacktestMetricsV3): RecommendationMetrics {
  return {
    totalReturnPercent: metrics.totalReturnPercent,
    maximumDrawdownPercent: metrics.maximumDrawdownPercent,
    sharpeRatio: metrics.sharpeRatio,
    numberOfTrades: metrics.numberOfTrades,
  };
}

export function rankRecommendationCandidates(
  candidates: RecommendationCandidate[],
): RankedRecommendationCandidate[] {
  return candidates
    .filter((candidate) => candidate.metrics.numberOfTrades > 0)
    .toSorted(
      (left, right) =>
        right.metrics.totalReturnPercent - left.metrics.totalReturnPercent ||
        Math.abs(left.metrics.maximumDrawdownPercent) -
          Math.abs(right.metrics.maximumDrawdownPercent) ||
        right.metrics.sharpeRatio - left.metrics.sharpeRatio ||
        left.presetId.localeCompare(right.presetId),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class RecommendationCache<T> {
  readonly #maximumEntries: number;
  readonly #now: () => number;
  readonly #values = new Map<string, CacheEntry<T>>();
  readonly #inFlight = new Map<string, Promise<T>>();

  constructor(options: { maximumEntries?: number; now?: () => number } = {}) {
    this.#maximumEntries = options.maximumEntries ?? 100;
    this.#now = options.now ?? Date.now;
  }

  async getOrCreate(
    key: string,
    ttlMilliseconds: number,
    create: () => Promise<T>,
  ): Promise<{ value: T; cache: "HIT" | "MISS" | "COALESCED" }> {
    const cached = this.#values.get(key);
    if (cached && cached.expiresAt > this.#now()) {
      this.#values.delete(key);
      this.#values.set(key, cached);
      return { value: cached.value, cache: "HIT" };
    }
    if (cached) this.#values.delete(key);

    const running = this.#inFlight.get(key);
    if (running) return { value: await running, cache: "COALESCED" };

    const promise = create();
    this.#inFlight.set(key, promise);
    try {
      const value = await promise;
      this.#values.set(key, { value, expiresAt: this.#now() + ttlMilliseconds });
      while (this.#values.size > this.#maximumEntries) {
        const oldest = this.#values.keys().next().value;
        if (oldest === undefined) break;
        this.#values.delete(oldest);
      }
      return { value, cache: "MISS" };
    } finally {
      this.#inFlight.delete(key);
    }
  }
}
