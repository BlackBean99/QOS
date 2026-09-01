import { jsonNoStore, requestId } from "@/src/server/http";
import { getLocalSettingsStore, type LocalSettingsStore } from "@/src/server/local-settings";
import { getTelegramClient, type TelegramClient, TelegramError } from "@/src/server/telegram";
import { telegramErrorResponse } from "@/src/server/telegram-http";

export const runtime = "nodejs";

export function createSendTelegramTest(client: TelegramClient, store: LocalSettingsStore) {
  return async function post(): Promise<Response> {
    const id = requestId();
    try {
      const settings = await store.get();
      if (!settings.telegram) {
        throw new TelegramError("no_private_chat", "Telegram 채팅을 먼저 연결해 주세요.");
      }
      await client.sendMessage(
        settings.telegram.chatId,
        `QOS 알림 테스트\n연결 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n실제 주문은 실행하지 않습니다.`,
      );
      return jsonNoStore({ sent: true, requestId: id });
    } catch (error) {
      return telegramErrorResponse(error, id);
    }
  };
}

export async function POST(): Promise<Response> {
  const id = requestId();
  try {
    return await createSendTelegramTest(getTelegramClient(), getLocalSettingsStore())();
  } catch (error) {
    return telegramErrorResponse(error, id);
  }
}
