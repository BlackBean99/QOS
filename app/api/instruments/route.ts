import { z } from "zod";

import { getTossClient } from "@/src/server/toss/client";
import {
  getTossInstrumentSearch,
  type TossInstrumentSearch,
} from "@/src/server/toss/instrument-search";
import { apiError, jsonNoStore, requestId, tossErrorResponse } from "@/src/server/http";

export const runtime = "nodejs";

const QuerySchema = z
  .object({
    query: z.string().trim().min(1).max(80),
    region: z.enum(["KR", "US"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    refresh: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .strict();

export function createGetInstruments(search: TossInstrumentSearch) {
  return async function get(request: Request): Promise<Response> {
    const id = requestId();
    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      query: url.searchParams.get("query") ?? "",
      region: url.searchParams.get("region") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      refresh: url.searchParams.get("refresh") ?? undefined,
    });
    if (!parsed.success) {
      return apiError(
        400,
        "invalid_request",
        "종목명 또는 티커를 1자 이상 입력해 주세요.",
        id,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    try {
      const result = await search.searchWithMetadata(parsed.data.query, {
        region: parsed.data.region,
        limit: parsed.data.limit,
        refresh: parsed.data.refresh,
      });
      return jsonNoStore({ ...result, source: "TOSS OpenAPI", requestId: id });
    } catch (error) {
      return tossErrorResponse(error, id);
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await createGetInstruments(getTossInstrumentSearch(getTossClient()))(request);
  } catch (error) {
    return tossErrorResponse(error, requestId());
  }
}
