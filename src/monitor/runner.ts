import type { StoredStrategy } from "@/src/domain/stored-strategy";
import { filterCompletedBacktestCandles } from "@/src/domain/backtest-window";
import type { IntradayFixture } from "@/src/fixtures/intraday";
import type { Candle, MarketFixture } from "@/src/fixtures/markets";
import { logServerEvent } from "@/src/server/logging";
import { getLocalSettingsStore, type LocalSettingsStore } from "@/src/server/local-settings";
import { getStrategyRepository } from "@/src/server/strategy-repository";
import type { StrategyRepository } from "@/src/server/strategy-store";
import { getTelegramClient, type TelegramClient } from "@/src/server/telegram";
import { getTossClient, type TossClient } from "@/src/server/toss/client";
import { loadTossStrategyDataset } from "@/src/server/toss/datasets";
import {
  TossRealtimeConnection,
  type RealtimeConnectionOptions,
  type RealtimeStatus,
  type RealtimeTrade,
} from "@/src/server/toss/realtime";
import { evaluateCompletedBarSignal } from "./signal-evaluator";
import { getMonitorStateStore, type MonitorStateStore, type MonitorTelemetry } from "./state-store";

interface MonitorRunnerOptions {
  strategyStore?: StrategyRepository;
  settingsStore?: LocalSettingsStore;
  stateStore?: MonitorStateStore;
  tossClient?: TossClient;
  telegramClient?: TelegramClient;
  pollMilliseconds?: number;
  strategyRefreshMilliseconds?: number;
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
  return {
    ...dataset,
    candles: filterCompletedBacktestCandles(
      dataset.candles,
      document.strategy.timeframe,
      document.instrument.timezone,
      document.instrument.currency,
      now,
    ),
  };
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown_error";
}

const timeframeDuration: Record<StoredStrategy["strategy"]["timeframe"], number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "60m": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

function datasetKey(document: StoredStrategy): string {
  return `${document.instrument.instrumentId}:${document.strategy.timeframe}`;
}

function fetchWindow(document: StoredStrategy, now: Date): string {
  const clock = marketClock(now, document.instrument.timezone);
  const korean = document.instrument.currency === "KRW";
  const openMinutes = korean ? 9 * 60 : 9 * 60 + 30;
  const closeMinutes = korean ? 15 * 60 + 30 : 16 * 60;
  if (document.strategy.timeframe === "1d" || document.strategy.timeframe === "1w") {
    if (clock.minutes < openMinutes) return `${clock.date}:PRE`;
    if (clock.minutes >= closeMinutes + 5) return `${clock.date}:POST`;
    return `${clock.date}:OPEN`;
  }
  const durationMinutes = timeframeDuration[document.strategy.timeframe] / 60_000;
  if (clock.minutes < openMinutes) return `${clock.date}:PRE`;
  if (clock.minutes >= closeMinutes + 1) return `${clock.date}:POST`;
  return `${clock.date}:BAR:${Math.floor((clock.minutes - openMinutes) / durationMinutes)}`;
}

function incrementalTarget(
  document: StoredStrategy,
  dataset: MarketFixture | IntradayFixture,
  now: Date,
) {
  const latest = dataset.candles.at(-1);
  if (!latest) return 20;
  const duration = timeframeDuration[document.strategy.timeframe];
  const gap = Math.max(0, Math.ceil((now.getTime() - Date.parse(latest.date)) / duration));
  const maximum = {
    "1m": 120,
    "5m": 48,
    "15m": 20,
    "30m": 12,
    "60m": 8,
    "4h": 4,
    "1d": 10,
    "1w": 4,
  }[document.strategy.timeframe];
  return Math.max(2, Math.min(maximum, gap + 2));
}

