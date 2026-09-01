import type { StoredStrategy } from "@/src/domain/stored-strategy";
import type { IntradayFixture } from "@/src/fixtures/intraday";
import type { Candle, MarketFixture } from "@/src/fixtures/markets";
import { logServerEvent } from "@/src/server/logging";
import { getLocalSettingsStore, type LocalSettingsStore } from "@/src/server/local-settings";
import { getStrategyRepository } from "@/src/server/strategy-repository";
import type { StrategyRepository } from "@/src/server/strategy-store";
import { getTelegramClient, type TelegramClient } from "@/src/server/telegram";
import { getTossClient, type TossClient } from "@/src/server/toss/client";
import { loadTossDataset, loadTossStrategyDataset } from "@/src/server/toss/datasets";
import {
  TossRealtimeConnection,
  type RealtimeConnectionOptions,
  type RealtimeStatus,
  type RealtimeTrade,
} from "@/src/server/toss/realtime";
import { evaluateCompletedBarSignal } from "./signal-evaluator";
import { getMonitorStateStore, type MonitorStateStore } from "./state-store";

interface MonitorRunnerOptions {
  strategyStore?: StrategyRepository;
  settingsStore?: LocalSettingsStore;
  stateStore?: MonitorStateStore;
  tossClient?: TossClient;
  telegramClient?: TelegramClient;
  pollMilliseconds?: number;
  now?: () => Date;
  createRealtimeConnection?: (options: RealtimeConnectionOptions) => RealtimeConnectionLike;
}

interface RealtimeConnectionLike {
  start: () => Promise<void>;
  stop: () => void;
  updateInstruments: (instruments: RealtimeConnectionOptions["instruments"]) => void;
}

function mergeCandles(existing: Candle[], incoming: Candle[], limit: number): Candle[] {
  const values = new Map([...existing, ...incoming].map((candle) => [candle.date, candle]));
  return [...values.values()]
    .toSorted((left, right) => Date.parse(left.date) - Date.parse(right.date))
    .slice(-limit);
}

function marketClock(timestamp: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function completedDataset(
  dataset: MarketFixture | IntradayFixture,
  document: StoredStrategy,
  now: Date,
): MarketFixture | IntradayFixture {
  const duration = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "60m": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000,
  }[document.strategy.timeframe];
  if (document.strategy.timeframe !== "1d" && document.strategy.timeframe !== "1w") {
    return {
      ...dataset,
      candles: dataset.candles.filter(
        (candle) => Date.parse(candle.date) + duration <= now.getTime() - 5_000,
      ),
    };
  }
  const current = marketClock(now, document.instrument.timezone);
  const closeMinutes = document.instrument.currency === "KRW" ? 15 * 60 + 35 : 16 * 60 + 5;
  return {
    ...dataset,
    candles: dataset.candles.filter((candle) => {
      const candleClock = marketClock(new Date(candle.date), document.instrument.timezone);
      return candleClock.date !== current.date || current.minutes >= closeMinutes;
    }),
  };
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown_error";
}

