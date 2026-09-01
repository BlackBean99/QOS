import { apiError } from "./http";
import { TelegramError, type TelegramErrorCode } from "./telegram";

export function telegramErrorResponse(error: unknown, requestId: string): Response {
  if (!(error instanceof TelegramError)) {
    return apiError(503, "telegram_unavailable", "Telegram 연결을 사용할 수 없습니다.", requestId);
  }
  const status: Record<TelegramErrorCode, number> = {
    missing_config: 503,
    unauthorized: 401,
    rate_limited: 429,
    unavailable: 503,
    invalid_response: 502,
    no_private_chat: 409,
    ambiguous_chat: 409,
  };
  return apiError(status[error.code], error.code, error.message, requestId);
}
