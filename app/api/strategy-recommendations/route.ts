import { z } from "zod";

import {
  BacktestWindowError,
  BacktestWindowInputSchema,
  estimateBacktestTargetBars,
  filterCandlesByBacktestWindow,
  filterCompletedBacktestCandles,
  resolveBacktestWindow,
  type ResolvedBacktestWindow,
} from "@/src/domain/backtest-window";
import { runBacktestV3, type BacktestRuntimeOptionsV3 } from "@/src/domain/backtest-v3/engine";
import { InstrumentSnapshotSchema, type InstrumentSnapshot } from "@/src/domain/stored-strategy";
import {
  ENTRY_PRESETS_V3,
  createPresetStrategyV3,
  isPresetTimeframeSupportedV3,
} from "@/src/domain/strategy-v3/catalog";
import { StrategyTimeframeSchema, type StrategyTimeframe } from "@/src/domain/strategy-v3/schema";
import type { Candle } from "@/src/fixtures/markets";
import {
  RecommendationCache,
  rankRecommendationCandidates,
  recommendationMetrics,
  type RecommendationEvaluator,
} from "@/src/server/strategy-recommendations";
import {
  apiError,
  jsonNoStore,
  readJsonBody,
  requestId,
  tossErrorResponse,
} from "@/src/server/http";
import { logServerEvent } from "@/src/server/logging";
import { getTossClient } from "@/src/server/toss/client";
import { loadTossStrategyDataset } from "@/src/server/toss/datasets";

export const runtime = "nodejs";

const CATALOG_VERSION = "strategy-v3-entry-43-timeframe-v2";

const RequestSchema = z
  .object({
    instrument: InstrumentSnapshotSchema,
    timeframe: StrategyTimeframeSchema.default("1d"),
    window: BacktestWindowInputSchema.optional(),
  })
  .strict();

interface RecommendationDataset {
  candles: Candle[];
  runtime: BacktestRuntimeOptionsV3;
}

type RecommendationDatasetLoader = (
  instrument: InstrumentSnapshot,
  timeframe: StrategyTimeframe,
  window: ResolvedBacktestWindow,
) => Promise<RecommendationDataset>;

interface RecommendationPayload {
  methodology: {
    catalogVersion: string;
    candidatesEvaluated: number;
    candidatesExcluded: number;
    ranking: "TOTAL_RETURN_DESC";
    baselineExit: string;
    execution: string;
  };
  window: ResolvedBacktestWindow;
  dataPeriod: { start: string; end: string; bars: number };
  recommendation: ReturnType<typeof rankRecommendationCandidates>[number] | null;
  rankings: ReturnType<typeof rankRecommendationCandidates>;
  warnings: string[];
}

async function loadDataset(
  instrument: InstrumentSnapshot,
  timeframe: StrategyTimeframe,
  window: ResolvedBacktestWindow,
): Promise<RecommendationDataset> {
  const dataset = await loadTossStrategyDataset(getTossClient(), instrument, timeframe, {
    targetBars: estimateBacktestTargetBars(timeframe, window, instrument.timezone),
  });
  return {
    candles: dataset.candles,
    runtime: {
      marketTimeZone: instrument.timezone,
      sessionOpen: instrument.currency === "KRW" ? "09:00" : "09:30",
      sessionClose: instrument.currency === "KRW" ? "15:30" : "16:00",
      source: dataset.meta.source,
      adjustedPrices: dataset.meta.adjustedPrices,
      corporateActionPolicy: "TOSS adjusted=true",
      missingCandlePolicy: "SKIP_WITH_WARNING",
    },
  };
}

function cacheTtl(timeframe: StrategyTimeframe): number {
  return {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "60m": 3_600_000,
    "4h": 3_600_000,
    "1d": 3_600_000,
    "1w": 3_600_000,
  }[timeframe];
}

const sharedCache = new RecommendationCache<RecommendationPayload>();

