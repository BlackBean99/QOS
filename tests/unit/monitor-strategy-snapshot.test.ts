import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPresetStrategyV3 } from "@/src/domain/strategy-v3/catalog";
import { StoredStrategySchema } from "@/src/domain/stored-strategy";
import { MonitorStrategySnapshotStore } from "@/src/monitor/strategy-snapshot-store";

const directories: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MonitorStrategySnapshotStore", () => {
  it("round-trips a validated last-known-good strategy list", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-snapshot-"));
    directories.push(directory);
    const store = new MonitorStrategySnapshotStore({
      filePath: path.join(directory, "snapshot.json"),
    });
    const instrument = {
      instrumentId: "NASDAQ:AAPL" as const,
      market: "NASDAQ" as const,
      symbol: "AAPL",
      displayName: "Apple",
      currency: "USD" as const,
      timezone: "America/New_York" as const,
      synthetic: false,
    };
    const strategy = StoredStrategySchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      name: "AAPL VWAP",
      description: "snapshot",
      instrument,
      strategy: createPresetStrategyV3("session-vwap-open-cross", instrument.instrumentId, {
        timeframe: "15m",
      }),
      chart: {
        version: 1,
        period: "5m",
        theme: "upbit-light",
        mainIndicators: ["VWAP"],
        subIndicators: ["VOL"],
        drawings: [],
        visibleRange: null,
      },
      monitor: { enabled: true, interval: "15m" },
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    });

    await store.write([strategy], new Date("2026-09-13T00:01:00.000Z"));
    await expect(store.read()).resolves.toEqual({
      savedAt: "2026-09-13T00:01:00.000Z",
      strategies: [strategy],
    });
  });

  it("returns null when no snapshot exists", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-snapshot-"));
    directories.push(directory);
    const store = new MonitorStrategySnapshotStore({
      filePath: path.join(directory, "missing.json"),
    });
    await expect(store.read()).resolves.toBeNull();
  });
});
