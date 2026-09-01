import { z } from "zod";
import {
  BacktestWindowError,
  BacktestWindowInputSchema,
  type BacktestWindowInput,
} from "@/src/domain/backtest-window";

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
  runBacktest(
    id: string,
    window?: BacktestWindowInput,
  ): Promise<{ run: StoredBacktestRun; result: unknown }>;
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
    async POST(request: Request, context: Context): Promise<Response> {
      const id = requestId();
      const params = ParamsSchema.safeParse(await context.params);
      if (!params.success) return apiError(400, "invalid_request", "전략 id를 확인해 주세요.", id);
      let candidate: unknown = {};
      try {
        const contentLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 20_000) {
          return apiError(413, "payload_too_large", "기간 요청 크기가 너무 큽니다.", id);
        }
        const source = await request.text();
        if (new TextEncoder().encode(source).byteLength > 20_000) {
          return apiError(413, "payload_too_large", "기간 요청 크기가 너무 큽니다.", id);
        }
        candidate = source.trim() ? (JSON.parse(source) as unknown) : {};
      } catch {
        return apiError(400, "invalid_json", "유효한 JSON 기간 요청이 필요합니다.", id);
      }
      const body = z
        .object({ window: BacktestWindowInputSchema.optional() })
        .strict()
        .safeParse(candidate);
      if (!body.success) {
        return apiError(
          422,
          "invalid_backtest_window",
          "백테스트 시작일과 종료일을 확인해 주세요.",
          id,
          body.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }
      try {
        const completed = await service.runBacktest(params.data.id, body.data.window);
        return jsonNoStore(
          { run: toBacktestRunListItem(completed.run), result: completed.result, requestId: id },
          201,
        );
      } catch (error) {
        if (error instanceof BacktestWindowError) {
          return apiError(422, "invalid_backtest_window", error.message, id);
        }
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
