import { jsonNoStore, requestId } from "@/src/server/http";
import { getLocalSettingsStore, type LocalSettingsStore } from "@/src/server/local-settings";

export const runtime = "nodejs";

export function createGetTelegramStatus(store: LocalSettingsStore) {
  return async function get(): Promise<Response> {
    const settings = await store.get();
    return jsonNoStore({
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      connected: settings.telegram !== null,
      botUsername: settings.telegram?.username ?? null,
      displayName: settings.telegram?.displayName ?? null,
      connectedAt: settings.telegram?.connectedAt ?? null,
      requestId: requestId(),
    });
  };
}

export const GET = createGetTelegramStatus(getLocalSettingsStore());
