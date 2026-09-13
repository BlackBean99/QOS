import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createPresetStrategyV3 } from "../src/domain/strategy-v3/catalog";

const instrument = {
  instrumentId: "NASDAQ:NVDA",
  market: "NASDAQ",
  symbol: "NVDA",
  displayName: "엔비디아",
  currency: "USD",
  timezone: "America/New_York",
  synthetic: false,
  aliases: [],
  securityType: "STOCK",
  isinCode: "US67066G1040",
} as const;

const trackingEtf = {
  instrumentId: "NYSE:SPY",
  market: "NYSE",
  symbol: "SPY",
  displayName: "SPDR S&P 500 ETF",
  currency: "USD",
  timezone: "America/New_York",
  synthetic: false,
  aliases: [],
  securityType: "FOREIGN_ETF",
  isinCode: "US78462F1030",
} as const;

const inverseEtf = {
  instrumentId: "AMEX:SH",
  market: "AMEX",
  symbol: "SH",
  displayName: "ProShares Short S&P500",
  currency: "USD",
  timezone: "America/New_York",
  synthetic: false,
  aliases: [],
  securityType: "FOREIGN_ETF",
} as const;

function candles(interval: string) {
  const count = interval === "1d" ? 100 : 180;
  const span = interval === "1d" ? 86_400_000 : 60_000;
  const start = Date.now() - count * span;
  return Array.from({ length: count }, (_, index) => {
    const base = 170 + index * 0.25 + Math.sin(index / 4) * 3;
    return {
      timestamp: new Date(start + index * span).toISOString(),
      open: base,
      high: base + 2.4,
      low: base - 1.8,
      close: base + (index % 2 === 0 ? 1.2 : -0.7),
      volume: 1_000_000 + index * 1_000,
      currency: "USD",
    };
  });
}

function backtestResult(strategy: Record<string, unknown>) {
  const series = candles("1d");
  const entry = series[35];
  const exit = series[70];
  return {
    strategy,
    market: {
      ...instrument,
      timeZone: instrument.timezone,
      calendar: "TOSS returned sessions",
      source: "TOSS OpenAPI adjusted candles",
      version: "OpenAPI 1.2.14",
      adjustedPrices: true,
    },
    period: { start: series[0].timestamp, end: series.at(-1)?.timestamp, sessions: series.length },
    costs: { commissionBps: 1.5, slippageBps: 5, sellTaxBps: 0 },
    execution: { signalAt: "Session close", fillAt: "Next session open", priceAdjustment: "Costs" },
    metrics: {
      initialCapital: 100_000,
      endingEquity: 108_000,
      totalReturnPercent: 8,
      maxDrawdownPercent: -3.2,
      sharpeRatio: 1.2,
      winRatePercent: 100,
      closedTrades: 1,
      benchmarkReturnPercent: 4,
    },
    equityCurve: series.map((item, index) => ({
      date: item.timestamp,
      equity: 100_000 + index * 80,
      drawdownPercent: index % 12 === 0 ? -2 : -0.2,
    })),
    priceSeries: series.map(({ timestamp, ...item }) => ({ date: timestamp, ...item })),
    trades: [
      {
        symbol: "NVDA",
        side: "LONG",
        status: "CLOSED",
        signalDate: entry.timestamp,
        entryDate: entry.timestamp,
        entryPrice: entry.close,
        entryFee: 1,
        quantity: 10,
        exitSignalDate: exit.timestamp,
        exitDate: exit.timestamp,
        exitPrice: exit.close,
        exitFee: 1,
        pnl: 800,
        returnPercent: 8,
        reasons: ["Close broke above the prior 20-session high", "Volume reached 2× average"],
        exitReason: {
          signalDate: exit.timestamp,
          fillDate: exit.timestamp,
          peakPrice: exit.high,
          stopPrice: exit.low,
          signalClose: exit.close,
          fillPrice: exit.close,
        },
      },
    ],
    warnings: ["TOSS historical market data backtest; not investment advice."],
  };
}

function strategyV3BacktestResult(strategy: Record<string, unknown>) {
  const series = candles("5m");
  const entry = series[80];
  const exit = series[110];
  const trace = {
    type: "GROUP",
    id: "entry",
    operator: "AND",
    passed: true,
    status: "PASS",
    children: [
      {
        type: "CONDITION",
        id: "obv-breakout",
        label: "OBV breakout",
        operator: "BREAK_ABOVE",
        passed: true,
        status: "PASS",
        current: { left: 1_250_000, right: 1_200_000 },
        previous: { left: 1_180_000, right: 1_190_000 },
      },
    ],
  };
  return {
    engineVersion: "qos-strategy-engine-v3",
    strategy,
    period: { start: series[0].timestamp, end: series.at(-1)?.timestamp, bars: series.length },
    dataPolicy: {
      source: "TOSS OpenAPI adjusted candles",
      adjustedPrices: true,
      marketTimeZone: instrument.timezone,
      sessionOpen: "09:30",
      sessionClose: "16:00",
    },
    metrics: {
      startingCapital: 100_000,
      endingEquity: 103_200,
      totalReturnPercent: 3.2,
      cagrPercent: 11.4,
      maximumDrawdownPercent: -2.1,
      sharpeRatio: 1.28,
      sortinoRatio: 1.7,
      calmarRatio: 5.4,
      winRatePercent: 100,
      lossRatePercent: 0,
      profitFactor: 2.4,
      expectancy: 320,
      averageWin: 320,
      averageLoss: 0,
      payoffRatio: null,
      averageRMultiple: 2,
      numberOfTrades: 1,
      averageHoldingBars: 30,
      maximumConsecutiveWins: 1,
      maximumConsecutiveLosses: 0,
      exposurePercent: 16.7,
      turnover: 2,
      commissionCost: 12,
      slippageCost: 18,
    },
    trades: [
      {
        side: "LONG",
        entrySignalAt: series[79].timestamp,
        entryAt: entry.timestamp,
        entryPrice: entry.close,
        entryTrace: trace,
        initialQuantity: 10,
        remainingQuantity: 0,
        initialStop: entry.close - 2,
        stopPath: [
          { at: entry.timestamp, value: entry.close - 2, reason: "ATR_STOP" },
          { at: series[95].timestamp, value: entry.close, reason: "BREAK_EVEN" },
        ],
        fills: [
          {
            at: exit.timestamp,
            rawPrice: exit.close,
            fillPrice: exit.close - 0.05,
            quantity: 10,
            quantityPercent: 100,
            reason: "RISK_REWARD",
            priority: 30,
            fee: 12,
            slippageCost: 18,
            grossPnl: 350,
            netPnl: 320,
          },
        ],
        exitAt: exit.timestamp,
        exitPrice: exit.close - 0.05,
        exitReason: "RISK_REWARD",
        grossPnl: 350,
        fee: 12,
        slippageCost: 18,
        netPnl: 320,
        returnPercent: 3.2,
        rMultiple: 2,
        holdingBars: 30,
        holdingMilliseconds: 30 * 300_000,
        mfePercent: 4.1,
        maePercent: -1.1,
      },
    ],
    equityCurve: series.map((item, index) => ({
      at: item.timestamp,
      equity: 100_000 + index * 18,
      drawdownPercent: index % 20 === 0 ? -1 : 0,
    })),
    assumptions: ["Bar T close signal → Bar T+1 open fill", "Conservative intrabar policy"],
    limitations: ["Historical constituent and delisted-universe coverage is not guaranteed."],
  };
}

