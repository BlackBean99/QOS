import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createStrategyCollectionHandlers } from "@/app/api/strategies/route";
import { createStrategyItemHandlers } from "@/app/api/strategies/[id]/route";
import { createSafeStrategyRepository } from "@/src/server/strategy-repository";
import { createImportStrategies } from "@/app/api/strategies/import/route";
import { createExportStrategies } from "@/app/api/strategies/export/route";
import {
  MAX_STRATEGY_DOCUMENT_BYTES,
  NewStoredStrategySchema,
  StrategyExportSchema,
  type NewStoredStrategy,
} from "@/src/domain/stored-strategy";
import { StrategyStore } from "@/src/server/strategy-store";

const directories: string[] = [];

async function createStore(): Promise<StrategyStore> {
  const directory = await mkdtemp(path.join(tmpdir(), "qos-strategy-routes-"));
  directories.push(directory);
  return new StrategyStore({ filePath: path.join(directory, "strategies.json") });
}

function body(): NewStoredStrategy {
  return NewStoredStrategySchema.parse({
    name: "삼성 추세 전략",
    description: "저장과 불러오기 검증",
    instrument: {
      instrumentId: "KOSPI:005930",
      market: "KOSPI",
      symbol: "005930",
      displayName: "삼성전자",
      currency: "KRW",
      timezone: "Asia/Seoul",
      synthetic: false,
      securityType: "STOCK",
      isinCode: "KR7005930003",
    },
    strategy: {
      version: 1,
      name: "005930 HIGH 20",
      market: "KOSPI",
      instrumentId: "KOSPI:005930",
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
    monitor: { enabled: false, interval: "1d" },
  });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("strategy CRUD routes", () => {
  it.each([
    [{ SUPABASE_URL: "https://example.supabase.co" }, "URL only"],
    [{ SUPABASE_SECRET_KEY: "sb_secret_test" }, "key only"],
    [
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_publishable_test",
      },
      "publishable key",
    ],
    [{ SUPABASE_URL: "not-a-url", SUPABASE_SECRET_KEY: "sb_secret_test" }, "invalid URL"],
  ])(
    "returns a structured no-store 503 for invalid server config: %s",
    async (environment, _label) => {
      void _label;
      const response = await createStrategyCollectionHandlers(
        createSafeStrategyRepository(environment),
      ).GET();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "missing_config", message: "Supabase 서버 설정을 확인해 주세요." },
      });
    },
  );
  it("creates, lists, updates, reads and deletes a strategy", async () => {
    const store = await createStore();
    const collection = createStrategyCollectionHandlers(store);
    const item = createStrategyItemHandlers(store);
    const createdResponse = await collection.POST(
      new Request("http://localhost/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      }),
    );
    const created = (await createdResponse.json()) as {
      strategy: { id: string; revision: number };
    };
    expect(createdResponse.status).toBe(201);

    const listed = await collection.GET();
    await expect(listed.json()).resolves.toMatchObject({
      strategies: [{ id: created.strategy.id, name: "삼성 추세 전략" }],
    });

    const updateBody = { ...body(), name: "삼성 추세 전략 수정", expectedRevision: 1 };
    const updated = await item.PATCH(
      new Request(`http://localhost/api/strategies/${created.strategy.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateBody),
      }),
      { params: Promise.resolve({ id: created.strategy.id }) },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      strategy: { revision: 2, name: "삼성 추세 전략 수정" },
    });

    const read = await item.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: created.strategy.id }),
    });
    expect(read.status).toBe(200);

    const removed = await item.DELETE(
      new Request(`http://localhost/api/strategies/${created.strategy.id}?expectedRevision=2`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: created.strategy.id }) },
    );
    expect(removed.status).toBe(204);
    expect(await store.list()).toEqual([]);
  });

  it("returns 409 for stale revisions", async () => {
    const store = await createStore();
    const created = await store.create(body());
    const item = createStrategyItemHandlers(store);
    const response = await item.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body(), expectedRevision: 99 }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "revision_conflict" },
    });
  });

  it("exports portable JSON and imports it in clone mode", async () => {
    const store = await createStore();
    await store.create(body());
    const exportedResponse = await createExportStrategies(store)();
    const exported = await exportedResponse.json();
    expect(exportedResponse.headers.get("content-disposition")).toContain("qos-strategies.json");

    const importedResponse = await createImportStrategies(store)(
      new Request("http://localhost/api/strategies/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: exported, mode: "clone" }),
      }),
    );

    expect(importedResponse.status).toBe(200);
    await expect(importedResponse.json()).resolves.toMatchObject({ imported: 1 });
    expect(await store.list()).toHaveLength(2);
  });

  it("round-trips a valid self-export larger than the former 1MB transport cap", async () => {
    const store = await createStore();
    const timestamp = "2026-08-25T00:00:00.000Z";
    const points = Array.from({ length: 64 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      value: 100 + index / 10,
    }));
    const drawings = Array.from({ length: 200 }, (_, index) => ({
      id: `drawing-${index}`,
      kind: "brush" as const,
      points,
    }));
    const first = {
      id: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      ...body(),
      chart: { ...body().chart, drawings },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const second = { ...first, id: "22222222-2222-4222-8222-222222222222", name: "두 번째" };
    const document = StrategyExportSchema.parse({
      version: 1,
      exportedAt: timestamp,
      strategies: [first, second],
    });
    const requestBody = JSON.stringify({ document, mode: "clone" });
    expect(new TextEncoder().encode(requestBody).byteLength).toBeGreaterThan(1_000_000);

    const response = await createImportStrategies(store)(
      new Request("http://localhost/api/strategies/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ imported: 2 });
    await expect(store.exportAll()).resolves.toMatchObject({ strategies: expect.any(Array) });
  });

  it("keeps a near-limit compact export inside its own import budget", async () => {
    const timestamp = "2026-08-25T00:00:00.000Z";
    const points = Array.from({ length: 64 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      value: 100 + index / 10,
    }));
    const makeStrategy = (index: number, drawingCount: number) => ({
      id: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-${index
        .toString(16)
        .padStart(12, "0")}`,
      revision: 1,
      ...body(),
      name: `near-limit-${index}`.padEnd(100, "x"),
      description: "d".repeat(500),
      chart: {
        ...body().chart,
        drawings: Array.from({ length: drawingCount }, (_, drawingIndex) => ({
          id: `drawing-${drawingIndex}`,
          kind: "brush" as const,
          points,
        })),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const twoDrawingStrategies = Array.from({ length: 500 }, (_, index) =>
      makeStrategy(index + 1, 2),
    );
    const baseDocument = StrategyExportSchema.parse({
      version: 1,
      exportedAt: timestamp,
      strategies: twoDrawingStrategies,
    });
    const baseBytes = new TextEncoder().encode(JSON.stringify(baseDocument)).byteLength;
    const extraBytes =
      new TextEncoder().encode(JSON.stringify(makeStrategy(1, 3))).byteLength -
      new TextEncoder().encode(JSON.stringify(makeStrategy(1, 2))).byteLength;
    const extras = Math.max(
      0,
      Math.min(500, Math.floor((MAX_STRATEGY_DOCUMENT_BYTES - 2_048 - baseBytes) / extraBytes)),
    );
    const document = StrategyExportSchema.parse({
      ...baseDocument,
      strategies: Array.from({ length: 500 }, (_, index) =>
        makeStrategy(index + 1, index < extras ? 3 : 2),
      ),
    });
    const source = await createStore();
    const seeded = await createImportStrategies(source)(
      new Request("http://localhost/api/strategies/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, mode: "reject" }),
      }),
    );
    expect(seeded.status).toBe(200);
    const exported = await createExportStrategies(source)();
    const exportText = await exported.text();
    const exportBytes = new TextEncoder().encode(exportText).byteLength;

    expect(exportBytes).toBeGreaterThan(4_000_000);
    expect(exportBytes).toBeLessThanOrEqual(MAX_STRATEGY_DOCUMENT_BYTES);
    const destination = await createStore();
    const imported = await createImportStrategies(destination)(
      new Request("http://localhost/api/strategies/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: JSON.parse(exportText), mode: "clone" }),
      }),
    );
    expect(imported.status).toBe(200);
    await expect(destination.list()).resolves.toHaveLength(500);
  });

  it("rejects bodies over the route limit before JSON parsing", async () => {
    const store = await createStore();
    const collection = createStrategyCollectionHandlers(store);
    const response = await collection.POST(
      new Request("http://localhost/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2000000" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
  });
});
