import { z } from "zod";

import { runResearchComparison } from "@/src/domain/advanced-backtest";
import { ResearchStrategySchema } from "@/src/domain/advanced-strategy";
import { InstrumentSnapshotSchema } from "@/src/domain/stored-strategy";
import { getTossClient, type TossClient } from "@/src/server/toss/client";
import { loadTossDataset } from "@/src/server/toss/datasets";

export const runtime = "nodejs";

const RequestSchema = z
  .object({ strategy: ResearchStrategySchema, instrument: InstrumentSnapshotSchema.optional() })
  .strict();

export function createPostResearchBacktest(client?: TossClient) {
  return async function post(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: { code: "INVALID_JSON", message: "유효한 JSON 요청이 필요합니다." } },
        { status: 400 },
      );
    }
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: { code: "VALIDATION_ERROR", message: "검증된 Strategy v2만 실행할 수 있습니다." },
        },
        { status: 422 },
      );
    }
    try {
      const dataset = parsed.data.instrument
        ? await loadTossDataset(client ?? getTossClient(), parsed.data.instrument, "5m", {
            targetBars: 1_200,
          })
        : undefined;
      return Response.json(runResearchComparison(parsed.data.strategy, dataset), {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return Response.json(
        {
          error: {
            code: "MARKET_DATA_ERROR",
            message: error instanceof Error ? error.message : "시장 데이터를 불러오지 못했습니다.",
          },
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  };
}

export const POST = createPostResearchBacktest();