function historySummary(run: Record<string, unknown>) {
  const summary = { ...run };
  delete summary.strategySnapshot;
  delete summary.instrumentSnapshot;
  delete summary.result;
  return summary;
}

function storedStrategyFixture(
  id = "11111111-1111-4111-8111-111111111111",
  name = "NVDA 복구 전략",
) {
  const timestamp = new Date().toISOString();
  return {
    id,
    revision: 1,
    name,
    description: "provider 검색 없이 불러오기",
    instrument: {
      instrumentId: instrument.instrumentId,
      market: instrument.market,
      symbol: instrument.symbol,
      displayName: instrument.displayName,
      currency: instrument.currency,
      timezone: instrument.timezone,
      synthetic: instrument.synthetic,
      securityType: instrument.securityType,
      isinCode: instrument.isinCode,
    },
    strategy: {
      version: 1,
      name: "NVDA HIGH 20",
      market: "NASDAQ",
      instrumentId: instrument.instrumentId,
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
      mainIndicators: ["VWAP"],
      subIndicators: ["VOL"],
      drawings: [],
      visibleRange: null,
    },
    monitor: { enabled: false, interval: "1d" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function installMocks(page: Page) {
  let documents: Array<Record<string, unknown>> = [];
  let historyRuns: Array<Record<string, unknown>> = [];

  await page.route("**/api/instruments?**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query")?.toLocaleLowerCase("ko-KR") ?? "";
    await route.fulfill({
      json: {
        instruments: query.includes("없")
          ? []
          : query === "sh" || query.includes("inverse")
            ? [inverseEtf]
            : query.includes("spy") || query.includes("etf")
              ? [trackingEtf]
              : [instrument],
        source: "TOSS OpenAPI",
        cache: {
          status: url.searchParams.get("refresh") === "true" ? "REFRESHED" : "HIT",
          origin: url.searchParams.get("refresh") === "true" ? "PROVIDER" : "DISK",
          fetchedAt: "2026-09-01T00:00:00.000Z",
          expiresAt: "2026-09-02T00:00:00.000Z",
          markets: url.searchParams.get("region") === "KR" ? 3 : 4,
        },
        requestId: "e2e",
      },
    });
  });
  await page.route("**/api/market/candles?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: {
        instrumentId: instrument.instrumentId,
        market: instrument.market,
        symbol: instrument.symbol,
        interval: url.searchParams.get("interval"),
        adjusted: true,
        source: "TOSS OpenAPI",
        candles: candles(url.searchParams.get("interval") ?? "1d"),
        nextBefore: null,
      },
    });
  });
  await page.route("**/api/market/stream?**", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/telegram/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        botUsername: "qos_bot",
        displayName: "QOS User",
        connectedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/monitor/status", (route) =>
    route.fulfill({
      json: {
        status: "connected",
        heartbeatAt: new Date().toISOString(),
        enabledStrategies: 1,
        deliveredSignals: 2,
        failedSignals: 0,
        lastErrorCode: null,
        strategySource: "PRIMARY",
        strategySnapshotAt: new Date().toISOString(),
        positions: [],
      },
    }),
  );
  await page.route("**/api/backtests", async (route) => {
    const request = route.request().postDataJSON() as { strategy: Record<string, unknown> };
    await route.fulfill({ json: backtestResult(request.strategy) });
  });
  await page.route("**/api/strategy-engine/backtests", async (route) => {
    const request = route.request().postDataJSON() as {
      strategies: Array<Record<string, unknown>>;
    };
    const runs = request.strategies.map((strategy) => ({
      name: String(strategy.name),
      result: strategyV3BacktestResult(strategy),
    }));
    await route.fulfill({
      json:
        runs.length === 1
          ? { kind: "single", result: runs[0].result }
          : { kind: "comparison", comparison: { runs } },
    });
  });
  await page.route("**/api/strategy-recommendations", async (route) => {
    const request = route.request().postDataJSON() as {
      timeframe?: "1m" | "5m" | "15m" | "30m" | "60m" | "4h" | "1d" | "1w";
      window?: { startDate: string; endDate: string };
    };
    const timeframe = request.timeframe ?? "1d";
    const strategy = createPresetStrategyV3("rolling-vwap-breakout", instrument.instrumentId, {
      timeframe,
    });
    const metrics = {
      totalReturnPercent: 18.42,
      maximumDrawdownPercent: 6.1,
      sharpeRatio: 1.64,
      numberOfTrades: 14,
    };
    const recommendation = {
      rank: 1,
      presetId: "rolling-vwap-breakout",
      presetName: "Rolling VWAP Breakout",
      category: "VWAP",
      strategy,
      metrics,
    };
    await route.fulfill({
      json: {
        methodology: {
          catalogVersion: "strategy-v3-entry-43",
          candidatesEvaluated: 43,
          ranking: "TOTAL_RETURN_DESC",
          baselineExit: "ATR 2x stop + 2R target",
          execution: "bar close signal → next bar open",
        },
        window: {
          source: request.window ? "CUSTOM" : "DEFAULT",
          startDate: request.window?.startDate ?? "2024-09-01",
          endDate: request.window?.endDate ?? "2026-09-01",
          label: request.window
            ? `${request.window.startDate} — ${request.window.endDate} · 직접 설정`
            : "2024-09-01 — 2026-09-01 · 자동 설정",
        },
        dataPeriod: {
          start: "2026-07-01T13:30:00.000Z",
          end: "2026-08-31T20:00:00.000Z",
          bars: 420,
        },
        recommendation,
        rankings: [
          recommendation,
          {
            ...recommendation,
            rank: 2,
            presetId: "ema-crossover",
            presetName: "EMA / SMA Crossover",
            category: "TREND",
            metrics: { ...metrics, totalReturnPercent: 12.2 },
          },
        ],
        warnings: ["선택한 과거 구간의 in-sample 결과이며 미래 수익을 보장하지 않습니다."],
        cache: "MISS",
        requestId: "recommendation-e2e",
      },
    });
  });
  await page.route("**/api/strategies/export", (route) =>
    route.fulfill({
      json: { version: 1, exportedAt: new Date().toISOString(), strategies: documents },
    }),
  );
  await page.route("**/api/strategies/import", (route) =>
    route.fulfill({ json: { imported: 1, ids: [] } }),
  );
  await page.route(/\/api\/strategies\/[^/]+(?:\/backtests)?(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const backtests = url.pathname.match(/^\/api\/strategies\/([^/]+)\/backtests$/);
    if (backtests) {
      const strategyId = backtests[1];
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            runs: historyRuns.filter((run) => run.strategyId === strategyId).map(historySummary),
          },
        });
        return;
      }
      const document = documents.find((candidate) => candidate.id === strategyId);
      if (route.request().method() === "POST" && document) {
        const strategy = document.strategy as Record<string, unknown>;
        const isV3 = strategy.version === 3;
        const v3Result = isV3 ? strategyV3BacktestResult(strategy) : null;
        const v1Result = isV3 ? null : backtestResult(strategy);
        const result = v3Result ?? v1Result!;
        const run = {
          id: "22222222-2222-4222-8222-222222222222",
          strategyId,
          strategyName: document.name,
          strategyRevision: document.revision,
          strategyVersion: strategy.version,
          instrumentId: instrument.instrumentId,
          market: instrument.market,
          timeframe: strategy.timeframe,
          engineVersion: isV3 ? "qos-strategy-engine-v3" : "qos-backtest-v1",
          strategySnapshot: strategy,
          instrumentSnapshot: document.instrument,
          summary: isV3
            ? {
                kind: "strategy_v3",
                totalReturnPercent: v3Result!.metrics.totalReturnPercent,
                maxDrawdownPercent: v3Result!.metrics.maximumDrawdownPercent,
                sharpeRatio: v3Result!.metrics.sharpeRatio,
                trades: v3Result!.metrics.numberOfTrades,
                periodStart: v3Result!.period.start,
                periodEnd: v3Result!.period.end,
              }
            : {
                kind: "strategy_v1",
                totalReturnPercent: v1Result!.metrics.totalReturnPercent,
                maxDrawdownPercent: v1Result!.metrics.maxDrawdownPercent,
                sharpeRatio: v1Result!.metrics.sharpeRatio,
                trades: v1Result!.metrics.closedTrades,
                periodStart: v1Result!.period.start,
                periodEnd: v1Result!.period.end,
              },
          result,
          createdAt: new Date().toISOString(),
        };
        historyRuns = [run, ...historyRuns];
        const summary = historySummary(run);
        await route.fulfill({ status: 201, json: { run: summary, result } });
        return;
      }
    }
    const id = url.pathname.split("/").at(-1);
    const existing = documents.find((document) => document.id === id);
    if (route.request().method() === "PATCH" && existing) {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      const updated = {
        ...existing,
        ...input,
        revision: Number(existing.revision) + 1,
        updatedAt: new Date().toISOString(),
      };
      documents = documents.map((document) => (document.id === id ? updated : document));
      await route.fulfill({ json: { strategy: updated } });
      return;
    }
    if (route.request().method() === "DELETE") {
      historyRuns = historyRuns.map((run) =>
        run.strategyId === id ? { ...run, strategyId: null } : run,
      );
      documents = documents.filter((document) => document.id !== id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: "not found" } } });
  });
  await page.route("**/api/backtest-runs/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const run = historyRuns.find((candidate) => candidate.id === id);
    if (route.request().method() === "GET" && run) {
      await route.fulfill({ json: { run } });
      return;
    }
    if (route.request().method() === "DELETE" && run) {
      historyRuns = historyRuns.filter((candidate) => candidate.id !== id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: "not found" } } });
  });
  await page.route("**/api/backtest-runs?**", async (route) => {
    await route.fulfill({
      json: {
        runs: historyRuns.map(historySummary),
      },
    });
  });
  await page.route("**/api/strategies", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { strategies: documents } });
      return;
    }
    const input = route.request().postDataJSON() as Record<string, unknown>;
    const timestamp = new Date().toISOString();
    const created = {
      ...input,
      id: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    documents = [created];
    await route.fulfill({ status: 201, json: { strategy: created } });
  });
}

