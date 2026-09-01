import { z } from "zod";

import type { BacktestRunListItem } from "@/src/domain/strategy-history";
import { getStrategyManagementService } from "@/src/server/strategy-management-factory";
import { apiError, jsonNoStore, requestId, strategyStoreErrorResponse } from "@/src/server/http";

export const runtime = "nodejs";

const LimitSchema = z.coerce.number().int().min(1).max(50).default(20);

interface Service {
  listAllBacktests(limit: number): Promise<BacktestRunListItem[]>;
}

export function createBacktestRunCollectionHandler(service: Service) {
  return async function GET(request: Request): Promise<Response> {
    const id = requestId();
    const limit = LimitSchema.safeParse(
      new URL(request.url).searchParams.get("limit") ?? undefined,
    );
    if (!limit.success) {
      return apiError(400, "invalid_request", "조회 개수를 확인해 주세요.", id);
    }
    try {
      return jsonNoStore({ runs: await service.listAllBacktests(limit.data), requestId: id });
    } catch (error) {
      return strategyStoreErrorResponse(error, id);
    }
  };
}

export const GET = createBacktestRunCollectionHandler(getStrategyManagementService());
