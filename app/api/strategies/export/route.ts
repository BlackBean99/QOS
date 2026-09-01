import { requestId, strategyStoreErrorResponse } from "@/src/server/http";
import { getStrategyRepository } from "@/src/server/strategy-repository";
import type { StrategyRepository } from "@/src/server/strategy-store";

export const runtime = "nodejs";

export function createExportStrategies(store: StrategyRepository) {
  return async function get(): Promise<Response> {
    const id = requestId();
    try {
      return new Response(`${JSON.stringify(await store.exportAll())}\n`, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="qos-strategies.json"',
        },
      });
    } catch (error) {
      return strategyStoreErrorResponse(error, id);
    }
  };
}

export const GET = createExportStrategies(getStrategyRepository());