async function selectInstrument(page: Page) {
  await page.getByRole("radio", { name: "미국" }).check();
  await page.getByRole("searchbox", { name: "종목명 또는 티커" }).fill("NVDA");
  await page.getByRole("button", { name: "종목 조회" }).click();
  await page.getByRole("button", { name: /엔비디아.*NVDA.*NASDAQ.*USD/ }).click();
  await expect(page.getByRole("heading", { name: /엔비디아/ })).toBeVisible();
}

async function startV3Preset(page: Page, searchTerm: string, cardText: string) {
  const builder = page.locator("#strategy-builder");
  await builder.getByRole("searchbox", { name: "전략 검색" }).fill(searchTerm);
  await builder
    .locator(".engine-preset")
    .filter({ hasText: cardText })
    .getByRole("button", { name: "이 전략으로 시작" })
    .click();
}

test.beforeEach(async ({ page }) => {
  await installMocks(page);
});

test("recovers a persisted strategy before any provider instrument search", async ({ page }) => {
  const stored = storedStrategyFixture();
  await page.route("**/api/strategies", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { strategies: [stored] } });
      return;
    }
    await route.fallback();
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "전략 라이브러리" })).toBeVisible();
  await expect(page.getByLabel("저장 이름")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "거장들의 공개 전략 원칙으로 시작하기" }),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: /캔들차트/ })).toHaveCount(0);
  await page.getByRole("button", { name: /NVDA 복구 전략.*엔비디아.*1d/ }).click();
  await page.getByRole("button", { name: "차트/설정 불러오기" }).click();
  await expect(page.getByRole("heading", { name: /엔비디아/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /캔들차트/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("keeps a committed strategy when the post-save refresh fails after a slow initial list", async ({
  page,
}) => {
  let initialListReleased = false;
  let releaseInitialList: () => void = () => undefined;
  const initialListGate = new Promise<void>((resolve) => {
    releaseInitialList = resolve;
  });
  await page.unroute("**/api/strategies");
  await page.route("**/api/strategies", async (route) => {
    if (route.request().method() === "GET") {
      if (!initialListReleased) {
        await initialListGate;
        await route.fulfill({ json: { strategies: [] } });
      } else {
        await route.fulfill({ status: 503, json: { error: { message: "refresh unavailable" } } });
      }
      return;
    }
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        json: { strategy: { ...storedStrategyFixture(), ...input } },
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "JSON 가져오기" })).toBeDisabled();
  initialListReleased = true;
  releaseInitialList();
  await expect(page.getByRole("button", { name: "JSON 가져오기" })).toBeEnabled();
  await selectInstrument(page);

  await expect(page.locator(".engine-sticky-bar")).toContainText("NASDAQ");
  await expect(page.locator(".engine-sticky-bar")).not.toContainText("SYNTHETIC");
  await startV3Preset(page, "EMA / SMA Crossover", "EMA / SMA Crossover");
  await page.getByLabel("저장 이름").fill("refresh 실패 보존");
  await page.getByRole("button", { name: "새 전략 저장" }).click();

  await expect(page.getByRole("status").filter({ hasText: "원격 목록 재확인에 실패" })).toBeVisible(
    { timeout: 10_000 },
  );
  await expect(page.getByRole("button", { name: /refresh 실패 보존.*엔비디아.*5m/ })).toBeVisible();
});

test("converts a natural-language library description into strategy JSON before saving", async ({
  page,
}) => {
  await page.route("**/api/strategies/parse", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        strategy: {
          version: 1,
          name: "NVDA Breakout 20",
          market: "NASDAQ",
          instrumentId: instrument.instrumentId,
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
        warnings: [],
      },
    });
  });
  await page.goto("/");
  await selectInstrument(page);
  const prompt =
    "NASDAQ에서 20일 고점을 돌파하고 거래량이 20일 평균의 2배 이상이면 매수, 고점 대비 5% 하락하면 매도.";
  await page.getByLabel("저장 이름").fill("자연어 JSON 전략");
  await page.getByLabel("설명 또는 자연어 전략 조건").fill(prompt);
  await expect(page.getByRole("button", { name: "새 전략 저장" })).toBeEnabled();
  await page.getByRole("button", { name: "새 전략 저장" }).click();
  await expect(page.getByRole("button", { name: /자연어 JSON 전략/ })).toBeVisible();
});

