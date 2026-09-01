import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewBacktestRunSchema, type StoredBacktestRun } from "@/src/domain/strategy-history";
import { BacktestHistoryStore } from "@/src/server/backtest-history-store";
import { SupabaseBacktestHistoryStore } from "@/src/server/supabase-backtest-history";

const directories: string[] = [];

function runInput() {
  return NewBacktestRunSchema.parse({
    strategyId: "11111111-1111-4111-8111-111111111111",
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
  });
}

function storedRun(): StoredBacktestRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ...runInput(),
    createdAt: "2026-08-25T01:00:00.000Z",
  };
}

function row(run: StoredBacktestRun) {
  return {
    id: run.id,
    strategy_id: run.strategyId,
    strategy_name: run.strategyName,
    strategy_revision: run.strategyRevision,
    strategy_version: run.strategyVersion,
    instrument_id: run.instrumentId,
    market: run.market,
    timeframe: run.timeframe,
    engine_version: run.engineVersion,
    strategy_snapshot: run.strategySnapshot,
    instrument_snapshot: run.instrumentSnapshot,
    summary: run.summary,
    result: run.result,
    created_at: run.createdAt,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("BacktestHistoryStore", () => {
  it("persists summary/full history across local adapter restarts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-backtest-history-"));
    directories.push(directory);
    const filePath = path.join(directory, "runs.json");
    const first = new BacktestHistoryStore({
      filePath,
      now: () => new Date("2026-08-25T01:00:00.000Z"),
      createId: () => storedRun().id,
    });
    const created = await first.create(runInput());
    const second = new BacktestHistoryStore({ filePath });

    await expect(second.list(runInput().strategyId, 20)).resolves.toEqual([
      {
        id: created.id,
        strategyId: created.strategyId,
        strategyName: created.strategyName,
        strategyRevision: created.strategyRevision,
        strategyVersion: created.strategyVersion,
        instrumentId: created.instrumentId,
        market: created.market,
        timeframe: created.timeframe,
        engineVersion: created.engineVersion,
        summary: created.summary,
        createdAt: created.createdAt,
      },
    ]);
    await expect(second.listAll(20)).resolves.toHaveLength(1);
    await expect(second.get(created.id)).resolves.toEqual(created);
    await expect(second.detachMissingStrategies([])).resolves.toBe(1);
    await expect(second.listAll(20)).resolves.toEqual([
      expect.objectContaining({ id: created.id, strategyId: null, strategyName: "AAPL 돌파" }),
    ]);
    await expect(second.detachMissingStrategies([])).resolves.toBe(0);
    await expect(second.delete(created.id)).resolves.toBe(true);
    await expect(second.get(created.id)).resolves.toBeNull();
  });

  it("detaches an orphan outside the visible 20-run page without touching live links", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-backtest-reconcile-"));
    directories.push(directory);
    let id = 0;
    const filePath = path.join(directory, "runs.json");
    const history = new BacktestHistoryStore({
      filePath,
      now: () => new Date(`2026-08-25T01:${String(id).padStart(2, "0")}:00.000Z`),
      createId: () => `${(++id).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`,
    });
    const liveId = runInput().strategyId;
    const orphanId = "33333333-3333-4333-8333-333333333333";
    await history.create({ ...runInput(), strategyId: orphanId, strategyName: "old orphan" });
    for (let index = 0; index < 21; index += 1) await history.create(runInput());

    await expect(history.listAll(20)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ strategyId: orphanId })]),
    );
    await expect(history.listAll(20, [liveId])).resolves.toHaveLength(20);
    await expect(history.list(liveId, 50)).resolves.toHaveLength(21);
    await expect(history.get("00000001-0000-4000-8000-000000000001")).resolves.toMatchObject({
      strategyId: null,
      strategyName: "old orphan",
    });

    // Seed a still-linked missing strategy so reconciliation necessarily writes. Reconciliation
    // and a mutation may then be requested together; the write queue must serialize both envelopes
    // so neither operation can resurrect or drop the other one's rows.
    const concurrentOrphan = await history.create({
      ...runInput(),
      strategyId: "44444444-4444-4444-8444-444444444444",
    });
    const reconcile = history.listAll(20, [liveId]);
    const create = history.create(runInput());
    const [, created] = await Promise.all([reconcile, create]);
    await expect(history.get(concurrentOrphan.id)).resolves.toMatchObject({ strategyId: null });
    await expect(history.get(created.id)).resolves.toMatchObject({ strategyId: liveId });
    await expect(history.list(liveId, 50)).resolves.toHaveLength(22);
  });

  it("detaches a specific strategy while preserving its immutable snapshot", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-backtest-detach-"));
    directories.push(directory);
    const filePath = path.join(directory, "runs.json");
    const first = new BacktestHistoryStore({
      filePath,
      now: () => new Date("2026-08-25T01:00:00.000Z"),
      createId: () => storedRun().id,
    });
    const created = await first.create(runInput());
    const second = new BacktestHistoryStore({ filePath });
    await expect(second.detachStrategy(runInput().strategyId)).resolves.toBe(1);
    await expect(second.list(runInput().strategyId, 20)).resolves.toEqual([]);
    await expect(second.listAll(20)).resolves.toEqual([
      expect.objectContaining({ id: created.id, strategyId: null, strategyName: "AAPL 돌파" }),
    ]);
    await expect(second.get(created.id)).resolves.toEqual(
      expect.objectContaining({ strategyId: null, strategySnapshot: created.strategySnapshot }),
    );
    await expect(second.delete(created.id)).resolves.toBe(true);
    await expect(second.get(created.id)).resolves.toBeNull();
  });

  it("checks the serialized byte cap before replacing the history file", async () => {
    const fixed = {
      now: () => new Date("2026-08-25T01:00:00.000Z"),
      createId: () => storedRun().id,
    };
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), "qos-history-size-source-"));
    directories.push(sourceDirectory);
    const sourcePath = path.join(sourceDirectory, "runs.json");
    await new BacktestHistoryStore({ filePath: sourcePath, ...fixed }).create(runInput());
    const exactBytes = (await stat(sourcePath)).size;

    const exactDirectory = await mkdtemp(path.join(tmpdir(), "qos-history-size-exact-"));
    directories.push(exactDirectory);
    const exact = new BacktestHistoryStore({
      filePath: path.join(exactDirectory, "runs.json"),
      maximumBytes: exactBytes,
      ...fixed,
    });
    await expect(exact.create(runInput())).resolves.toMatchObject({ id: storedRun().id });
    await expect(exact.listAll(20)).resolves.toHaveLength(1);

    const rejectedDirectory = await mkdtemp(path.join(tmpdir(), "qos-history-size-reject-"));
    directories.push(rejectedDirectory);
    const rejected = new BacktestHistoryStore({
      filePath: path.join(rejectedDirectory, "runs.json"),
      maximumBytes: exactBytes - 1,
      ...fixed,
    });
    await expect(rejected.create(runInput())).rejects.toMatchObject({ code: "store_too_large" });
    await expect(rejected.listAll(20)).resolves.toEqual([]);
  });
});

