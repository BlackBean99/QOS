import { NewStoredStrategySchema } from "@/src/domain/stored-strategy";
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

export function createStrategyCollectionHandlers(store: StrategyRepository) {
  return {
    async GET(): Promise<Response> {
      const id = requestId();
      try {
        return jsonNoStore({ strategies: await store.list(), requestId: id });
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
    async POST(request: Request): Promise<Response> {
      const body = await readJsonBody(request);
      if (!body.ok) return body.response;
      const id = requestId();
      const parsed = NewStoredStrategySchema.safeParse(body.value);
      if (!parsed.success) {
        return apiError(
          422,
          "invalid_document",
          "전략과 차트 설정을 확인해 주세요.",
          id,
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }
      try {
        return jsonNoStore({ strategy: await store.create(parsed.data), requestId: id }, 201);
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
  };
}

const handlers = createStrategyCollectionHandlers(getStrategyRepository());
export const GET = handlers.GET;
export const POST = handlers.POST;