test("discards a slow history detail after switching saved strategies", async ({ page }) => {
  const first = storedStrategyFixture("11111111-1111-4111-8111-111111111111", "전략 A");
  const second = storedStrategyFixture("22222222-2222-4222-8222-222222222222", "전략 B");
  const run = (document: ReturnType<typeof storedStrategyFixture>, id: string, value: number) => ({
    id,
    strategyId: document.id,
    strategyName: document.name,
    strategyRevision: document.revision,
    strategyVersion: 1,
    instrumentId: instrument.instrumentId,
    market: instrument.market,
    timeframe: "1d",
    engineVersion: "qos-backtest-v1",
    strategySnapshot: document.strategy,
    instrumentSnapshot: document.instrument,
    summary: {
      kind: "strategy_v1",
      totalReturnPercent: value,
      maxDrawdownPercent: -1,
      sharpeRatio: 1,
      trades: 1,
      periodStart: "2026-01-01",
      periodEnd: "2026-08-01",
    },
    result: { owner: document.name },
    createdAt: new Date().toISOString(),
  });
  const firstRun = run(first, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1);
  const secondRun = run(second, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2);
  await page.route("**/api/strategies", (route) =>
    route.fulfill({ json: { strategies: [first, second] } }),
  );
  await page.route(/\/api\/strategies\/[^/]+\/backtests/, async (route) => {
    const strategyId = new URL(route.request().url()).pathname.split("/")[3];
    const candidate = strategyId === first.id ? firstRun : secondRun;
    await route.fulfill({ json: { runs: [historySummary(candidate)] } });
  });
  await page.route("**/api/backtest-runs/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    if (id === firstRun.id) await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ json: { run: id === firstRun.id ? firstRun : secondRun } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /전략 A.*엔비디아.*1d/ }).click();
  await page
    .locator(".strategy-history")
    .getByRole("button", { name: /\+1\.00%/ })
    .click();
  await page.getByRole("button", { name: /전략 B.*엔비디아.*1d/ }).click();
  await expect(
    page.locator(".strategy-history").getByRole("button", { name: /\+2\.00%/ }),
  ).toBeVisible();
  await page.waitForTimeout(700);
  await expect(
    page.locator(".strategy-history pre").filter({ hasText: '"owner": "전략 A"' }),
  ).toHaveCount(0);
});

async function addIndicator(page: Page, name: string) {
  await page.getByRole("button", { name: "지표 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "지표 추가" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: `${name} 추가`, exact: true }).click();
}

test("adds, configures, duplicates and removes indicator instances", async ({ page }) => {
  await page.goto("/");
  await selectInstrument(page);
  await page.getByRole("button", { name: "1분" }).click();
  await expect(page.getByRole("img", { name: /엔비디아 1m 캔들차트/ })).toBeVisible();

  await page.getByRole("button", { name: "지표 추가" }).click();
  const catalog = page.getByRole("dialog", { name: "지표 추가" });
  await expect(catalog.locator("[data-indicator-catalog-item]")).toHaveCount(105);
  expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
  await catalog.getByRole("button", { name: "VWAP 추가", exact: true }).click();

  const vwapRows = page.locator("[data-indicator-instance]").filter({ hasText: "VWAP" });
  await expect(vwapRows).toHaveCount(1);
  await vwapRows
    .first()
    .getByRole("button", { name: /VWAP 설정/ })
    .click();
  const settingsDialog = page.getByRole("dialog", { name: "VWAP 지표 설정" });
  expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
  await settingsDialog.getByLabel("세션 기간").fill("0.1");
  await settingsDialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(settingsDialog.getByRole("alert")).toContainText("정수");
  await settingsDialog.getByLabel("세션 기간").fill("20");
  await settingsDialog.getByLabel("가격 소스").selectOption("open");
  await settingsDialog.getByLabel("계산 봉").selectOption("1d");
  await settingsDialog.getByLabel("대표 색").fill("#123456");
  await settingsDialog.getByLabel("선 굵기").selectOption("3");
  await settingsDialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(vwapRows.first()).toContainText("20 · 시가 · 1D");
  const chart = page.getByRole("img", { name: /엔비디아 1m 캔들차트/ });
  await expect(chart).toHaveAttribute("data-daily-indicator-bars", "100");
  await expect(chart).toHaveAttribute("data-indicator-styles", /#123456:3/);

  await addIndicator(page, "VWAP");
  await expect(vwapRows).toHaveCount(2);
  await vwapRows
    .first()
    .getByRole("button", { name: /VWAP 삭제/ })
    .click();
  await expect(vwapRows).toHaveCount(1);
  await expect(vwapRows.first().getByRole("button", { name: /VWAP 설정/ })).toBeFocused();

  await addIndicator(page, "FRACTAL");
  const fractalRow = page.locator("[data-indicator-instance]").filter({ hasText: "FRACTAL" });
  await fractalRow.getByRole("button", { name: /FRACTAL 설정/ }).click();
  const fractalDialog = page.getByRole("dialog", { name: "FRACTAL 지표 설정" });
  await fractalDialog.getByLabel("대표 색").fill("#654321");
  await fractalDialog.getByLabel("선 굵기").selectOption("4");
  await fractalDialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(chart).toHaveAttribute("data-indicator-styles", /#654321:4/);

  await expect(chart).toHaveAttribute("data-indicator-instances", /VWAP/);
  await expect
    .poll(async () => (await chart.getAttribute("data-indicators"))?.match(/VWAP:/g)?.length ?? 0)
    .toBe(1);
});

test("creates every indicator exposed by the catalog", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "desktop-1440", "full indicator matrix runs once on desktop");
  await page.goto("/");
  await selectInstrument(page);
  const names = [
    "AVP",
    "AO",
    "BIAS",
    "BOLL",
    "BRAR",
    "BBI",
    "CCI",
    "CR",
    "DMA",
    "DMI",
    "EMV",
    "EMA",
    "MTM",
    "MA",
    "MACD",
    "OBV",
    "PVT",
    "PSY",
    "ROC",
    "RSI",
    "SMA",
    "KDJ",
    "SAR",
    "TRIX",
    "VOL",
    "VR",
    "WR",
    "FRACTAL",
    "VWAP",
    "ICHIMOKU",
    "STOCH_RSI",
    "ATR",
    "ADX",
    "AROON",
    "DONCHIAN",
    "KELTNER",
    "MFI",
    "SUPER_TREND",
    "HMA",
    "DEMA",
    "TEMA",
    "WMA",
    "VWMA",
    "CMF",
    "CHAIKIN_OSC",
    "KST",
    "ULTIMATE_OSC",
    "STDDEV",
    "ENVELOPE",
    "RVI",
    "SMI",
    "TSI",
    "MOMENTUM",
    "DPO",
    "FORCE_INDEX",
    "HIST_VOL",
    "BOLL_PERCENT_B",
    "BOLL_WIDTH",
    "ACC_DIST",
    "AROON_OSC",
    "APO",
    "AVG_PRICE",
    "BOP",
    "CMO",
    "CHAIKIN_VOL",
    "FISHER",
    "KAMA",
    "KVO",
    "LINREG",
    "LINREG_SLOPE",
    "MASS_INDEX",
    "MEDIAN_PRICE",
    "NATR",
    "NVI",
    "PPO",
    "PVI",
    "QSTICK",
    "STOCHASTIC",
    "TRUE_RANGE",
    "TRIMA",
    "TYPICAL_PRICE",
    "VHF",
    "VIDYA",
    "VOLUME_OSC",
    "WAD",
    "WEIGHTED_CLOSE",
    "WILDERS",
    "ZLEMA",
    "ALMA",
    "CHANDELIER_EXIT",
    "PFE",
    "RMI",
    "GMMA",
    "MCGINLEY",
    "VORTEX",
    "NET_VOLUME",
    "WEEK_52_HIGH",
    "PIVOT_POINTS",
    "ZIGZAG",
    "PRICE_CHANNEL",
    "ACCELERATOR_OSC",
    "RANK_CORRELATION",
    "STANDARD_ERROR",
    "STANDARD_ERROR_BANDS",
    "CONNORS_RSI",
  ];
  for (const name of names) await addIndicator(page, name);

  const chart = page.getByRole("img", { name: /엔비디아 1d 캔들차트/ });
  await expect
    .poll(async () => {
      const actual = new Set(
        ((await chart.getAttribute("data-indicators")) ?? "")
          .split(",")
          .map((indicator) => indicator.split(":")[0]),
      );
      return names.filter((name) => actual.has(name)).length;
    })
    .toBe(names.length);
});

test("searches a TOSS stock and opens the Upbit-family interactive chart", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "실제 종목 검색" })).toBeVisible();
  await expect(page.getByText("TOSS OpenAPI의 거래 가능", { exact: false })).toBeVisible();
  await selectInstrument(page);

  const chart = page.getByRole("img", { name: /엔비디아 1d 캔들차트/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator("canvas").first()).toBeVisible();
  await expect(page.getByText("상승 적색", { exact: false })).toBeVisible();
  await expect(page.getByText("하락 청색", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "지표 추가" }).click();
  const indicatorDialog = page.getByRole("dialog", { name: "지표 추가" });
  for (const tool of ["MA", "SMA", "EMA", "BOLL", "FRACTAL", "VOL", "RSI", "MACD"]) {
    await expect(
      indicatorDialog.getByRole("button", { name: `${tool} 추가`, exact: true }),
    ).toBeVisible();
  }
  await indicatorDialog.getByRole("button", { name: "지표 추가 닫기" }).click();
  for (const drawing of ["추세선", "빗금/브러시", "박스", "피보나치", "피치포크", "팬"]) {
    const button = page.getByRole("button", { name: drawing, exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator("[data-drawing-icon]")).toBeVisible();
  }
  await addIndicator(page, "MACD");
  await addIndicator(page, "FRACTAL");
  await expect(page.locator("[data-indicator-instance]").filter({ hasText: "MACD" })).toHaveCount(
    1,
  );
  await expect(
    page.locator("[data-indicator-instance]").filter({ hasText: "FRACTAL" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "5분" }).click();
  await expect(page.getByRole("img", { name: /엔비디아 5m 캔들차트/ })).toBeVisible();
  await page.getByRole("button", { name: "확대 +" }).click();
  await page.getByRole("button", { name: "축소 −" }).click();
  await page.getByRole("button", { name: "화면 맞춤" }).click();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right > window.innerWidth + 1 || bounds.left < -1;
      })
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .slice(0, 10),
  );
  expect(overflowing).toEqual([]);
});

