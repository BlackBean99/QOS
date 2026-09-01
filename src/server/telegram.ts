import { z } from "zod";

import type { LocalSettingsStore } from "./local-settings";

const TelegramEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    description: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();

const BotSchema = z
  .object({
    id: z.number(),
    is_bot: z.literal(true),
    username: z.string().min(1),
  })
  .passthrough();

const UpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        from: z.object({ is_bot: z.boolean() }).passthrough().optional(),
        chat: z
          .object({
            id: z.number().int(),
            type: z.string(),
            first_name: z.string().optional(),
            last_name: z.string().optional(),
            username: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TelegramErrorCode =
  | "missing_config"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "no_private_chat"
  | "ambiguous_chat";

export class TelegramError extends Error {
  readonly code: TelegramErrorCode;
  readonly status?: number;

  constructor(code: TelegramErrorCode, message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "TelegramError";
    this.code = code;
    this.status = status;
  }
}

interface TelegramClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TelegramClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;

  constructor(options: TelegramClientOptions) {
    if (!options.token.trim()) {
      throw new TelegramError("missing_config", "TELEGRAM_BOT_TOKEN 서버 설정이 필요합니다.");
    }
    this.#baseUrl = `https://api.telegram.org/bot${options.token}`;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async #call(method: string, body?: unknown): Promise<unknown> {
    let lastError: TelegramError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetch(`${this.#baseUrl}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        });
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await this.#sleep(
            Number.isFinite(retryAfter) ? Math.min(1_000, Math.max(0, retryAfter * 1_000)) : 250,
          );
          lastError = new TelegramError(
            response.status === 429 ? "rate_limited" : "unavailable",
            "Telegram API를 일시적으로 사용할 수 없습니다.",
            response.status,
          );
          continue;
        }
        if (!response.ok) {
          const code = response.status === 401 ? "unauthorized" : "unavailable";
          throw new TelegramError(code, "Telegram Bot API 요청에 실패했습니다.", response.status);
        }
        const envelope = TelegramEnvelopeSchema.safeParse(await response.json());
        if (!envelope.success || !envelope.data.ok || envelope.data.result === undefined) {
          throw new TelegramError(
            "invalid_response",
            "Telegram Bot API 응답을 검증하지 못했습니다.",
          );
        }
        return envelope.data.result;
      } catch (error) {
        if (error instanceof TelegramError) throw error;
        lastError = new TelegramError(
          "unavailable",
          "Telegram Bot API 연결 시간이 초과되었습니다.",
          undefined,
          { cause: error },
        );
        if (attempt === 0) {
          await this.#sleep(250);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new TelegramError("unavailable", "Telegram Bot API를 사용할 수 없습니다.");
  }

  async getMe(): Promise<z.infer<typeof BotSchema>> {
    const parsed = BotSchema.safeParse(await this.#call("getMe"));
    if (!parsed.success)
      throw new TelegramError("invalid_response", "Telegram 봇 정보를 검증하지 못했습니다.");
    return parsed.data;
  }

  async getUpdates(): Promise<Array<z.infer<typeof UpdateSchema>>> {
    const parsed = z
      .array(UpdateSchema)
      .safeParse(
        await this.#call("getUpdates", { timeout: 0, limit: 100, allowed_updates: ["message"] }),
      );
    if (!parsed.success)
      throw new TelegramError("invalid_response", "Telegram update를 검증하지 못했습니다.");
    return parsed.data;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.#call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  }
}

export function getTelegramClient(): TelegramClient {
  return new TelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN ?? "" });
}

export async function connectTelegramChat(
  client: TelegramClient,
  store: LocalSettingsStore,
  options: { sendTest?: boolean } = {},
): Promise<{ username: string; displayName: string; testSent: boolean }> {
  const [bot, updates] = await Promise.all([client.getMe(), client.getUpdates()]);
  const candidates = new Map<string, { chatId: string; displayName: string }>();
  for (const update of updates) {
    const message = update.message;
    if (!message || message.chat.type !== "private" || message.from?.is_bot) continue;
    const displayName =
      [message.chat.first_name, message.chat.last_name].filter(Boolean).join(" ").trim() ||
      message.chat.username ||
      "Telegram 사용자";
    candidates.set(String(message.chat.id), { chatId: String(message.chat.id), displayName });
  }
  if (candidates.size === 0) {
    throw new TelegramError(
      "no_private_chat",
      "봇에게 일반 메시지를 한 번 보낸 뒤 다시 연결해 주세요.",
    );
  }
  if (candidates.size > 1) {
    throw new TelegramError(
      "ambiguous_chat",
      "여러 private chat이 감지되어 자동 선택하지 않았습니다.",
    );
  }
  const candidate = [...candidates.values()][0];
  await store.setTelegram({
    ...candidate,
    username: bot.username,
    connectedAt: new Date().toISOString(),
  });
  if (options.sendTest) {
    await client.sendMessage(
      candidate.chatId,
      "QOS Telegram 연결 완료\n완성 봉 BUY/SELL 신호가 감지되면 이 채팅으로 알립니다.",
    );
  }
  return {
    username: bot.username,
    displayName: candidate.displayName,
    testSent: options.sendTest ?? false,
  };
}
