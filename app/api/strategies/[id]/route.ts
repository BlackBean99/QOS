import { z } from "zod";

import { UpdateStoredStrategySchema } from "@/src/domain/stored-strategy";
import {
  apiError,
  jsonNoStore,
  readJsonBody,
  requestId,
  strategyStoreErrorResponse,
} from "@/src/server/http";
import { getStrategyRepository } from "@/src/server/strategy-repository";
import { getStrategyManagementService } from "@/src/server/strategy-management-factory";
import type { StrategyRepository } from "@/src/server/strategy-store";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.uuid() }).strict();
type Context = { params: Promise<{ id: string }> };

export function createStrategyItemHandlers(
  store: StrategyRepository,
  deleteStrategy: (id: string, expectedRevision: number) => Promise<boolean> = (id, revision) =>
    store.delete(id, revision),
) {
  return {
    async GET(_request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const params = ParamsSchema.safeParse(await context.params);
      if (!params.success) return apiError(400, "invalid_request", "전략 id를 확인해 주세요.", id);
      try {
        const strategy = await store.get(params.data.id);
        return strategy
          ? jsonNoStore({ strategy, requestId: id })
          : apiError(404, "not_found", "저장 전략을 찾지 못했습니다.", id);
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
    async PATCH(request: Request, context: Context): Promise<Response> {
      const body = await readJsonBody(request);
      if (!body.ok) return body.response;
      const id = requestId();
      const [params, input] = [
        ParamsSchema.safeParse(await context.params),
        UpdateStoredStrategySchema.safeParse(body.value),
      ];
      if (!params.success || !input.success) {
        return apiError(
          422,
          "invalid_document",
          "전략 id, revision과 문서 구조를 확인해 주세요.",
          id,
          input.success
            ? undefined
            : input.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
        );
      }
      try {
        return jsonNoStore({
          strategy: await store.update(params.data.id, input.data),
          requestId: id,
        });
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
    async DELETE(request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const url = new URL(request.url);
      const params = ParamsSchema.safeParse(await context.params);
      const revision = z.coerce
        .number()
        .int()
        .positive()
        .safeParse(url.searchParams.get("expectedRevision"));
      if (!params.success || !revision.success) {
        return apiError(400, "invalid_request", "전략 id와 expectedRevision을 확인해 주세요.", id);
      }
      try {
        const removed = await deleteStrategy(params.data.id, revision.data);
        if (!removed) return apiError(404, "not_found", "저장 전략을 찾지 못했습니다.", id);
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
  };
}

const management = getStrategyManagementService();
const handlers = createStrategyItemHandlers(getStrategyRepository(), (id, revision) =>
  management.deleteStrategy(id, revision),
);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
