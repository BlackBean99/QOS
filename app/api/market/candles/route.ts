import { z } from "zod";

import { InstrumentIdSchema, MarketSchema } from "@/src/domain/instruments";
import { apiError, jsonNoStore, requestId, tossErrorResponse } from "@/src/server/http";
import { getTossClient, type TossClient } from "@/src/server/toss/client";
import { CandleIntervalSchema } from "@/src/server/toss/schemas";

export const runtime = "nodejs";

const QuerySchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    interval: CandleIntervalSchema,
    count: z.coerce.number().int().min(1).max(200).default(200),
    before: z.iso.datetime({ offset: true }).optional(),
    adjusted: z.enum(["true", "false"]).default("true"),
  })
  .strict();

export function createGetCandles(client: TossClient) {
  return async function get(request: Request): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      instrumentId: url.searchParams.get("instrumentId") ?? "",
      interval: url.searchParams.get("interval") ?? "",
      count: url.searchParams.get("count") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      adjusted: url.searchParams.get("adjusted") ?? undefined,
    });
    if (!parsed.success) {
      return apiError(
        400,
        "invalid_request",
        "종목, 봉 주기와 조회 범위를 확인해 주세요.",
        id,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    const separator = parsed.data.instrumentId.indexOf(":");
    const market = MarketSchema.parse(parsed.data.instrumentId.slice(0, separator));
    const symbol = parsed.data.instrumentId.slice(separator + 1);
    try {
      const page = await client.getCandles({
        symbol,
        interval: parsed.data.interval,
        count: parsed.data.count,
        before: parsed.data.before,
        adjusted: parsed.data.adjusted === "true",
      });
      return jsonNoStore({
        instrumentId: parsed.data.instrumentId,
        market,
        symbol,
        interval: parsed.data.interval,
        adjusted: parsed.data.adjusted === "true",
        source: "TOSS OpenAPI",
        ...page,
        requestId: id,
      });
    } catch (error) {
      return tossErrorResponse(error, id);
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await createGetCandles(getTossClient())(request);
  } catch (error) {
    return tossErrorResponse(error, requestId());
  }
}