describe("SupabaseBacktestHistoryStore", () => {
  it("stores full runs but lists only summary rows", async () => {
    const responses = [
      Response.json([row(storedRun())], { status: 201 }),
      Response.json([
        {
          id: storedRun().id,
          strategy_id: storedRun().strategyId,
          strategy_name: storedRun().strategyName,
          strategy_revision: storedRun().strategyRevision,
          strategy_version: storedRun().strategyVersion,
          instrument_id: storedRun().instrumentId,
          market: storedRun().market,
          timeframe: storedRun().timeframe,
          engine_version: storedRun().engineVersion,
          summary: storedRun().summary,
          created_at: storedRun().createdAt,
        },
      ]),
      Response.json([
        {
          id: storedRun().id,
          strategy_id: null,
          strategy_name: storedRun().strategyName,
          strategy_revision: storedRun().strategyRevision,
          strategy_version: storedRun().strategyVersion,
          instrument_id: storedRun().instrumentId,
          market: storedRun().market,
          timeframe: storedRun().timeframe,
          engine_version: storedRun().engineVersion,
          summary: storedRun().summary,
          created_at: storedRun().createdAt,
        },
      ]),
      Response.json([row(storedRun())]),
      Response.json([{ id: storedRun().id }]),
    ];
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return responses.shift() ?? Response.json([]);
    });
    const history = new SupabaseBacktestHistoryStore({
      url: "https://example.supabase.co",
      key: "server-secret-test-only",
      fetch: fetcher,
      now: () => new Date("2026-08-25T01:00:00.000Z"),
      createId: () => storedRun().id,
    });

    await expect(history.create(runInput())).resolves.toEqual(storedRun());
    await expect(history.list(runInput().strategyId, 20)).resolves.toHaveLength(1);
    await expect(history.listAll(20)).resolves.toEqual([
      expect.objectContaining({ id: storedRun().id, strategyId: null }),
    ]);
    await expect(history.get(storedRun().id)).resolves.toEqual(storedRun());
    await expect(history.delete(storedRun().id)).resolves.toBe(true);
    expect(requests[1]).not.toContain("result");
    expect(requests[1]).not.toContain("strategy_snapshot");
    expect(requests[1]).toContain("limit=20");
    expect(requests[2]).not.toContain("strategy_id=eq.");
  });
});
