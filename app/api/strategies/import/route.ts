import { z } from "zod";

import {
  MAX_STRATEGY_DOCUMENT_BYTES,
  MAX_STRATEGY_IMPORT_REQUEST_BYTES,
  StrategyExportSchema,
} from "@/src/domain/stored-strategy";
import {
  apiError,
  jsonNoStore,
  readJsonBody,
  requestId,
  strategyStoreErrorResponse,
} from "@/src/server/http";
import { getStrategyRepository } from "@/src/server/strategy-repository";
import type { StrategyRepository } from "@/src/server/strategy-store";

export const runtime = "nodejs";

const ImportRequestSchema = z
  .object({
    document: StrategyExportSchema,
    mode: z.enum(["reject", "clone"]).default("reject"),
  })
  .strict();

export function createImportStrategies(store: StrategyRepository) {
  return async function post(request: Request): Promise<Response> {
    const body = await readJsonBody(request, MAX_STRATEGY_IMPORT_REQUEST_BYTES);
    if (!body.ok) return body.response;
    const id = requestId();
    const parsed = ImportRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        422,
        "invalid_document",
        "가져올 QOS 전략 JSON을 확인해 주세요.",
        id,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    if (
      new TextEncoder().encode(JSON.stringify(parsed.data.document)).byteLength >
      MAX_STRATEGY_DOCUMENT_BYTES
    ) {
      return apiError(413, "payload_too_large", "가져올 전략 JSON은 5MiB 이하여야 합니다.", id);
    }
    try {
      return jsonNoStore({
        ...(await store.import(parsed.data.document, parsed.data.mode)),
        requestId: id,
      });
    } catch (error) {
      return strategyStoreErrorResponse(error, id);
    }
  };
}

export const POST = createImportStrategies(getStrategyRepository());