test("builds a multi-family Strategy v3 rule chain and explains its paper result", async ({
  page,
}) => {
  await page.goto("/");
  await selectInstrument(page);

  const builder = page.locator("#strategy-builder");
  await expect(builder.getByRole("heading", { name: /아이디어를 규칙으로/ })).toBeVisible();
  await expect(builder.getByText("43 Entry · 8 Filter · 21 Exit")).toBeVisible();

  const search = builder.getByRole("searchbox", { name: "전략 검색" });
  await search.fill("OBV");
  const obv = builder.locator(".engine-preset").filter({ hasText: "OBV Trend / Breakout" });
  await obv.getByRole("button", { name: "이 전략으로 시작" }).click();

  await search.fill("VWAP Standard");
  const vwapBand = builder.locator(".engine-preset").filter({ hasText: "VWAP Standard Deviation" });
  await vwapBand.getByRole("button", { name: "Rule Chain에 추가" }).click();

  await builder.getByRole("button", { name: "필터", exact: true }).click();
  await search.fill("ADX Trend Filter");
  await builder
    .locator(".engine-preset")
    .filter({ hasText: "ADX Trend Filter" })
    .getByRole("button", { name: "Rule Chain에 추가" })
    .click();

  await builder.getByRole("button", { name: "청산", exact: true }).click();
  await search.fill("Break Even Stop");
  await builder
    .locator(".engine-preset")
    .filter({ hasText: "Break Even Stop" })
    .getByRole("button", { name: "Rule Chain에 추가" })
    .click();

  await builder.getByRole("button", { name: "+ 중첩 그룹" }).first().click();
  await expect(builder.getByText(/3 \/ 64 conditions/)).toBeVisible();
  await builder.getByRole("button", { name: "백테스트", exact: true }).click();

  await expect(page.getByRole("heading", { name: "검증 결과" })).toBeVisible();
  await page.locator(".engine-results details").first().locator("summary").click();
  await expect(page.getByText("OBV breakout", { exact: true })).toBeVisible();
  await expect(page.getByText(/Strategy v3 BUY\/SELL 2개/)).toBeVisible();
  await expect(page.getByText("Conservative intrabar policy")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("#strategy-builder").analyze()).violations,
  ).toEqual([]);
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#strategy-builder *")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right > window.innerWidth + 1 || bounds.left < -1;
      })
      .map((element) => ({
        className: element.className,
        tag: element.tagName,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .slice(0, 10),
  );
  expect(overflow).toEqual([]);
});

test("starts the completed 15m open and Session VWAP cross preset", async ({ page }) => {
  await page.goto("/");
  await selectInstrument(page);
  await startV3Preset(page, "15m open", "15m Open × Session VWAP Cross");

  const builder = page.locator("#strategy-builder");
  await expect(builder.locator(".engine-sticky-bar select").first()).toHaveValue("15m");
  await expect(builder.getByRole("textbox", { name: "Rule label" }).first()).toHaveValue(
    "15m open crosses Session VWAP",
  );
  await expect(builder.getByRole("textbox", { name: "Rule label" }).nth(1)).toHaveValue(
    "15m open crosses below Session VWAP",
  );
  await expect(builder.getByText(/1 \/ 64 conditions/).first()).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("#strategy-builder").analyze()).violations,
  ).toEqual([]);
});

