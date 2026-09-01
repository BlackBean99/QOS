import { describe, expect, it, vi } from "vitest";

import { createBacktestRunHandlers } from "@/app/api/backtest-runs/[id]/route";
import { createBacktestRunCollectionHandler } from "@/app/api/backtest-runs/route";
import { createStrategyBacktestHandlers } from "@/app/api/strategies/[id]/backtests/route";
import { toBacktestRunListItem, type StoredBacktestRun } from "@/src/domain/strategy-history";

const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function run(): StoredBacktestRun {
  return {
    id: RUN_ID,
    strategyId: STRATEGY_ID,
    strategyName: "AAPL 돌파",
    strategyRevision: 2,
    strategyVersion: 1,
    instrumentId: "NASDAQ:AAPL",
    market: "NASDAQ",
    timeframe: "1d",
    engineVersion: "qos-backtest-v1",
    strategySnapshot: {
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
    instrumentSnapshot: {
      instrumentId: "NASDAQ:AAPL",
      market: "NASDAQ",
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD",
      timezone: "America/New_York",
      synthetic: false,
    },
    summary: {
      kind: "strategy_v1",
      totalReturnPercent: 12.5,
      maxDrawdownPercent: -7.2,
      sharpeRatio: 1.1,
      trades: 4,
      periodStart: "2026-01-01",
      periodEnd: "2026-08-01",
    },
    result: { metrics: { totalReturnPercent: 12.5 }, trades: [] },
    createdAt: "2026-08-25T01:00:00.000Z",
  };
}

function listItem() {
  return toBacktestRunListItem(run());
}

describe("strategy backtest history routes", () => {
  it("runs a saved strategy and returns result plus a summary-only history item", async () => {
    const runBacktest = vi.fn(async () => ({ run: run(), result: run().result }));
    const service = {
      runBacktest,
      listBacktests: async () => [listItem()],
    };
    const handlers = createStrategyBacktestHandlers(service);

    const response = await handlers.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          window: { startDate: "2026-01-01", endDate: "2026-08-01" },
        }),
      }),
      { params: Promise.resolve({ id: STRATEGY_ID }) },
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      run: { id: RUN_ID, summary: { totalReturnPercent: 12.5 } },
      result: { metrics: { totalReturnPercent: 12.5 } },
    });
    expect(runBacktest).toHaveBeenCalledWith(STRATEGY_ID, {
      startDate: "2026-01-01",
      endDate: "2026-08-01",
    });

    const listed = await handlers.GET(new Request("http://localhost?limit=20"), {
      params: Promise.resolve({ id: STRATEGY_ID }),
    });
    const payload = await listed.json();
    expect(payload.runs).toEqual([listItem()]);
    expect(JSON.stringify(payload.runs)).not.toContain("strategySnapshot");
    expect(JSON.stringify(payload.runs)).not.toContain('"result"');
  });

  it("validates strategy ids and bounded list limits", async () => {
    const service = {
      runBacktest: async () => {
        throw new Error("not called");
      },
      listBacktests: async () => [],
    };
    const handlers = createStrategyBacktestHandlers(service);
    const response = await handlers.GET(new Request("http://localhost?limit=1000"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });

  it("reads and deletes one full history record", async () => {
    let deleted = false;
    const service = {
      getBacktest: async () => run(),
      deleteBacktest: async () => {
        deleted = true;
        return true;
      },
    };
    const handlers = createBacktestRunHandlers(service);
    const context = { params: Promise.resolve({ id: RUN_ID }) };

    const read = await handlers.GET(new Request("http://localhost"), context);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ run: { id: RUN_ID, result: run().result } });
    const removed = await handlers.DELETE(new Request("http://localhost"), context);
    expect(removed.status).toBe(204);
    expect(deleted).toBe(true);
  });

  it("lists preserved history independently of a current strategy", async () => {
    const handler = createBacktestRunCollectionHandler({
      listAllBacktests: async () => [listItem()],
    });
    const response = await handler(new Request("http://localhost/api/backtest-runs?limit=20"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runs: [{ id: RUN_ID }] });
  });
});