export function createStrategyRecommendationHandler(
  options: {
    loader?: RecommendationDatasetLoader;
    evaluate?: RecommendationEvaluator;
    cache?: RecommendationCache<RecommendationPayload>;
    now?: () => Date;
  } = {},
) {
  const datasetLoader = options.loader ?? loadDataset;
  const evaluator: RecommendationEvaluator =
    options.evaluate ??
    ((strategy, candles, runtime) => runBacktestV3(strategy, candles, runtime).metrics);
  const cache = options.cache ?? sharedCache;
  const now = options.now ?? (() => new Date());

  return async function POST(request: Request): Promise<Response> {
    const body = await readJsonBody(request, 200_000);
    if (!body.ok) return body.response;
    const id = requestId();
    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        422,
        "invalid_recommendation_request",
        "종목, timeframe과 백테스트 기간을 확인해 주세요.",
        id,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    const startedAt = performance.now();
    try {
      const evaluationNow = now();
      const window = resolveBacktestWindow(
        parsed.data.timeframe,
        parsed.data.window,
        parsed.data.instrument.timezone,
        evaluationNow,
      );
      const key = [
        CATALOG_VERSION,
        parsed.data.instrument.instrumentId,
        parsed.data.timeframe,
        window.startDate,
        window.endDate,
      ].join(":");
      const result = await cache.getOrCreate(key, cacheTtl(parsed.data.timeframe), async () => {
        const dataset = await datasetLoader(parsed.data.instrument, parsed.data.timeframe, window);
        const candles = filterCandlesByBacktestWindow(
          filterCompletedBacktestCandles(
            dataset.candles,
            parsed.data.timeframe,
            parsed.data.instrument.timezone,
            parsed.data.instrument.currency,
            evaluationNow,
          ),
          window,
          parsed.data.instrument.timezone,
        );
        if (candles.length < 2) {
          throw new BacktestWindowError("선택한 기간에 백테스트 완료 봉이 부족합니다.");
        }
        const compatiblePresets = ENTRY_PRESETS_V3.filter((preset) =>
          isPresetTimeframeSupportedV3(preset, parsed.data.timeframe),
        );
        const candidates = compatiblePresets.map((preset) => {
          const strategy = createPresetStrategyV3(preset.id, parsed.data.instrument.instrumentId, {
            timeframe: parsed.data.timeframe,
            side: "LONG",
          });
          return {
            presetId: preset.id,
            presetName: preset.name,
            category: preset.category,
            strategy,
            metrics: recommendationMetrics(evaluator(strategy, candles, dataset.runtime, preset)),
          };
        });
        const ranked = rankRecommendationCandidates(candidates);
        return {
          methodology: {
            catalogVersion: CATALOG_VERSION,
            candidatesEvaluated: compatiblePresets.length,
            candidatesExcluded: ENTRY_PRESETS_V3.length - compatiblePresets.length,
            ranking: "TOTAL_RETURN_DESC" as const,
            baselineExit: "ATR 2x stop + 2R target",
            execution: "bar close signal → next bar open, commission/slippage/spread included",
          },
          window,
          dataPeriod: {
            start: candles[0].date,
            end: candles.at(-1)!.date,
            bars: candles.length,
          },
          recommendation: ranked[0] ?? null,
          rankings: ranked.slice(0, 5),
          warnings: [
            "선택한 과거 구간의 in-sample 결과이며 미래 수익을 보장하지 않습니다.",
            "상장폐지 종목과 historical constituent가 공급되지 않아 survivorship bias가 남습니다.",
            "기본 parameter만 비교하며 자동 최적화는 수행하지 않습니다.",
          ],
        };
      });
      logServerEvent("info", "strategy_recommendation.completed", {
        requestId: id,
        instrumentId: parsed.data.instrument.instrumentId,
        timeframe: parsed.data.timeframe,
        candidates: result.value.methodology.candidatesEvaluated,
        excludedCandidates: result.value.methodology.candidatesExcluded,
        cache: result.cache,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return jsonNoStore({ ...result.value, cache: result.cache, requestId: id });
    } catch (error) {
      if (error instanceof BacktestWindowError) {
        return apiError(422, "invalid_backtest_window", error.message, id);
      }
      logServerEvent("error", "strategy_recommendation.failed", {
        requestId: id,
        instrumentId: parsed.data.instrument.instrumentId,
        timeframe: parsed.data.timeframe,
        code: error instanceof Error ? error.name : "unknown_error",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return tossErrorResponse(error, id);
    }
  };
}

export const POST = createStrategyRecommendationHandler();
