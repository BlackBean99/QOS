import { z } from "zod";

import {
  compareBacktestsV3,
  runBacktestV3,
  type BacktestRuntimeOptionsV3,
} from "@/src/domain/backtest-v3/engine";
import { InstrumentSnapshotSchema, type InstrumentSnapshot } from "@/src/domain/stored-strategy";
import {
  BacktestWindowError,
  BacktestWindowInputSchema,
  estimateBacktestTargetBars,
  filterCandlesByBacktestWindow,
  filterCompletedBacktestCandles,
  resolveBacktestWindow,
  type ResolvedBacktestWindow,
} from "@/src/domain/backtest-window";
import {
  StrategyDefinitionV3Schema,
  type StrategyDefinitionV3,
} from "@/src/domain/strategy-v3/schema";
import type { Candle } from "@/src/fixtures/markets";
import {
  apiError,
  jsonNoStore,
  readJsonBody,
  requestId,
  tossErrorResponse,
} from "@/src/server/http";
import { getTossClient } from "@/src/server/toss/client";
import { loadTossStrategyDataset } from "@/src/server/toss/datasets";

export const runtime = "nodejs";

const RequestSchema = z
  .object({
    strategies: z.array(StrategyDefinitionV3Schema).min(1).max(6),
    instrument: InstrumentSnapshotSchema,
    window: BacktestWindowInputSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [index, strategy] of value.strategies.entries()) {
      if (
        strategy.instrumentId !== value.instrument.instrumentId ||
        strategy.market !== value.instrument.market
      ) {
        context.addIssue({
          code: "custom",
          path: ["strategies", index, "instrumentId"],
          message: "전략과 선택 종목이 일치해야 합니다.",
        });
      }
      if (strategy.timeframe !== value.strategies[0].timeframe) {
        context.addIssue({
          code: "custom",
          path: ["strategies", index, "timeframe"],
          message: "비교 전략은 같은 timeframe을 사용해야 합니다.",
        });
      }
    }
  });

interface LoadedDatasetV3 {
  candles: Candle[];
  runtime: BacktestRuntimeOptionsV3;
}

export type StrategyDatasetLoaderV3 = (
  strategy: StrategyDefinitionV3,
  instrument: InstrumentSnapshot,
  window: ResolvedBacktestWindow,
) => Promise<LoadedDatasetV3>;

async function loadDataset(
  strategy: StrategyDefinitionV3,
  instrument: InstrumentSnapshot,
  window: ResolvedBacktestWindow,
): Promise<LoadedDatasetV3> {
  const dataset = await loadTossStrategyDataset(getTossClient(), instrument, strategy.timeframe, {
    targetBars: estimateBacktestTargetBars(strategy.timeframe, window, instrument.timezone),
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

export function createStrategyEngineBacktestHandler(loader: StrategyDatasetLoaderV3 = loadDataset) {
  return async function POST(request: Request): Promise<Response> {
    const body = await readJsonBody(request, 2_000_000);
    if (!body.ok) return body.response;
    const id = requestId();
    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        422,
        "invalid_strategy_v3",
        "검증된 Strategy v3 비교 요청이 필요합니다.",
        id,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    try {
      const window = resolveBacktestWindow(
        parsed.data.strategies[0].timeframe,
        parsed.data.window,
        parsed.data.instrument.timezone,
      );
      const dataset = await loader(parsed.data.strategies[0], parsed.data.instrument, window);
      const candles = filterCandlesByBacktestWindow(
        filterCompletedBacktestCandles(
          dataset.candles,
          parsed.data.strategies[0].timeframe,
          parsed.data.instrument.timezone,
          parsed.data.instrument.currency,
        ),
        window,
        parsed.data.instrument.timezone,
      );
      if (candles.length < 2)
        return apiError(422, "insufficient_data", "백테스트에 필요한 완료 봉이 부족합니다.", id);
      const result =
        parsed.data.strategies.length === 1
          ? {
              kind: "single" as const,
              result: runBacktestV3(parsed.data.strategies[0], candles, dataset.runtime),
            }
          : {
              kind: "comparison" as const,
              comparison: compareBacktestsV3(parsed.data.strategies, candles, dataset.runtime),
            };
      return jsonNoStore({ ...result, window, requestId: id });
    } catch (error) {
      if (error instanceof BacktestWindowError) {
        return apiError(422, "invalid_backtest_window", error.message, id);
      }
      return tossErrorResponse(error, id);
    }
  };
}

export const POST = createStrategyEngineBacktestHandler();