export class MonitorRunner {
  readonly #strategyStore: StrategyRepository;
  readonly #settingsStore: LocalSettingsStore;
  readonly #stateStore: MonitorStateStore;
  readonly #tossClient: TossClient;
  readonly #telegramClient: TelegramClient;
  readonly #pollMilliseconds: number;
  readonly #now: () => Date;
  readonly #createRealtimeConnection: (
    options: RealtimeConnectionOptions,
  ) => RealtimeConnectionLike;
  readonly #datasets = new Map<string, MarketFixture | IntradayFixture>();
  readonly #lastFetchWindow = new Map<string, number>();
  readonly #lastEvaluatedBar = new Map<string, string>();
  readonly #inFlight = new Set<string>();
  #strategies: StoredStrategy[] = [];
  #connection: RealtimeConnectionLike | null = null;
  #subscriptionFingerprint = "";
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking = false;
  #realtimeStatus: RealtimeStatus = "stopped";

  constructor(options: MonitorRunnerOptions = {}) {
    this.#strategyStore = options.strategyStore ?? getStrategyRepository();
    this.#settingsStore = options.settingsStore ?? getLocalSettingsStore();
    this.#stateStore = options.stateStore ?? getMonitorStateStore();
    this.#tossClient = options.tossClient ?? getTossClient();
    this.#telegramClient = options.telegramClient ?? getTelegramClient();
    this.#pollMilliseconds = options.pollMilliseconds ?? 15_000;
    this.#now = options.now ?? (() => new Date());
    this.#createRealtimeConnection =
      options.createRealtimeConnection ??
      ((connectionOptions) => new TossRealtimeConnection(connectionOptions));
  }

  async start(): Promise<void> {
    await this.#tick();
    this.#timer = setInterval(() => void this.#tick(), this.#pollMilliseconds);
    logServerEvent("info", "monitor.started", { pollMilliseconds: this.#pollMilliseconds });
  }

  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      this.#strategies = (await this.#strategyStore.list()).filter(
        (strategy) => strategy.monitor.enabled,
      );
      await this.#syncSubscriptions();
      for (const strategy of this.#strategies) await this.#evaluate(strategy);
      const status =
        this.#strategies.length === 0
          ? "stopped"
          : this.#realtimeStatus === "connected"
            ? "connected"
            : this.#realtimeStatus === "reconnecting" || this.#realtimeStatus === "disconnected"
              ? "reconnecting"
              : "connecting";
      await this.#stateStore.heartbeat(status, this.#strategies.length);
    } catch (error) {
      const code = safeErrorCode(error);
      await this.#stateStore.heartbeat("error", this.#strategies.length, code);
      logServerEvent("error", "monitor.tick_failed", { code });
    } finally {
      this.#ticking = false;
    }
  }

  async #syncSubscriptions(): Promise<void> {
    const instruments = this.#strategies.map((strategy) => ({
      market: strategy.instrument.market,
      symbol: strategy.instrument.symbol,
    }));
    const fingerprint = [
      ...new Set(instruments.map((instrument) => `${instrument.market}:${instrument.symbol}`)),
    ]
      .toSorted()
      .join(",");
    if (!fingerprint) {
      this.#connection?.stop();
      this.#connection = null;
      this.#subscriptionFingerprint = "";
      this.#realtimeStatus = "stopped";
      return;
    }
    if (this.#connection && fingerprint === this.#subscriptionFingerprint) return;
    if (this.#connection) {
      this.#connection.updateInstruments(instruments);
      this.#subscriptionFingerprint = fingerprint;
      return;
    }
    this.#connection = this.#createRealtimeConnection({
      client: this.#tossClient,
      instruments,
      onTrade: (trade) => void this.#onTrade(trade),
      onStatus: (status) => {
        this.#realtimeStatus = status;
        logServerEvent("info", "monitor.stream_status", { status });
      },
      onError: (error) => {
        logServerEvent("warn", "monitor.stream_error", { code: safeErrorCode(error) });
      },
    });
    this.#subscriptionFingerprint = fingerprint;
    await this.#connection.start();
  }

  async #onTrade(trade: RealtimeTrade): Promise<void> {
    for (const strategy of this.#strategies.filter(
      (candidate) => candidate.instrument.symbol === trade.symbol,
    )) {
      await this.#evaluate(strategy);
    }
  }

  async #loadDataset(document: StoredStrategy): Promise<MarketFixture | IntradayFixture> {
    const now = this.#now();
    const duration = {
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "30m": 1_800_000,
      "60m": 3_600_000,
      "4h": 14_400_000,
      "1d": 86_400_000,
      "1w": 604_800_000,
    }[document.strategy.timeframe];
    const window =
      document.strategy.timeframe !== "1d" && document.strategy.timeframe !== "1w"
        ? Math.floor(now.getTime() / duration)
        : Number(marketClock(now, document.instrument.timezone).date.replaceAll("-", ""));
    const existing = this.#datasets.get(document.id);
    if (existing && this.#lastFetchWindow.get(document.id) === window) return existing;
    const incremental =
      document.strategy.version === 3
        ? await loadTossStrategyDataset(
            this.#tossClient,
            document.instrument,
            document.strategy.timeframe,
            { targetBars: existing ? 40 : 1_200 },
          )
        : document.strategy.timeframe === "5m"
          ? await loadTossDataset(this.#tossClient, document.instrument, "5m", {
              targetBars: existing ? 40 : 1_200,
            })
          : await loadTossDataset(this.#tossClient, document.instrument, "1d", {
              targetBars: existing ? 10 : 200,
            });
    const merged = existing
      ? {
          ...incremental,
          ...(document.strategy.timeframe === "5m" ? { timeframe: "5m" as const } : {}),
          candles: mergeCandles(
            existing.candles,
            incremental.candles,
            document.strategy.version === 3
              ? 1_500
              : document.strategy.timeframe === "5m"
                ? 1_500
                : 250,
          ),
        }
      : incremental;
    this.#datasets.set(document.id, merged);
    this.#lastFetchWindow.set(document.id, window);
    return merged;
  }

  async #evaluate(document: StoredStrategy): Promise<void> {
    if (this.#inFlight.has(document.id)) return;
    this.#inFlight.add(document.id);
    try {
      const dataset = completedDataset(await this.#loadDataset(document), document, this.#now());
      const latest = dataset.candles.at(-1);
      if (!latest || this.#lastEvaluatedBar.get(document.id) === latest.date) return;
      const signal = evaluateCompletedBarSignal(document, dataset);
      if (!signal) {
        this.#lastEvaluatedBar.set(document.id, latest.date);
        return;
      }
      const age = this.#now().getTime() - Date.parse(signal.barTimestamp);
      const duration = {
        "1m": 60_000,
        "5m": 300_000,
        "15m": 900_000,
        "30m": 1_800_000,
        "60m": 3_600_000,
        "4h": 14_400_000,
        "1d": 86_400_000,
        "1w": 604_800_000,
      }[document.strategy.timeframe];
      const maximumAge =
        document.strategy.timeframe === "1d" || document.strategy.timeframe === "1w"
          ? 8 * 24 * 60 * 60_000
          : duration * 3;
      if (!Number.isFinite(age) || age < 0 || age > maximumAge) {
        this.#lastEvaluatedBar.set(document.id, latest.date);
        return;
      }
      const key = `${document.id}:${document.revision}:${signal.side}:${signal.barTimestamp}`;
      if (!(await this.#stateStore.shouldDeliver(key))) {
        this.#lastEvaluatedBar.set(document.id, latest.date);
        return;
      }
      const settings = await this.#settingsStore.get();
      if (!settings.telegram) {
        logServerEvent("warn", "monitor.telegram_not_connected", { strategyId: document.id });
        return;
      }
      const message = [
        `QOS ${signal.side} 신호`,
        `${document.name}`,
        `${document.instrument.displayName} (${document.instrument.symbol}) · ${document.instrument.market}`,
        `가격: ${signal.price.toLocaleString("ko-KR")} ${document.instrument.currency}`,
        `완성 봉: ${signal.barTimestamp} · ${document.strategy.timeframe}`,
        `근거: ${signal.reason}`,
        "Paper signal only · 실제 주문 없음",
      ].join("\n");
      try {
        await this.#telegramClient.sendMessage(settings.telegram.chatId, message);
        await this.#stateStore.recordDelivery(key, "sent");
        this.#lastEvaluatedBar.set(document.id, latest.date);
        logServerEvent("info", "monitor.signal_delivered", {
          strategyId: document.id,
          instrumentId: signal.instrumentId,
          side: signal.side,
          barTimestamp: signal.barTimestamp,
        });
      } catch (error) {
        const code = safeErrorCode(error);
        await this.#stateStore.recordDelivery(key, "failed", code);
        if (!(await this.#stateStore.shouldDeliver(key))) {
          this.#lastEvaluatedBar.set(document.id, latest.date);
        }
        logServerEvent("error", "monitor.signal_delivery_failed", {
          strategyId: document.id,
          instrumentId: signal.instrumentId,
          side: signal.side,
          barTimestamp: signal.barTimestamp,
          code,
        });
      }
    } finally {
      this.#inFlight.delete(document.id);
    }
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#connection?.stop();
    this.#connection = null;
    await this.#stateStore.heartbeat("stopped", 0);
    logServerEvent("info", "monitor.stopped");
  }
}
