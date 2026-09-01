import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MonitorRunner } from "@/src/monitor/runner";
import { MonitorStateStore } from "@/src/monitor/state-store";
import { getInstrumentFixture } from "@/src/fixtures/markets";
import { LocalSettingsStore } from "@/src/server/local-settings";
import { StrategyStore } from "@/src/server/strategy-store";
import type { TelegramClient } from "@/src/server/telegram";
import type { TossClient } from "@/src/server/toss/client";
import type { RealtimeTrade } from "@/src/server/toss/realtime";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MonitorRunner", () => {
  it("retries a failed delivery in-process and records one idempotent sent signal", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-runner-"));
    directories.push(directory);
    const strategyStore = new StrategyStore({ filePath: path.join(directory, "strategies.json") });
    const settingsStore = new LocalSettingsStore({
      filePath: path.join(directory, "settings.json"),
    });
    const stateStore = new MonitorStateStore({ filePath: path.join(directory, "state.json") });
    const fixture = getInstrumentFixture("NASDAQ:AAPL");
    const signalCandles = fixture.candles.slice(0, 21);
    const latestTimestamp = `${signalCandles.at(-1)?.date}T14:30:00.000Z`;
    await settingsStore.setTelegram({
      chatId: "123",
      displayName: "Tester",
      username: "qos_bot",
      connectedAt: new Date().toISOString(),
    });
    await strategyStore.create({
      name: "AAPL breakout",
      description: "",
      instrument: {
        instrumentId: "NASDAQ:AAPL",
        market: "NASDAQ",
        symbol: "AAPL",
        displayName: "Apple",
        currency: "USD",
        timezone: "America/New_York",
        synthetic: false,
        securityType: "STOCK",
        isinCode: "US0378331005",
      },
      strategy: {
        version: 1,
        name: "AAPL Breakout 20",
        market: "NASDAQ",
        instrumentId: "NASDAQ:AAPL",
        timeframe: "1d",
        entry: {
          price: { kind: "rolling_high_breakout", period: 20 },
          volume: { kind: "volume_ratio_above", period: 20, ratio: 2 },
        },
        exit: { kind: "trailing_stop", percent: 5 },
        assumptions: {
          signalAt: "session_close",
          fillAt: "next_session_open",
          positionSizing: "all_in_single_asset",
        },
      },
      chart: {
        version: 1,
        period: "1d",
        theme: "upbit-light",
        mainIndicators: ["MA"],
        subIndicators: ["VOL"],
        drawings: [],
        visibleRange: null,
      },
      monitor: { enabled: true, interval: "1d" },
    });
    const tossClient = {
      getCandles: vi.fn(async () => ({
        candles: signalCandles.map((candle) => ({
          timestamp: `${candle.date}T14:30:00.000Z`,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          currency: "USD",
        })),
        nextBefore: null,
      })),
    } as unknown as TossClient;
    const sendMessage = vi
      .fn<(chatId: string, text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary Telegram failure"))
      .mockResolvedValue(undefined);
    const telegramClient = { sendMessage } as unknown as TelegramClient;
    let emitTrade: ((trade: RealtimeTrade) => void) | undefined;
    const runner = new MonitorRunner({
      strategyStore,
      settingsStore,
      stateStore,
      tossClient,
      telegramClient,
      now: () => new Date(Date.parse(latestTimestamp) + 8 * 60 * 60_000),
      pollMilliseconds: 60_000,
      createRealtimeConnection: (options) => {
        emitTrade = options.onTrade;
        return {
          start: async () => options.onStatus?.("connected"),
          stop: () => undefined,
          updateInstruments: () => undefined,
        };
      },
    });

    await runner.start();
    emitTrade?.({
      marketRegion: "us",
      symbol: "AAPL",
      price: signalCandles.at(-1)?.close ?? 0,
      volume: 1,
      timestamp: latestTimestamp,
      currency: "USD",
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    await runner.stop();

    expect(sendMessage.mock.calls[1]?.[1]).toContain("QOS BUY 신호");
    await expect(stateStore.publicStatus()).resolves.toMatchObject({ deliveredSignals: 1 });
  });
});
