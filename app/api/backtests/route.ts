import { runBacktest } from "@/src/domain/backtest";
import { InstrumentSnapshotSchema } from "@/src/domain/stored-strategy";
import { StrategySchema } from "@/src/domain/strategy";
import { getTossClient, type TossClient } from "@/src/server/toss/client";
import { loadTossDataset } from "@/src/server/toss/datasets";
import { z } from "zod";

export const runtime = "nodejs";

const RequestSchema = z
  .object({ strategy: StrategySchema, instrument: InstrumentSnapshotSchema.optional() })
  .strict()
  .superRefine((input, context) => {
    if (
      input.instrument &&
      (input.instrument.instrumentId !== input.strategy.instrumentId ||
        input.instrument.market !== input.strategy.market)
    ) {
      context.addIssue({
        code: "custom",
        path: ["instrument"],
        message: "전략 종목과 일치해야 합니다.",
      });
    }
  });

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function createPostBacktest(client?: TossClient) {
  return async function post(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "유효한 JSON 요청이 필요합니다." }, 400);
    }

    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: "검증된 version 1 전략만 실행할 수 있습니다.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        422,
      );
    }

    try {
      const dataset = parsed.data.instrument
        ? await loadTossDataset(client ?? getTossClient(), parsed.data.instrument, "1d", {
            targetBars: 200,
          })
        : undefined;
      return json(runBacktest(parsed.data.strategy, dataset), 200);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "시장 데이터 백테스트에 실패했습니다." },
        503,
      );
    }
  };
}

export const POST = createPostBacktest();
