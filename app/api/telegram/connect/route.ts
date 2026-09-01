import { z } from "zod";

import { apiError, jsonNoStore, readJsonBody, requestId } from "@/src/server/http";
import { getLocalSettingsStore, type LocalSettingsStore } from "@/src/server/local-settings";
import { connectTelegramChat, getTelegramClient, type TelegramClient } from "@/src/server/telegram";
import { telegramErrorResponse } from "@/src/server/telegram-http";

export const runtime = "nodejs";

const RequestSchema = z.object({ sendTest: z.boolean().default(true) }).strict();

export function createConnectTelegram(client: TelegramClient, store: LocalSettingsStore) {
  return async function post(request: Request): Promise<Response> {
    const body = await readJsonBody(request, 10_000);
    if (!body.ok) return body.response;
    const id = requestId();
    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) return apiError(400, "invalid_request", "연결 요청을 확인해 주세요.", id);
    try {
      return jsonNoStore({
        ...(await connectTelegramChat(client, store, parsed.data)),
        requestId: id,
      });
    } catch (error) {
      return telegramErrorResponse(error, id);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const id = requestId();
  try {
    return await createConnectTelegram(getTelegramClient(), getLocalSettingsStore())(request);
  } catch (error) {
    return telegramErrorResponse(error, id);
  }
}
