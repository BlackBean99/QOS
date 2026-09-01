import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalSettingsStore } from "@/src/server/local-settings";
import { TelegramClient, connectTelegramChat } from "@/src/server/telegram";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

describe("Telegram delivery", () => {
  it("connects the only private chat without requiring a /start command", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-telegram-"));
    directories.push(directory);
    const store = new LocalSettingsStore({ filePath: path.join(directory, "settings.json") });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ ok: true, result: { id: 1, is_bot: true, username: "qos_bot" } }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            {
              update_id: 11,
              message: {
                text: "hello",
                from: { id: 99, is_bot: false },
                chat: { id: 123456, type: "private", first_name: "QOS User" },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, result: { message_id: 12 } }));
    const client = new TelegramClient({
      token: "server-token",
      fetchImpl: fetchMock,
      sleep: async () => undefined,
    });

    const result = await connectTelegramChat(client, store, { sendTest: true });

    expect(result).toMatchObject({ username: "qos_bot", displayName: "QOS User", testSent: true });
    await expect(store.get()).resolves.toMatchObject({ telegram: { chatId: "123456" } });
    const sendBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(sendBody).toMatchObject({ chat_id: "123456" });
    expect(sendBody.parse_mode).toBeUndefined();
  });

  it("rejects ambiguous private chats instead of messaging the wrong person", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-telegram-"));
    directories.push(directory);
    const store = new LocalSettingsStore({ filePath: path.join(directory, "settings.json") });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ ok: true, result: { id: 1, is_bot: true, username: "qos_bot" } }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                from: { is_bot: false },
                chat: { id: 1, type: "private", first_name: "A" },
              },
            },
            {
              update_id: 2,
              message: {
                from: { is_bot: false },
                chat: { id: 2, type: "private", first_name: "B" },
              },
            },
          ],
        }),
      );
    const client = new TelegramClient({
      token: "token",
      fetchImpl: fetchMock,
      sleep: async () => undefined,
    });

    await expect(connectTelegramChat(client, store)).rejects.toMatchObject({
      code: "ambiguous_chat",
    });
    await expect(store.get()).resolves.toMatchObject({ telegram: null });
  });

  it("retries Telegram 429 with bounded delay", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ ok: false, description: "rate limited" }, 429, { "retry-after": "30" }),
      )
      .mockResolvedValueOnce(response({ ok: true, result: { message_id: 1 } }));
    const client = new TelegramClient({
      token: "token",
      fetchImpl: fetchMock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    await expect(client.sendMessage("1", "BUY AAPL")).resolves.toBeUndefined();
    expect(sleeps).toEqual([1_000]);
  });
});