test("recommends all-entry winner, accepts a custom period and saves tracking ON", async ({
  page,
}) => {
  await page.goto("/");
  await selectInstrument(page);

  const panel = page.locator("#strategy-recommendation");
  await expect(panel.getByRole("heading", { name: "과거 수익률 추천" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Rolling VWAP Breakout" })).toBeVisible();
  await expect(panel.getByText(/43개 Entry 후보/)).toBeVisible();
  await panel.getByLabel("분석 시작일").fill("2026-07-01");
  await expect(panel.getByRole("button", { name: "추천 전략 적용" })).toHaveCount(0);
  await panel.getByLabel("분석 종료일").fill("2026-08-31");
  const customRequest = page.waitForRequest("**/api/strategy-recommendations");
  await panel.getByRole("button", { name: "이 기간으로 다시 분석" }).click();
  expect((await customRequest).postDataJSON()).toMatchObject({
    window: { startDate: "2026-07-01", endDate: "2026-08-31" },
  });
  await expect(panel.getByText(/2026-07-01.*2026-08-31.*직접 설정/)).toBeVisible();

  await panel.getByRole("button", { name: "추천 전략 적용" }).click();
  await expect(page.getByLabel("전략 이름")).toHaveValue("Rolling VWAP Breakout");
  await panel.getByRole("button", { name: "저장하고 트래킹 ON" }).click();
  await expect(panel.getByRole("status")).toContainText("트래킹 ON");
  await expect(
    page.getByRole("button", { name: /추천.*Rolling VWAP Breakout.*엔비디아/ }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("#strategy-recommendation").analyze()).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("loads older candles on the left once and stops an inclusive repeated cursor", async ({
  page,
}) => {
  await page.unroute("**/api/market/candles?**");
  const requests: Array<string | null> = [];
  const span = 86_400_000;
  const origin = Date.UTC(2025, 0, 1);
  const series = (start: number, count: number) =>
    Array.from({ length: count }, (_, offset) => {
      const index = start + offset;
      const base = 100 + index * 0.1;
      return {
        timestamp: new Date(origin + index * span).toISOString(),
        open: base,
        high: base + 2,
        low: base - 2,
        close: base + 1,
        volume: 10_000 + index,
        currency: "USD",
      };
    });
  await page.route("**/api/market/candles?**", async (route) => {
    const url = new URL(route.request().url());
    const before = url.searchParams.get("before");
    requests.push(before);
    await route.fulfill({
      json: {
        instrumentId: instrument.instrumentId,
        market: instrument.market,
        symbol: instrument.symbol,
        interval: "1d",
        adjusted: true,
        source: "TOSS OpenAPI",
        candles: before ? series(100, 101) : series(200, 200),
        // The older response deliberately repeats its cursor and inclusive boundary.
        nextBefore: "cursor-1",
      },
    });
  });

  await page.goto("/");
  await selectInstrument(page);
  const chart = page.getByRole("img", { name: /엔비디아 1d 캔들차트/ });
  await expect(chart).toHaveAttribute("data-loaded-count", "200");
  await chart.scrollIntoViewIfNeeded();
  const bounds = await chart.locator("canvas").nth(1).boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    // A narrow viewport reveals fewer pixels per gesture, so keep panning until
    // the left edge is reached instead of assuming a desktop-sized distance.
    for (let attempt = 0; attempt < 24 && requests.length < 2; attempt += 1) {
      await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.45);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.45, {
        steps: 8,
      });
      await page.mouse.up();
    }
  }
  await expect.poll(() => requests).toEqual([null, "cursor-1"]);
  await expect(chart).toHaveAttribute("data-loaded-count", "300");
  await expect(page.locator(".chart-runtime-status")).toContainText("가장 오래된 데이터 경계");

  await page.waitForTimeout(400);
  expect(requests).toEqual([null, "cursor-1"]);
});

test("discards a stale daily response after switching to five-minute candles", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "request-race regression runs once");
  await page.unroute("**/api/market/candles?**");
  const requestedIntervals: string[] = [];
  await page.route("**/api/market/candles?**", async (route) => {
    const interval = new URL(route.request().url()).searchParams.get("interval") ?? "1d";
    requestedIntervals.push(interval);
    if (interval === "1d") await new Promise((resolve) => setTimeout(resolve, 600));
    const start = interval === "1m" ? Date.UTC(2026, 7, 24, 13, 30) : Date.UTC(2025, 0, 1);
    const count = interval === "1m" ? 180 : 100;
    const span = interval === "1m" ? 60_000 : 86_400_000;
    await route.fulfill({
      json: {
        instrumentId: instrument.instrumentId,
        market: instrument.market,
        symbol: instrument.symbol,
        interval,
        adjusted: true,
        source: "TOSS OpenAPI",
        candles: Array.from({ length: count }, (_, index) => ({
          timestamp: new Date(start + index * span).toISOString(),
          open: 100 + index,
          high: 102 + index,
          low: 99 + index,
          close: 101 + index,
          volume: 1_000 + index,
          currency: "USD",
        })),
        nextBefore: null,
      },
    });
  });

  await page.goto("/");
  await selectInstrument(page);
  await expect.poll(() => requestedIntervals).toContain("1d");
  await page.getByRole("button", { name: "5분", exact: true }).click();
  const chart = page.getByRole("img", { name: /엔비디아 5m 캔들차트/ });
  await expect(chart).toHaveAttribute("data-loaded-count", "36");
  await page.waitForTimeout(750);
  await expect(chart).toHaveAttribute("data-loaded-count", "36");
  expect(requestedIntervals).toContain("1d");
  expect(requestedIntervals).toContain("1m");
});

test("creates the requested indicators and real Fibonacci and brush drawings", async ({ page }) => {
  await page.goto("/");
  await selectInstrument(page);
  const chart = page.getByRole("img", { name: /엔비디아 1d 캔들차트/ });

  for (const indicator of ["VWAP", "ICHIMOKU", "STOCH_RSI"] as const) {
    await addIndicator(page, indicator);
    await expect(
      page.locator("[data-indicator-instance]").filter({ hasText: indicator }),
    ).toHaveCount(1);
  }
  await expect(chart).toHaveAttribute("data-indicators", /ICHIMOKU/);
  await expect(chart).toHaveAttribute("data-indicators", /STOCH_RSI/);
  await expect(chart).toHaveAttribute("data-indicators", /VWAP/);
  await expect(page.locator(".chart-runtime-status")).toContainText("VWAP");

  await chart.scrollIntoViewIfNeeded();
  const bounds = await chart.locator("canvas").nth(1).boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.getByRole("button", { name: "피보나치", exact: true }).click();
  await expect(page.getByRole("button", { name: "피보나치", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".drawing-guidance")).toContainText("고점과 저점");
  await expect(chart).toHaveAttribute("data-drawing-count", "1");
  await chart.scrollIntoViewIfNeeded();
  const fibonacciBounds = await chart.locator("canvas").nth(1).boundingBox();
  expect(fibonacciBounds).not.toBeNull();
  if (!fibonacciBounds) return;
  await page.mouse.click(
    fibonacciBounds.x + fibonacciBounds.width * 0.3,
    fibonacciBounds.y + fibonacciBounds.height * 0.25,
  );
  // KLineChart reserves the next 500ms for double-click detection. A separate
  // anchor click must happen after that window to be treated as the second point.
  await page.waitForTimeout(650);
  await page.mouse.click(
    fibonacciBounds.x + fibonacciBounds.width * 0.65,
    fibonacciBounds.y + fibonacciBounds.height * 0.45,
  );
  await expect(chart).toHaveAttribute("data-drawing-points", "2");
  await expect(page.getByRole("button", { name: "피보나치", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.getByRole("button", { name: "빗금/브러시", exact: true }).click();
  await expect(page.locator(".drawing-guidance")).toContainText("누른 채 드래그");
  await chart.scrollIntoViewIfNeeded();
  const brushBounds = await chart.locator("canvas").nth(1).boundingBox();
  expect(brushBounds).not.toBeNull();
  if (!brushBounds) return;
  await page.mouse.move(
    brushBounds.x + brushBounds.width * 0.25,
    brushBounds.y + brushBounds.height * 0.35,
  );
  await page.mouse.down();
  await page.mouse.move(
    brushBounds.x + brushBounds.width * 0.4,
    brushBounds.y + brushBounds.height * 0.3,
    { steps: 5 },
  );
  await page.mouse.move(
    brushBounds.x + brushBounds.width * 0.55,
    brushBounds.y + brushBounds.height * 0.4,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(chart).toHaveAttribute("data-drawing-count", "2");
  await expect(chart).toHaveAttribute("data-drawing-points", /[3-9]|[1-9][0-9]+/);

  await page.getByRole("button", { name: "5분" }).click();
  await expect(page.getByRole("img", { name: /엔비디아 5m 캔들차트/ })).toHaveAttribute(
    "data-drawing-count",
    "2",
  );
  await page.getByRole("button", { name: "그림 전체 삭제" }).click();
  await expect(page.getByRole("img", { name: /엔비디아 5m 캔들차트/ })).toHaveAttribute(
    "data-drawing-count",
    "0",
  );
});

test("creates every remaining exposed drawing tool on the candle pane", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "desktop-1440", "full drawing matrix runs once on desktop");
  await page.goto("/");
  await selectInstrument(page);
  const chart = page.getByRole("img", { name: /엔비디아 1d 캔들차트/ });
  await chart.scrollIntoViewIfNeeded();

  const tools = [
    { label: "추세선", points: 2 },
    { label: "직선", points: 2 },
    { label: "광선", points: 2 },
    { label: "수평 광선", points: 2 },
    { label: "수평 구간", points: 2 },
    { label: "수평선", points: 1 },
    { label: "수직 광선", points: 2 },
    { label: "수직 구간", points: 2 },
    { label: "수직선", points: 1 },
    { label: "평행선", points: 3 },
    { label: "가격 채널", points: 3 },
    { label: "가격선", points: 1 },
    { label: "박스", points: 2 },
    { label: "피치포크", points: 3 },
    { label: "팬", points: 2 },
    { label: "주석", points: 1 },
    { label: "태그", points: 1 },
  ] as const;

  for (const [toolIndex, tool] of tools.entries()) {
    const toolButton = page.getByRole("button", { name: tool.label, exact: true });
    await expect(toolButton.locator("[data-drawing-icon]")).toBeVisible();
    await toolButton.click();
    // Clear KLineChart's prior click/double-click window before a new tool starts.
    await page.waitForTimeout(650);
    const canvas = await chart.locator("canvas").nth(1).boundingBox();
    expect(canvas).not.toBeNull();
    if (!canvas) return;
    for (let pointIndex = 0; pointIndex < tool.points; pointIndex += 1) {
      await page.mouse.click(
        canvas.x + canvas.width * (0.25 + pointIndex * 0.2),
        canvas.y + canvas.height * (0.25 + pointIndex * 0.12),
      );
      if (pointIndex + 1 < tool.points) await page.waitForTimeout(650);
    }
    await expect(chart).toHaveAttribute("data-drawing-count", String(toolIndex + 1));
  }

  await page.getByRole("button", { name: "그림 전체 삭제" }).click();
  await expect(chart).toHaveAttribute("data-drawing-count", "0");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "차트 저장", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("NVDA-1d-chart.png");

  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.keyboard.press("Escape");
});

test("shows provider no-result states without synthetic fallback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "종목명 또는 티커" }).fill("없는종목");
  await page.getByRole("button", { name: "종목 조회" }).click();
  await expect(page.locator("#provider-search-error")).toContainText(
    "일치하는 실제 상장 종목이 없습니다",
  );
  await expect(page.locator("#provider-search-error")).toContainText(
    "시장과 종목명 또는 티커를 확인",
  );
  await expect(page.getByText(/Apple|삼성전자|NVIDIA/)).toHaveCount(0);
  await expect(page.getByRole("img", { name: /캔들차트/ })).toHaveCount(0);
});

test("clears stale search results when the market region changes", async ({ page }) => {
  await page.unroute("**/api/instruments?**");
  let releaseSearch: (() => void) | undefined;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route("**/api/instruments?**", async (route) => {
    await searchGate;
    await route.fulfill({
      json: { instruments: [instrument], source: "TOSS OpenAPI", requestId: "slow-e2e" },
    });
  });
  await page.goto("/");
  await page.getByRole("radio", { name: "미국" }).check();
  await page.getByRole("searchbox", { name: "종목명 또는 티커" }).fill("NVDA");
  const response = page.waitForResponse("**/api/instruments?**");
  await page.getByRole("button", { name: "종목 조회" }).click();
  await page.getByRole("radio", { name: "국내" }).check();
  releaseSearch?.();
  await response;

  await expect(page.getByRole("button", { name: /엔비디아.*NVDA.*NASDAQ.*USD/ })).toHaveCount(0);
  await expect(page.getByText("검색할 시장이 국내로 바뀌었습니다.")).toBeVisible();
});

test("explains how to recover from a provider search failure", async ({ page }) => {
  await page.unroute("**/api/instruments?**");
  await page.route("**/api/instruments?**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "TOSS 종목 검색을 사용할 수 없습니다." } },
    }),
  );

  await page.goto("/");
  await page.getByRole("searchbox", { name: "종목명 또는 티커" }).fill("005930");
  await page.getByRole("button", { name: "종목 조회" }).click();

  await expect(page.locator("#provider-search-error")).toContainText(
    "TOSS 서버 설정과 허용 IP를 확인",
  );
});

test("runs a selected strategy and synchronizes BUY SELL markers to chart and table", async ({
  page,
}) => {
  await page.goto("/");
  await selectInstrument(page);
  await startV3Preset(page, "N-Bar Breakout", "N-Bar Breakout");
  await page.locator("#strategy-builder").getByRole("button", { name: "백테스트" }).click();

  await expect(page.getByRole("heading", { name: "검증 결과" })).toBeVisible();
  await expect(page.getByText("Strategy v3 BUY/SELL 2개", { exact: false })).toBeVisible();
  await page.getByText("BUY/SELL 신호 2건", { exact: false }).click();
  await expect(page.getByRole("cell", { name: "▲ BUY" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "▼ SELL" })).toBeVisible();
  await expect(page.locator(".signal-table-wrap table")).toBeVisible();
  await expect(page.getByText("Conservative intrabar policy")).toBeVisible();
  await expect(page.getByText("Synthetic fixture", { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("turns multiple natural-language entries into one editable v3 rule chain", async ({
  page,
}) => {
  await page.goto("/");
  await selectInstrument(page);
  await page
    .locator("#strategy-v3-natural-prompt")
    .fill(
      "EMA crossover 그리고 RSI oversold rebound 그리고 Bollinger breakout, ADX 25 이상 필터, ATR stop과 time stop",
    );
  await page.getByRole("button", { name: "Rule Chain 생성", exact: true }).click();

  await expect(
    page.getByText(/로컬 DSL 변환 완료 · Entry 3개 · Filter 1개 · Exit 2개/),
  ).toBeVisible();
  await expect(page.locator(".engine-stage").first()).toContainText("3 / 64 conditions");
  await expect(page.locator(".engine-exit-list > article")).toHaveCount(2);
  expect(
    (await new AxeBuilder({ page }).include("#strategy-builder").analyze()).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("saves, views, reloads and preserves orphaned history from the JSON library", async ({
  page,
}) => {
  await page.goto("/");
  await selectInstrument(page);
  await startV3Preset(page, "Rolling VWAP Breakout", "Rolling VWAP Breakout");
  await page.getByLabel("저장 이름").fill("NVDA 돌파 감시");
  await page.getByLabel("설명").fill("E2E JSON CRUD");
  await page.getByRole("button", { name: "새 전략 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "JSON으로 저장" })).toBeVisible();

  await page.getByRole("button", { name: /NVDA 돌파 감시.*엔비디아.*5m/ }).click();
  await expect(page.getByRole("heading", { name: "NVDA 돌파 감시" })).toBeVisible();
  await page.getByText("전략 JSON 보기").click();
  await expect(page.locator(".strategy-view pre")).toContainText('"version": 3');
  await page.getByRole("button", { name: "차트/설정 불러오기" }).click();
  await expect(page.getByText("전략과 차트 설정을 불러왔습니다", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "실시간 감시 시작" }).click();
  await expect(page.getByText("실시간 감시를 예약", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "즉시 백테스트" }).click();
  await expect(page.getByText("백테스트 결과를 실행 이력에 저장", { exact: false })).toBeVisible();
  const history = page.locator(".strategy-history");
  await expect(history.getByRole("button", { name: /\+3\.20%.*MDD -2\.10%/ })).toBeVisible();
  await history.getByRole("button", { name: /\+3\.20%.*MDD -2\.10%/ }).click();
  await expect(history.getByText(/선택 실행 JSON.*qos-strategy-engine-v3/)).toBeVisible();
  await expect(history.locator("pre")).toContainText('"strategyRevision": 2');
  expect(
    (await new AxeBuilder({ page }).include(".strategy-history").analyze()).violations,
  ).toEqual([]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".strategy-view-actions").getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("heading", { name: "전략 라이브러리" })).toBeFocused();
  const globalHistory = page.locator(".strategy-history");
  const orphan = globalHistory.getByRole("button", {
    name: /\+3\.20%.*NVDA 돌파 감시.*NASDAQ:NVDA.*삭제된 전략/,
  });
  await expect(orphan).toBeVisible();
  await orphan.click();
  await expect(globalHistory.locator("pre")).toContainText('"strategyName": "NVDA 돌파 감시"');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  page.once("dialog", (dialog) => dialog.accept());
  await globalHistory.getByRole("button", { name: /백테스트 이력 삭제/ }).click();
  await expect(globalHistory.getByText("아직 저장된 실행 결과가 없습니다.")).toBeVisible();
  await expect(globalHistory).toBeFocused();
});

test("selects one strategy and tracks multiple stocks and ETFs", async ({ page }) => {
  await page.goto("/");
  await selectInstrument(page);
  await startV3Preset(page, "EMA / SMA Crossover", "EMA / SMA Crossover");
  await page.getByLabel("저장 이름").fill("미국 멀티종목 감시");
  await page.getByRole("button", { name: "새 전략 저장" }).click();
  await page.getByRole("button", { name: /미국 멀티종목 감시.*엔비디아.*5m/ }).click();

  const targets = page.locator(".monitor-targets");
  await expect(targets.getByRole("heading", { name: "다종목 신호 감시" })).toBeVisible();
  await targets.getByRole("searchbox", { name: "감시 종목명 또는 티커" }).fill("SPY");
  await targets.getByRole("button", { name: "검색", exact: true }).click();
  await expect(targets.getByText("FOREIGN_ETF", { exact: false })).toBeVisible();
  await expect(targets.getByText("로컬 catalog cache", { exact: false })).toBeVisible();
  await targets
    .getByRole("list", { name: "감시 종목 검색 결과" })
    .getByRole("button", { name: "추가", exact: true })
    .click();
  await expect(
    targets.getByRole("list", { name: "현재 감시 종목" }).getByRole("listitem"),
  ).toHaveCount(2);

  const selectedTargets = targets.getByRole("list", { name: "현재 감시 종목" });
  const primaryRow = selectedTargets.getByRole("listitem").filter({ hasText: "엔비디아" });
  await primaryRow.getByRole("checkbox", { name: "감시 ON" }).uncheck();
  await expect(primaryRow.getByText("TRACKING OFF", { exact: true })).toBeVisible();

  const spyRow = selectedTargets.getByRole("listitem").filter({ hasText: "SPDR S&P 500 ETF" });
  await spyRow.getByRole("button", { name: "인버스 선택" }).click();
  await targets.getByRole("searchbox", { name: "인버스 ETF/ETN 이름 또는 티커" }).fill("SH");
  await targets.getByRole("button", { name: "검색", exact: true }).click();
  await targets.getByRole("button", { name: "헷지 지정" }).click();
  await expect(spyRow.getByText(/매도 전환 헷지.*ProShares Short S&P500/)).toBeVisible();

  await targets.getByRole("button", { name: "대상 저장 + 감시 시작" }).click();
  await expect(page.getByText("1개 종목의 감시를 예약", { exact: false })).toBeVisible();
  await expect(page.getByText("MONITOR ON", { exact: true })).toBeVisible();
  await page.getByText("전략 JSON 보기").click();
  await expect(page.locator(".strategy-view pre")).toContainText('"instrumentId": "NYSE:SPY"');
  await expect(page.locator(".strategy-view pre")).toContainText('"instrumentId": "AMEX:SH"');
  expect((await new AxeBuilder({ page }).include(".monitor-targets").analyze()).violations).toEqual(
    [],
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("exposes Telegram and monitor state with keyboard-accessible controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Telegram 알림" })).toBeVisible();
  await expect(page.getByText(/감시 연결됨.*전략 1.*전송 2/)).toBeVisible();
  const connect = page.getByRole("button", { name: "채팅 연결" });
  await connect.focus();
  await expect(connect).toBeFocused();
  const box = await connect.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("shows monitor heartbeat, safe error code and a recovery command", async ({ page }) => {
  await page.unroute("**/api/monitor/status");
  await page.route("**/api/monitor/status", (route) =>
    route.fulfill({
      json: {
        status: "error",
        heartbeatAt: "2026-09-01T00:00:00.000Z",
        enabledStrategies: 2,
        deliveredSignals: 4,
        failedSignals: 1,
        lastErrorCode: "TossProviderError",
      },
    }),
  );

  await page.goto("/");

  const automation = page.getByRole("region", { name: "Telegram 알림" });
  await expect(automation.getByText("감시 오류", { exact: true })).toBeVisible();
  await expect(automation.getByText(/마지막 확인/)).toBeVisible();
  await expect(automation.getByText(/TossProviderError/)).toBeVisible();
  await expect(automation.getByText(/npm run deploy:local:status/)).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".telegram-settings").analyze()).violations,
  ).toEqual([]);
});