export class MonitorRunner {
  readonly #strategyStore: StrategyRepository;
  readonly #settingsStore: LocalSettingsStore;
  readonly #stateStore: MonitorStateStore;
  readonly #tossClient: TossClient;
  readonly #telegramClient: TelegramClient;
  readonly #pollMilliseconds: number;
  readonly #strategyRefreshMilliseconds: number;
  readonly #now: () => Date;
  readonly #createRealtimeConnection: (
    options: RealtimeConnectionOptions,
  ) => RealtimeConnectionLike;
  readonly #datasets = new Map<string, MarketFixture | IntradayFixture>();
  readonly #lastFetchWindow = new Map<string, string>();
  readonly #lastEvaluatedBar = new Map<string, string>();
  readonly #evaluationInFlight = new Set<string>();
  readonly #datasetLoads = new Map<string, Promise<MarketFixture | IntradayFixture>>();
  readonly #datasetFailures = new Map<string, { attempts: number; retryAt: number }>();
  #strategies: StoredStrategy[] = [];
  #connection: RealtimeConnectionLike | null = null;
  #subscriptionFingerprint = "";
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking = false;
  #realtimeStatus: RealtimeStatus = "stopped";
  #lastStrategyRefreshEpoch = 0;
  #providerRequests = 0;
  #datasetCacheHits = 0;
  #lastProviderSyncAt: string | null = null;
  #lastStrategyRefreshAt: string | null = null;

  constructor(options: MonitorRunnerOptions = {}) {
    this.#strategyStore = options.strategyStore ?? getStrategyRepository();
    this.#settingsStore = options.settingsStore ?? getLocalSettingsStore();
    this.#stateStore = options.stateStore ?? getMonitorStateStore();
    this.#tossClient = options.tossClient ?? getTossClient();
    this.#telegramClient = options.telegramClient ?? getTelegramClient();
    this.#pollMilliseconds = options.pollMilliseconds ?? 15_000;
    this.#strategyRefreshMilliseconds = options.strategyRefreshMilliseconds ?? 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#createRealtimeConnection =
      options.createRealtimeConnection ??
      ((connectionOptions) => new TossRealtimeConnection(connectionOptions));
  }

  async start(): Promise<void> {
    await this.#tick();
    this.#timer = setInterval(() => void this.#tick(), this.#pollMilliseconds);
    logServerEvent("info", "monitor.started", {
      pollMilliseconds: this.#pollMilliseconds,
      strategyRefreshMilliseconds: this.#strategyRefreshMilliseconds,
    });
  }

  #telemetry(): MonitorTelemetry {
    return {
      providerRequests: this.#providerRequests,
      datasetCacheHits: this.#datasetCacheHits,
      lastProviderSyncAt: this.#lastProviderSyncAt,
      lastStrategyRefreshAt: this.#lastStrategyRefreshAt,
    };
  }

  async #refreshStrategies(): Promise<void> {
    const epoch = this.#now().getTime();
    if (
      this.#lastStrategyRefreshEpoch > 0 &&
      epoch - this.#lastStrategyRefreshEpoch < this.#strategyRefreshMilliseconds
    ) {
      return;
    }
    const startedAt = performance.now();
    this.#strategies = (await this.#strategyStore.list()).filter(
      (strategy) => strategy.monitor.enabled,
    );
    this.#lastStrategyRefreshEpoch = epoch;
    this.#lastStrategyRefreshAt = this.#now().toISOString();
    const activeKeys = new Set(this.#strategies.map(datasetKey));
    for (const key of this.#datasets.keys()) {
      if (!activeKeys.has(key)) {
        this.#datasets.delete(key);
        this.#lastFetchWindow.delete(key);
        this.#datasetFailures.delete(key);
      }
    }
    logServerEvent("info", "monitor.strategy_refresh", {
      enabledStrategies: this.#strategies.length,
      datasetKeys: activeKeys.size,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      await this.#refreshStrategies();
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
      await this.#stateStore.heartbeat(status, this.#strategies.length, null, this.#telemetry());
    } catch (error) {
      const code = safeErrorCode(error);
      await this.#stateStore.heartbeat("error", this.#strategies.length, code, this.#telemetry());
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
      try {
        await this.#evaluate(strategy);
      } catch (error) {
        logServerEvent("warn", "monitor.realtime_evaluation_failed", {
          strategyId: strategy.id,
          code: safeErrorCode(error),
        });
      }
    }
  }

  async #loadDataset(document: StoredStrategy): Promise<MarketFixture | IntradayFixture> {
    const now = this.#now();
    const key = datasetKey(document);
    const window = fetchWindow(document, now);
    const existing = this.#datasets.get(key);
    if (existing && this.#lastFetchWindow.get(key) === window) {
      this.#datasetCacheHits += 1;
      return existing;
    }
    const failure = this.#datasetFailures.get(key);
    if (failure && now.getTime() < failure.retryAt) {
      this.#datasetCacheHits += 1;
      if (existing) return existing;
      const error = new Error("Provider retry backoff is active.");
      error.name = "provider_backoff";
      throw error;
    }
    const running = this.#datasetLoads.get(key);
    if (running) {
      this.#datasetCacheHits += 1;
      return running;
    }
    const load = (async () => {
      const startedAt = performance.now();
      const targetBars = existing ? incrementalTarget(document, existing, now) : 1_200;
      let incremental;
      try {
        incremental = await loadTossStrategyDataset(
          this.#tossClient,
          document.instrument,
          document.strategy.timeframe,
          { targetBars },
        );
      } catch (error) {
        const attempts = Math.min(5, (this.#datasetFailures.get(key)?.attempts ?? 0) + 1);
        const retryMilliseconds = Math.min(5 * 60_000, 30_000 * 2 ** (attempts - 1));
        this.#datasetFailures.set(key, { attempts, retryAt: now.getTime() + retryMilliseconds });
        logServerEvent("warn", "monitor.dataset_sync_deferred", {
          datasetKey: key,
          code: safeErrorCode(error),
          retryMilliseconds,
        });
        throw error;
      }
      const merged = existing
        ? {
            ...incremental,
            candles: mergeCandles(existing.candles, incremental.candles, 1_500),
          }
        : incremental;
      this.#datasets.set(key, merged);
      this.#lastFetchWindow.set(key, window);
      this.#datasetFailures.delete(key);
      this.#providerRequests += incremental.providerRequests;
      this.#lastProviderSyncAt = this.#now().toISOString();
      logServerEvent("info", "monitor.dataset_sync", {
        datasetKey: key,
        targetBars,
        mergedBars: merged.candles.length,
        providerRequests: incremental.providerRequests,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return merged;
    })();
    this.#datasetLoads.set(key, load);
    try {
      return await load;
    } finally {
      this.#datasetLoads.delete(key);
    }
  }

  async #evaluate(document: StoredStrategy): Promise<void> {
    const evaluationKey = `${document.id}:${document.revision}`;
    if (this.#evaluationInFlight.has(evaluationKey)) return;
    this.#evaluationInFlight.add(evaluationKey);
    try {
      const dataset = completedDataset(await this.#loadDataset(document), document, this.#now());
      const latest = dataset.candles.at(-1);
      if (!latest || this.#lastEvaluatedBar.get(evaluationKey) === latest.date) return;
      const signal = evaluateCompletedBarSignal(document, dataset);
      if (!signal) {
        this.#lastEvaluatedBar.set(evaluationKey, latest.date);
        return;
      }
      const age = this.#now().getTime() - Date.parse(signal.barTimestamp);
      const duration = timeframeDuration[document.strategy.timeframe];
      const maximumAge =
        document.strategy.timeframe === "1d" || document.strategy.timeframe === "1w"
          ? 8 * 24 * 60 * 60_000
          : duration * 3;
      if (!Number.isFinite(age) || age < 0 || age > maximumAge) {
        this.#lastEvaluatedBar.set(evaluationKey, latest.date);
        return;
      }
      const key = `${document.id}:${document.revision}:${signal.side}:${signal.barTimestamp}`;
      if (!(await this.#stateStore.shouldDeliver(key))) {
        this.#lastEvaluatedBar.set(evaluationKey, latest.date);
        return;
      }
      const settings = await this.#settingsStore.get();
      if (!settings.telegram) {
        logServerEvent("warn", "monitor.telegram_not_connected", { strategyId: document.id });
        await this.#stateStore.recordDelivery(key, "failed", "telegram_not_connected");
        this.#lastEvaluatedBar.set(evaluationKey, latest.date);
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
        this.#lastEvaluatedBar.set(evaluationKey, latest.date);
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
          this.#lastEvaluatedBar.set(evaluationKey, latest.date);
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
      this.#evaluationInFlight.delete(evaluationKey);
    }
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#connection?.stop();
    this.#connection = null;
    await this.#stateStore.heartbeat("stopped", 0, null, this.#telemetry());
    logServerEvent("info", "monitor.stopped");
  }
}
