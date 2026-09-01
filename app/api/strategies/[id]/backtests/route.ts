import { z } from "zod";

import {
  toBacktestRunListItem,
  type BacktestRunListItem,
  type StoredBacktestRun,
} from "@/src/domain/strategy-history";
import { getStrategyManagementService } from "@/src/server/strategy-management-factory";
import {
  apiError,
  jsonNoStore,
  requestId,
  strategyStoreErrorResponse,
  tossErrorResponse,
} from "@/src/server/http";
import { StrategyStoreError } from "@/src/server/strategy-store";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.uuid() }).strict();
const LimitSchema = z.coerce.number().int().min(1).max(50).default(20);
type Context = { params: Promise<{ id: string }> };
interface Service {
  runBacktest(id: string): Promise<{ run: StoredBacktestRun; result: unknown }>;
  listBacktests(id: string, limit: number): Promise<BacktestRunListItem[]>;
}

export function createStrategyBacktestHandlers(service: Service) {
  return {
    async GET(request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const params = ParamsSchema.safeParse(await context.params);
      const limit = LimitSchema.safeParse(
        new URL(request.url).searchParams.get("limit") ?? undefined,
      );
      if (!params.success || !limit.success) {
        return apiError(400, "invalid_request", "전략 id와 조회 개수를 확인해 주세요.", id);
      }
      try {
        return jsonNoStore({
          runs: await service.listBacktests(params.data.id, limit.data),
          requestId: id,
        });
      } catch (error) {
        return strategyStoreErrorResponse(error, id);
      }
    },
    async POST(_request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const params = ParamsSchema.safeParse(await context.params);
      if (!params.success) return apiError(400, "invalid_request", "전략 id를 확인해 주세요.", id);
      try {
        const completed = await service.runBacktest(params.data.id);
        return jsonNoStore(
          { run: toBacktestRunListItem(completed.run), result: completed.result, requestId: id },
          201,
        );
      } catch (error) {
        return error instanceof StrategyStoreError
          ? strategyStoreErrorResponse(error, id)
          : tossErrorResponse(error, id);
      }
    },
  };
}

const handlers = createStrategyBacktestHandlers(getStrategyManagementService());
export const GET = handlers.GET;
export const POST = handlers.POST;
