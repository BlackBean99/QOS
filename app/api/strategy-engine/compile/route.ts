import { z } from "zod";

import { InstrumentIdSchema } from "@/src/domain/instruments";
import { compileStrategyV3, StrategyV3CompilerError } from "@/src/domain/strategy-v3/compiler";
import { StrategyTimeframeSchema } from "@/src/domain/strategy-v3/schema";
import { apiError, jsonNoStore, readJsonBody, requestId } from "@/src/server/http";

export const runtime = "nodejs";

const RequestSchema = z
  .object({
    prompt: z.string().trim().min(3).max(4_000),
    instrumentId: InstrumentIdSchema,
    timeframe: StrategyTimeframeSchema.optional(),
    side: z.enum(["LONG", "SHORT"]).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const id = requestId();
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success)
    return apiError(422, "invalid_compile_request", "자연어 전략과 종목을 확인해 주세요.", id);
  try {
    return jsonNoStore({
      ...(await compileStrategyV3(parsed.data.prompt, parsed.data.instrumentId, parsed.data)),
      requestId: id,
    });
  } catch (error) {
    if (error instanceof StrategyV3CompilerError) {
      const status = error.code === "LLM_UNAVAILABLE" ? 502 : 422;
      return apiError(status, error.code.toLowerCase(), error.message, id);
    }
    return apiError(500, "compiler_unavailable", "Strategy v3 변환을 완료하지 못했습니다.", id);
  }
}
