import { z } from "zod";

import { InstrumentIdSchema } from "@/src/domain/instruments";
import { InstrumentSnapshotSchema } from "@/src/domain/stored-strategy";
import { compileResearchStrategy, StrategyCompilerError } from "@/src/domain/llm-strategy";

export const runtime = "nodejs";

const RequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    instrumentId: InstrumentIdSchema,
    instrument: InstrumentSnapshotSchema.optional(),
  })
  .strict();

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: { code: "INVALID_JSON", message: "유효한 JSON 요청이 필요합니다." } },
      400,
    );
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: { code: "VALIDATION_ERROR", message: "전략 문장과 지원 종목을 확인해 주세요." } },
      422,
    );
  }
  try {
    return json(
      await compileResearchStrategy(
        parsed.data.prompt,
        parsed.data.instrumentId,
        parsed.data.instrument,
      ),
      200,
    );
  } catch (error) {
    if (error instanceof StrategyCompilerError) {
      const status = error.code === "LLM_NOT_CONFIGURED" ? 503 : 502;
      return json({ error: { code: error.code, message: error.message } }, status);
    }
    return json(
      { error: { code: "LLM_UNAVAILABLE", message: "전략 변환을 완료하지 못했습니다." } },
      502,
    );
  }
}
