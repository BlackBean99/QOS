import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { StrategyStore } from "@/src/server/strategy-store";
import {
  ChartSettingsSchema,
  NewStoredStrategySchema,
  StrategyExportSchema,
  type NewStoredStrategy,
} from "@/src/domain/stored-strategy";
import {
  INDICATOR_CATALOG,
  IndicatorInstanceSchema,
  configuredIndicatorCalculation,
  createIndicatorInstance,
  normalizeIndicatorInstances,
} from "@/src/domain/chart-indicators";

const directories: string[] = [];

async function createStore(): Promise<{ store: StrategyStore; filePath: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "qos-strategy-store-"));
  directories.push(directory);
  const filePath = path.join(directory, "nested", "strategies.json");
  return { store: new StrategyStore({ filePath }), filePath };
}

function validNewStrategy(): NewStoredStrategy {
  return NewStoredStrategySchema.parse({
    name: "애플 돌파 전략",
    description: "실제 TOSS 일봉을 사용하는 테스트 전략",
    instrument: {
      instrumentId: "NASDAQ:AAPL",
      market: "NASDAQ",
      symbol: "AAPL",
      displayName: "애플",
      currency: "USD",
      timezone: "America/New_York",
      synthetic: false,
      securityType: "STOCK",
      isinCode: "US0378331005",
    },
    strategy: {
      version: 1,
      name: "AAPL HIGH 20",
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
      mainIndicators: ["MA", "BOLL"],
      subIndicators: ["VOL", "RSI"],
      indicatorInstances: [
        {
          id: "vwap-daily-open",
          name: "VWAP",
          calcParams: [20],
          source: "open",
          timeframe: "1d",
          color: "#1769d2",
          lineWidth: 3,
        },
      ],
      drawings: [
        {
          id: "line-1",
          kind: "trend_line",
          points: [
            { timestamp: "2026-03-01T00:00:00.000Z", value: 180 },
            { timestamp: "2026-03-02T00:00:00.000Z", value: 185 },
          ],
        },
      ],
      visibleRange: null,
    },
    monitor: { enabled: false, interval: "1d" },
  });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("StrategyStore", () => {
  it("exposes every integrated indicator through a unique 105-item catalog", () => {
    expect(INDICATOR_CATALOG).toHaveLength(105);
    expect(new Set(INDICATOR_CATALOG.map((indicator) => indicator.name)).size).toBe(105);
    expect(INDICATOR_CATALOG.map((indicator) => indicator.name)).toEqual(
      expect.arrayContaining([
        "AVP",
        "AO",
        "KDJ",
        "SAR",
        "VWAP",
        "ICHIMOKU",
        "STOCH_RSI",
        "ATR",
        "DONCHIAN",
        "KELTNER",
        "MFI",
        "SUPER_TREND",
        "HMA",
        "VORTEX",
        "GMMA",
        "CONNORS_RSI",
        "WEEK_52_HIGH",
      ]),
    );
    for (const [index, item] of INDICATOR_CATALOG.entries()) {
      const instance = createIndicatorInstance(item.name, `catalog-${index}`, index);
      if (item.supportsDailyTimeframe) {
        expect(() => IndicatorInstanceSchema.parse({ ...instance, timeframe: "1d" })).not.toThrow();
      } else {
        expect(() => IndicatorInstanceSchema.parse({ ...instance, timeframe: "1d" })).toThrow(
          /과거 값이 바뀌므로/,
        );
      }
    }
  });

  it("rejects parameter arity, fractional periods and unsupported price sources", () => {
    const gmma = createIndicatorInstance("GMMA", "gmma");
    expect(() => IndicatorInstanceSchema.parse({ ...gmma, calcParams: [] })).toThrow(/12개/);

    const donchian = createIndicatorInstance("DONCHIAN", "donchian");
    expect(() => IndicatorInstanceSchema.parse({ ...donchian, calcParams: [0.1] })).toThrow(/정수/);

    const atr = createIndicatorInstance("ATR", "atr");
    expect(() => IndicatorInstanceSchema.parse({ ...atr, source: "open" })).toThrow(
      /변경할 수 없습니다/,
    );

    const rvi = createIndicatorInstance("RVI", "rvi");
    expect(() => IndicatorInstanceSchema.parse({ ...rvi, calcParams: [14, 0.1] })).toThrow(/정수/);

    const yearlyHigh = createIndicatorInstance("WEEK_52_HIGH", "yearly-high");
    expect(() =>
      IndicatorInstanceSchema.parse({ ...yearlyHigh, calcParams: [401], timeframe: "1d" }),
    ).toThrow(/400/);

    for (const name of ["TEMA", "KST", "PFE", "RMI"] as const) {
      const instance = createIndicatorInstance(name, `compound-${name.toLowerCase()}`);
      expect(() =>
        IndicatorInstanceSchema.parse({
          ...instance,
          calcParams: instance.calcParams.map(() => 400),
          timeframe: "1d",
        }),
      ).toThrow(/준비 구간/);
    }
  });

  it("accepts the interactive Upbit-parity indicator set", () => {
    const parsed = ChartSettingsSchema.parse({
      version: 1,
      period: "5m",
      theme: "upbit-light",
      mainIndicators: ["VWAP", "ICHIMOKU"],
      subIndicators: ["STOCH_RSI"],
      drawings: [],
      visibleRange: null,
    });

    expect(parsed.mainIndicators).toEqual(["VWAP", "ICHIMOKU"]);
    expect(parsed.subIndicators).toEqual(["STOCH_RSI"]);
  });

  it("stores duplicate indicator kinds as independently configurable instances", () => {
    const parsed = ChartSettingsSchema.parse({
      version: 1,
      period: "5m",
      theme: "upbit-light",
      mainIndicators: ["MA"],
      subIndicators: [],
      indicatorInstances: [
        {
          id: "ma-fast",
          name: "MA",
          calcParams: [5, 10],
          source: "open",
          timeframe: "chart",
          color: "#d43c3c",
          lineWidth: 2,
        },
        {
          id: "ma-daily",
          name: "MA",
          calcParams: [20],
          source: "close",
          timeframe: "1d",
          color: "#1769d2",
          lineWidth: 3,
        },
      ],
      drawings: [],
      visibleRange: null,
    });

    expect(parsed.indicatorInstances).toHaveLength(2);
    expect(parsed.indicatorInstances?.[1]).toMatchObject({ source: "close", timeframe: "1d" });
    expect(() =>
      ChartSettingsSchema.parse({
        ...parsed,
        indicatorInstances: [parsed.indicatorInstances?.[0], parsed.indicatorInstances?.[0]],
      }),
    ).toThrow(/id/);
  });

  it("normalizes legacy toggles and aligns a daily open-source indicator without look-ahead", async () => {
    const legacy = normalizeIndicatorInstances({
      mainIndicators: ["MA", "BOLL"],
      subIndicators: ["VOL"],
    });
    expect(legacy.map((indicator) => indicator.name)).toEqual(["MA", "BOLL", "VOL"]);
    expect(new Set(legacy.map((indicator) => indicator.id)).size).toBe(3);

    const day = 86_400_000;
    const data = [
      { timestamp: 0, open: 10, high: 13, low: 9, close: 12, volume: 1 },
      { timestamp: 60_000, open: 12, high: 15, low: 11, close: 14, volume: 2 },
      { timestamp: day, open: 20, high: 23, low: 19, close: 22, volume: 3 },
      { timestamp: day + 60_000, open: 22, high: 25, low: 21, close: 24, volume: 4 },
    ];
    const result = await configuredIndicatorCalculation(
      data,
      { source: "open", timeframe: "1d" },
      "UTC",
      (candles) => candles.map((candle) => ({ value: candle.close })),
    );

    expect(result).toEqual([{}, {}, { value: 10 }, { value: 10 }]);
  });

  it("uses preloaded completed daily history when an intraday page contains only one session", async () => {
    const intraday = [
      { timestamp: Date.UTC(2026, 7, 25, 0, 0), open: 30, high: 31, low: 29, close: 30, volume: 1 },
      { timestamp: Date.UTC(2026, 7, 25, 0, 1), open: 31, high: 32, low: 30, close: 31, volume: 1 },
    ];
    const dailyHistory = [
      { timestamp: Date.UTC(2026, 7, 21), open: 10, high: 14, low: 9, close: 13, volume: 10 },
      { timestamp: Date.UTC(2026, 7, 24), open: 20, high: 24, low: 19, close: 23, volume: 20 },
      { timestamp: Date.UTC(2026, 7, 25), open: 99, high: 100, low: 98, close: 99, volume: 1 },
    ];

    const result = await configuredIndicatorCalculation(
      intraday,
      { source: "open", timeframe: "1d" },
      "UTC",
      (candles) => candles.map((candle) => ({ value: candle.close })),
      "1m",
      true,
      dailyHistory,
    );

    expect(result).toEqual([{ value: 20 }, { value: 20 }]);
  });

  it("persists CRUD atomically with 0600 data permissions", async () => {
    const { store: first, filePath } = await createStore();
    const created = await first.create(validNewStrategy());
    const second = new StrategyStore({ filePath });

    await expect(second.get(created.id)).resolves.toMatchObject({
      id: created.id,
      revision: 1,
      name: "애플 돌파 전략",
      chart: {
        mainIndicators: ["MA", "BOLL"],
        indicatorInstances: [
          {
            id: "vwap-daily-open",
            name: "VWAP",
            calcParams: [20],
            source: "open",
            timeframe: "1d",
            color: "#1769d2",
            lineWidth: 3,
          },
        ],
      },
    });
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const updated = await second.update(created.id, {
      expectedRevision: 1,
      name: "애플 돌파 전략 v2",
      description: created.description,
      instrument: created.instrument,
      strategy: created.strategy,
      chart: created.chart,
      monitor: { enabled: true, interval: "1d" },
    });
    expect(updated).toMatchObject({ revision: 2, name: "애플 돌파 전략 v2" });

    await expect(second.delete(created.id, 2)).resolves.toBe(true);
    await expect(second.get(created.id)).resolves.toBeNull();
  });

  it("rejects a write before it can make the local store unreadable", async () => {
    const firstDirectory = await mkdtemp(path.join(tmpdir(), "qos-strategy-size-source-"));
    directories.push(firstDirectory);
    const firstPath = path.join(firstDirectory, "strategies.json");
    const fixed = {
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: () => "11111111-1111-4111-8111-111111111111",
    };
    await new StrategyStore({ filePath: firstPath, ...fixed }).create(validNewStrategy());
    const exactBytes = (await stat(firstPath)).size;

    const exactDirectory = await mkdtemp(path.join(tmpdir(), "qos-strategy-size-exact-"));
    directories.push(exactDirectory);
    const exactPath = path.join(exactDirectory, "strategies.json");
    const exact = new StrategyStore({ filePath: exactPath, maximumBytes: exactBytes, ...fixed });
    await expect(exact.create(validNewStrategy())).resolves.toMatchObject({ revision: 1 });
    await expect(exact.list()).resolves.toHaveLength(1);

    const rejectedDirectory = await mkdtemp(path.join(tmpdir(), "qos-strategy-size-reject-"));
    directories.push(rejectedDirectory);
    const rejectedPath = path.join(rejectedDirectory, "strategies.json");
    const rejected = new StrategyStore({
      filePath: rejectedPath,
      maximumBytes: exactBytes - 1,
      ...fixed,
    });
    await expect(rejected.create(validNewStrategy())).rejects.toMatchObject({
      code: "store_too_large",
    });
    await expect(rejected.list()).resolves.toEqual([]);
  });

  it("rejects stale writes without changing the document", async () => {
    const { store } = await createStore();
    const created = await store.create(validNewStrategy());

    await expect(
      store.update(created.id, {
        expectedRevision: 99,
        name: created.name,
        description: created.description,
        instrument: created.instrument,
        strategy: created.strategy,
        chart: created.chart,
        monitor: created.monitor,
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(store.get(created.id)).resolves.toMatchObject({ revision: 1 });
  });

  it("imports only after full validation and exports no secrets", async () => {
    const { store, filePath } = await createStore();
    const created = await store.create(validNewStrategy());
    const exported = await store.exportAll();

    expect(StrategyExportSchema.safeParse(exported).success).toBe(true);
    expect(JSON.stringify(exported)).not.toMatch(/client_secret|bot_token|chat_id/i);

    await expect(
      store.import(
        {
          ...exported,
          strategies: [exported.strategies[0], { ...exported.strategies[0], id: "not-a-uuid" }],
        },
        "replace",
      ),
    ).rejects.toMatchObject({ code: "invalid_document" });
    expect(JSON.parse(await readFile(filePath, "utf8")).strategies).toHaveLength(1);

    const imported = await store.import(exported, "clone");
    expect(imported.imported).toBe(1);
    expect(imported.ids[0]).not.toBe(created.id);
    await expect(store.list()).resolves.toHaveLength(2);
  });

  it("leaves a corrupt JSON file untouched and reports recovery", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { store, filePath } = await createStore();
    await store.create(validNewStrategy());
    await writeFile(filePath, "{broken", { encoding: "utf8", mode: 0o600 });

    await expect(store.list()).rejects.toMatchObject({ code: "corrupt_store" });
    await expect(readFile(filePath, "utf8")).resolves.toBe("{broken");
  });
});
