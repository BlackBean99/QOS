import { z } from "zod";

import type { StrategyManagementService } from "@/src/server/strategy-management";
import { getStrategyManagementService } from "@/src/server/strategy-management-factory";
import { apiError, jsonNoStore, requestId, strategyStoreErrorResponse } from "@/src/server/http";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.uuid() }).strict();
type Context = { params: Promise<{ id: string }> };
type Service = Pick<StrategyManagementService, "getBacktest" | "deleteBacktest">;

export function createBacktestRunHandlers(service: Service) {
  return {
    async GET(_request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const params = ParamsSchema.safeParse(await context.params);
      if (!params.success) return apiError(400, "invalid_request", "실행 id를 확인해 주세요.", id);
      try {
        const run = await service.getBacktest(params.data.id);
        return run
          ? jsonNoStore({ run, requestId: id })
          : apiError(404, "not_found", "백테스트 이력을 찾지 못했습니다.", id);
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
    async DELETE(_request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const params = ParamsSchema.safeParse(await context.params);
      if (!params.success) return apiError(400, "invalid_request", "실행 id를 확인해 주세요.", id);
      try {
        const removed = await service.deleteBacktest(params.data.id);
        return removed
          ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } })
          : apiError(404, "not_found", "백테스트 이력을 찾지 못했습니다.", id);
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
  };
}

const handlers = createBacktestRunHandlers(getStrategyManagementService());
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
