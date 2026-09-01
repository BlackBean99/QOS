import { describe, expect, it } from "vitest";

import type { BacktestResult } from "@/src/domain/backtest";
import { NewStoredStrategySchema, type StoredStrategy } from "@/src/domain/stored-strategy";
import type {
  BacktestRunListItem,
  BacktestHistoryRepository,
  NewBacktestRun,
  StoredBacktestRun,
} from "@/src/domain/strategy-history";
import { StrategyManagementService } from "@/src/server/strategy-management";
import { StrategyStoreError, type StrategyRepository } from "@/src/server/strategy-store";

function document(): StoredStrategy {
  const body = NewStoredStrategySchema.parse({
    name: "AAPL 돌파",
    description: "history test",
    instrument: {
      instrumentId: "NASDAQ:AAPL",
      market: "NASDAQ",
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD",
      timezone: "America/New_York",
      synthetic: false,
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
      mainIndicators: ["VWAP"],
      subIndicators: ["VOL"],
      drawings: [],
      visibleRange: null,
    },
    monitor: { enabled: false, interval: "1d" },
  });
  return {
    id: "11111111-1111-4111-8111-111111111111",
    revision: 3,
    ...body,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function result(strategy = document().strategy): BacktestResult {
  return {
    strategy: strategy as BacktestResult["strategy"],
    market: {
      instrumentId: "NASDAQ:AAPL",
      market: "NASDAQ",
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD",
      timeZone: "America/New_York",
      calendar: "XNYS demo sessions",
      source: "test",
      version: "1",
      synthetic: true,
      adjustedPrices: true,
    },
    period: { start: "2026-01-01", end: "2026-08-01", sessions: 140 },
    costs: { commissionBps: 1.5, slippageBps: 5, sellTaxBps: 0 },
    execution: {
      signalAt: "session_close",
      fillAt: "next_session_open",
      priceAdjustment: "adjusted",
    },
    metrics: {
      initialCapital: 100_000,
      endingEquity: 112_500,
      totalReturnPercent: 12.5,
      maxDrawdownPercent: -7.2,
      sharpeRatio: 1.1,
      winRatePercent: 55,
      closedTrades: 4,
      benchmarkReturnPercent: 8,
    },
    equityCurve: [],
    priceSeries: [],
    trades: [],
    warnings: [],
  };
}

class FakeHistory implements BacktestHistoryRepository {
  created: NewBacktestRun[] = [];
  detached: string[] = [];
  reconciledWith: string[][] = [];
  detachFailures = 0;

  async create(input: NewBacktestRun): Promise<StoredBacktestRun> {
    this.created.push(structuredClone(input));
    return {
      id: "22222222-2222-4222-8222-222222222222",
      ...input,
      createdAt: "2026-08-25T01:00:00.000Z",
    };
  }
  async list(): Promise<BacktestRunListItem[]> {
    return [];
  }
  async listAll(
    _limit?: number,
    existingStrategyIds?: readonly string[],
  ): Promise<BacktestRunListItem[]> {
    if (existingStrategyIds) this.reconciledWith.push([...existingStrategyIds]);
    return [];
  }
  async get() {
    return null;
  }
  async delete() {
    return false;
  }
  async detachStrategy(strategyId: string) {
    if (this.detachFailures > 0) {
      this.detachFailures -= 1;
      throw new StrategyStoreError("unavailable", "history unavailable");
    }
    this.detached.push(strategyId);
    return 1;
  }
  async detachMissingStrategies(existingStrategyIds: readonly string[]) {
    this.reconciledWith.push([...existingStrategyIds]);
    return 0;
  }
}

describe("StrategyManagementService", () => {
  it("executes the current stored revision and persists an immutable result summary", async () => {
    const stored = document();
    const strategies = { get: async () => stored } as unknown as StrategyRepository;
    const history = new FakeHistory();
    const service = new StrategyManagementService({
      strategies,
      history,
      execute: async () => result(),
    });

    const completed = await service.runBacktest(stored.id);

    expect(completed.run).toMatchObject({
      strategyId: stored.id,
      strategyRevision: 3,
      strategyName: "AAPL 돌파",
      engineVersion: "qos-backtest-v1",
      summary: {
        kind: "strategy_v1",
        totalReturnPercent: 12.5,
        maxDrawdownPercent: -7.2,
        sharpeRatio: 1.1,
        trades: 4,
      },
    });
    expect(history.created[0]?.strategySnapshot).toEqual(stored.strategy);
    expect(completed.result).toEqual(result());
  });

  it("fails closed when the requested stored strategy does not exist", async () => {
    const strategies = { get: async () => null } as unknown as StrategyRepository;
    const service = new StrategyManagementService({
      strategies,
      history: new FakeHistory(),
      execute: async () => result(),
    });

    await expect(service.runBacktest("33333333-3333-4333-8333-333333333333")).rejects.toEqual(
      new StrategyStoreError("not_found", "저장 전략을 찾지 못했습니다."),
    );
  });

  it("detaches immutable history snapshots after a strategy is deleted", async () => {
    const stored = document();
    const strategies = {
      delete: async (id: string, revision: number) => id === stored.id && revision === 3,
    } as unknown as StrategyRepository;
    const history = new FakeHistory();
    const service = new StrategyManagementService({
      strategies,
      history,
      execute: async () => result(),
    });

    await expect(service.deleteStrategy(stored.id, 3)).resolves.toBe(true);
    expect(history.detached).toEqual([stored.id]);
  });

  it("recovers an orphan link when a local detach fails after deletion", async () => {
    const stored = document();
    let exists = true;
    const strategies = {
      delete: async () => {
        const removed = exists;
        exists = false;
        return removed;
      },
    } as unknown as StrategyRepository;
    const history = new FakeHistory();
    history.detachFailures = 1;
    const service = new StrategyManagementService({
      strategies,
      history,
      execute: async () => result(),
    });

    await expect(service.deleteStrategy(stored.id, 3)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(service.deleteStrategy(stored.id, 3)).resolves.toBe(true);
    expect(history.detached).toEqual([stored.id]);
  });

  it("reconciles a crash-left history link during global discovery", async () => {
    const stored = document();
    let linked = true;
    const item = {
      id: "22222222-2222-4222-8222-222222222222",
      strategyId: stored.id,
      strategyName: stored.name,
      strategyRevision: stored.revision,
      strategyVersion: 1 as const,
      instrumentId: stored.instrument.instrumentId,
      market: stored.instrument.market,
      timeframe: "1d" as const,
      engineVersion: "qos-backtest-v1",
      summary: {
        kind: "strategy_v1" as const,
        totalReturnPercent: 1,
        maxDrawdownPercent: -1,
        sharpeRatio: 1,
        trades: 1,
        periodStart: "2026-01-01",
        periodEnd: "2026-02-01",
      },
      createdAt: "2026-08-25T01:00:00.000Z",
    };
    const history = new FakeHistory();
    history.listAll = async (_limit, existingStrategyIds) => {
      history.reconciledWith.push([...(existingStrategyIds ?? [])]);
      linked = false;
      return [{ ...item, strategyId: linked ? stored.id : null }];
    };
    const service = new StrategyManagementService({
      strategies: { listIds: async () => [] } as unknown as StrategyRepository,
      history,
      execute: async () => result(),
    });

    await expect(service.listAllBacktests(20)).resolves.toEqual([
      expect.objectContaining({ strategyId: null, strategyName: stored.name }),
    ]);
    expect(history.reconciledWith).toEqual([[]]);
  });

  it("reconciles links outside the displayed history page in one repository operation", async () => {
    const stored = document();
    const history = new FakeHistory();
    history.listAll = async (_limit, existingStrategyIds) => {
      history.reconciledWith.push([...(existingStrategyIds ?? [])]);
      return [];
    };
    const service = new StrategyManagementService({
      strategies: { listIds: async () => [stored.id] } as unknown as StrategyRepository,
      history,
      execute: async () => result(),
    });

    await expect(service.listAllBacktests(20)).resolves.toEqual([]);
    expect(history.reconciledWith).toEqual([[stored.id]]);
  });
});
