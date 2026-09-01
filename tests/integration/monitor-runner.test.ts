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
import { createPresetStrategyV3 } from "@/src/domain/strategy-v3/catalog";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MonitorRunner", () => {
  it("backs off failed provider loads instead of retrying for every realtime trade", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-runner-"));
    directories.push(directory);
    const strategyStore = new StrategyStore({ filePath: path.join(directory, "strategies.json") });
    const settingsStore = new LocalSettingsStore({
      filePath: path.join(directory, "settings.json"),
    });
    const stateStore = new MonitorStateStore({ filePath: path.join(directory, "state.json") });
    const instrument = {
      instrumentId: "NASDAQ:AAPL" as const,
      market: "NASDAQ" as const,
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD" as const,
      timezone: "America/New_York" as const,
      synthetic: false,
      securityType: "STOCK",
      isinCode: "US0378331005",
    };
    await strategyStore.create({
      name: "EMA",
      description: "provider backoff test",
      instrument,
      strategy: createPresetStrategyV3("ema-crossover", instrument.instrumentId, {
        timeframe: "1m",
      }),
      chart: {
        version: 1,
        period: "1m",
        theme: "upbit-light",
        mainIndicators: ["EMA"],
        subIndicators: ["VOL"],
        drawings: [],
        visibleRange: null,
      },
      monitor: { enabled: true, interval: "1m" },
    });
    const getCandles = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    let clock = new Date("2026-09-01T15:00:00.000Z");
    let emitTrade: ((trade: RealtimeTrade) => void) | undefined;
    const runner = new MonitorRunner({
      strategyStore,
      settingsStore,
      stateStore,
      tossClient: { getCandles } as unknown as TossClient,
      telegramClient: { sendMessage: vi.fn() } as unknown as TelegramClient,
      now: () => clock,
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
    for (let index = 0; index < 5; index += 1) {
      emitTrade?.({
        marketRegion: "us",
        symbol: "AAPL",
        price: 100,
        volume: 1,
        timestamp: clock.toISOString(),
        currency: "USD",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCandles).toHaveBeenCalledTimes(1);

    clock = new Date(clock.getTime() + 31_000);
    emitTrade?.({
      marketRegion: "us",
      symbol: "AAPL",
      price: 100,
      volume: 1,
      timestamp: clock.toISOString(),
      currency: "USD",
    });
    await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(2));
    await runner.stop();
  });

  it("refetches a daily dataset after the close-completion buffer", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-runner-"));
    directories.push(directory);
    const strategyStore = new StrategyStore({ filePath: path.join(directory, "strategies.json") });
    const settingsStore = new LocalSettingsStore({
      filePath: path.join(directory, "settings.json"),
    });
    const stateStore = new MonitorStateStore({ filePath: path.join(directory, "state.json") });
    const instrument = {
      instrumentId: "NASDAQ:AAPL" as const,
      market: "NASDAQ" as const,
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD" as const,
      timezone: "America/New_York" as const,
      synthetic: false,
      securityType: "STOCK",
      isinCode: "US0378331005",
    };
    await strategyStore.create({
      name: "Daily EMA",
      description: "daily completion test",
      instrument,
      strategy: createPresetStrategyV3("ema-crossover", instrument.instrumentId, {
        timeframe: "1d",
      }),
      chart: {
        version: 1,
        period: "1d",
        theme: "upbit-light",
        mainIndicators: ["EMA"],
        subIndicators: ["VOL"],
        drawings: [],
        visibleRange: null,
      },
      monitor: { enabled: true, interval: "1d" },
    });
    const getCandles = vi.fn(async () => ({
      candles: [
        {
          timestamp: "2026-09-01T13:30:00.000Z",
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1_000,
          currency: "USD",
        },
      ],
      nextBefore: null,
    }));
    let clock = new Date("2026-09-01T19:59:00.000Z");
    let emitTrade: ((trade: RealtimeTrade) => void) | undefined;
    const runner = new MonitorRunner({
      strategyStore,
      settingsStore,
      stateStore,
      tossClient: { getCandles } as unknown as TossClient,
      telegramClient: { sendMessage: vi.fn() } as unknown as TelegramClient,
      now: () => clock,
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
    expect(getCandles).toHaveBeenCalledTimes(1);
    clock = new Date("2026-09-01T20:00:10.000Z");
    emitTrade?.({
      marketRegion: "us",
      symbol: "AAPL",
      price: 100,
      volume: 1,
      timestamp: clock.toISOString(),
      currency: "USD",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCandles).toHaveBeenCalledTimes(1);

    clock = new Date("2026-09-01T20:05:06.000Z");
    emitTrade?.({
      marketRegion: "us",
      symbol: "AAPL",
      price: 100,
      volume: 1,
      timestamp: clock.toISOString(),
      currency: "USD",
    });
    await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(2));
    await runner.stop();
  });

  it("shares one provider dataset across strategies and does not refetch after the session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-runner-"));
    directories.push(directory);
    const strategyStore = new StrategyStore({ filePath: path.join(directory, "strategies.json") });
    const settingsStore = new LocalSettingsStore({
      filePath: path.join(directory, "settings.json"),
    });
    const stateStore = new MonitorStateStore({ filePath: path.join(directory, "state.json") });
    const instrument = {
      instrumentId: "NASDAQ:AAPL" as const,
      market: "NASDAQ" as const,
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD" as const,
      timezone: "America/New_York" as const,
      synthetic: false,
      securityType: "STOCK",
      isinCode: "US0378331005",
    };
    const chart = {
      version: 1 as const,
      period: "1m" as const,
      theme: "upbit-light" as const,
      mainIndicators: ["EMA" as const],
      subIndicators: ["VOL" as const],
      drawings: [],
      visibleRange: null,
    };
    for (const presetId of ["ema-crossover", "rsi-momentum"]) {
      await strategyStore.create({
        name: presetId,
        description: "shared provider dataset test",
        instrument,
        strategy: createPresetStrategyV3(presetId, instrument.instrumentId, { timeframe: "1m" }),
        chart,
        monitor: { enabled: true, interval: "1m" },
      });
    }
    const candles = Array.from({ length: 80 }, (_, index) => ({
      timestamp: new Date(Date.parse("2026-09-01T18:00:00.000Z") + index * 60_000).toISOString(),
      open: 100 + index * 0.01,
      high: 101 + index * 0.01,
      low: 99 + index * 0.01,
      close: 100.5 + index * 0.01,
      volume: 1_000 + index,
      currency: "USD",
    }));
    const getCandles = vi.fn(async () => ({ candles, nextBefore: null }));
    let clock = new Date("2026-09-02T01:00:00.000Z"); // 21:00 New York, after close.
    let emitTrade: ((trade: RealtimeTrade) => void) | undefined;
    const runner = new MonitorRunner({
      strategyStore,
      settingsStore,
      stateStore,
      tossClient: { getCandles } as unknown as TossClient,
      telegramClient: { sendMessage: vi.fn() } as unknown as TelegramClient,
      now: () => clock,
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
    expect(getCandles).toHaveBeenCalledTimes(1);
    clock = new Date("2026-09-02T01:10:00.000Z");
    emitTrade?.({
      marketRegion: "us",
      symbol: "AAPL",
      price: 101,
      volume: 10,
      timestamp: clock.toISOString(),
      currency: "USD",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCandles).toHaveBeenCalledTimes(1);
    await expect(stateStore.publicStatus()).resolves.toMatchObject({
      providerRequests: 1,
      datasetCacheHits: expect.any(Number),
      lastProviderSyncAt: expect.any(String),
      lastStrategyRefreshAt: expect.any(String),
    });
    await runner.stop();
  });

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
