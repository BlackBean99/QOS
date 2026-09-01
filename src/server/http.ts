import { TossProviderError, type TossProviderErrorCode } from "./toss/client";
import { StrategyStoreError, type StrategyStoreErrorCode } from "./strategy-store";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

export function requestId(): string {
  return crypto.randomUUID();
}

export function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  id: string,
  issues?: Array<{ path: string; message: string }>,
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: id,
      ...(issues ? { issues } : {}),
    },
  };
  return jsonNoStore(body, status);
}

function isProviderError(error: unknown): error is TossProviderError {
  return (
    error instanceof TossProviderError ||
    (error instanceof Error &&
      error.name === "TossProviderError" &&
      typeof (error as { code?: unknown }).code === "string")
  );
}

export function tossErrorResponse(error: unknown, id: string): Response {
  if (!isProviderError(error)) {
    return apiError(503, "unavailable", "시장 데이터 서버를 사용할 수 없습니다.", id);
  }
  const code = (error as TossProviderError).code as TossProviderErrorCode;
  const statusByCode: Record<TossProviderErrorCode, number> = {
    missing_config: 503,
    unauthorized: 401,
    forbidden: 403,
    invalid_request: 400,
    not_found: 404,
    rate_limited: 429,
    timeout: 504,
    unavailable: 503,
    invalid_response: 502,
  };
  const messageByCode: Record<TossProviderErrorCode, string> = {
    missing_config: "TOSS OpenAPI 서버 설정이 필요합니다.",
    unauthorized: "TOSS OpenAPI 인증을 확인해 주세요.",
    forbidden: "TOSS OpenAPI 허용 IP 또는 권한을 확인해 주세요.",
    invalid_request: "시장 데이터 요청값을 확인해 주세요.",
    not_found: "요청한 시장 데이터를 찾지 못했습니다.",
    rate_limited: "시장 데이터 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
    timeout: "시장 데이터 응답 시간이 초과되었습니다.",
    unavailable: "시장 데이터를 일시적으로 사용할 수 없습니다.",
    invalid_response: "시장 데이터 응답을 검증하지 못했습니다.",
  };
  return apiError(
    statusByCode[code] ?? 503,
    code,
    messageByCode[code] ?? messageByCode.unavailable,
    id,
  );
}

export async function readJsonBody(
  request: Request,
  maximumBytes = 1_000_000,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const id = requestId();
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return {
      ok: false,
      response: apiError(
        413,
        "payload_too_large",
        "JSON 요청 크기가 허용 범위를 초과했습니다.",
        id,
      ),
    };
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      return {
        ok: false,
        response: apiError(
          413,
          "payload_too_large",
          "JSON 요청 크기가 허용 범위를 초과했습니다.",
          id,
        ),
      };
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: apiError(400, "invalid_json", "유효한 JSON 요청이 필요합니다.", id),
    };
  }
}

export function strategyStoreErrorResponse(error: unknown, id: string): Response {
  if (!(error instanceof StrategyStoreError)) {
    return apiError(500, "store_unavailable", "전략 저장소를 사용할 수 없습니다.", id);
  }
  const statusByCode: Record<StrategyStoreErrorCode, number> = {
    invalid_document: 422,
    corrupt_store: 500,
    invalid_response: 502,
    missing_config: 503,
    schema_missing: 503,
    unavailable: 503,
    rate_limited: 429,
    not_found: 404,
    revision_conflict: 409,
    id_conflict: 409,
    store_too_large: 507,
  };
  const messageByCode: Record<StrategyStoreErrorCode, string> = {
    invalid_document: "전략 JSON 구조를 확인해 주세요.",
    corrupt_store: "전략 저장 파일이 손상되었습니다. backup 또는 export를 확인해 주세요.",
    invalid_response: "전략 저장소 응답을 검증하지 못했습니다.",
    missing_config: "Supabase 서버 설정을 확인해 주세요.",
    schema_missing: "Supabase 전략 migration을 먼저 적용해 주세요.",
    unavailable: "Supabase 전략 저장소에 연결할 수 없습니다.",
    rate_limited: "Supabase 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
    not_found: "저장 전략을 찾지 못했습니다.",
    revision_conflict: "다른 변경이 먼저 저장되었습니다. 목록을 새로 불러와 주세요.",
    id_conflict: "같은 id의 전략이 이미 존재합니다. clone으로 새 id를 만들 수 있습니다.",
    store_too_large: "전략 저장 파일이 허용 크기를 초과했습니다.",
  };
  return apiError(statusByCode[error.code], error.code, messageByCode[error.code], id);
}
