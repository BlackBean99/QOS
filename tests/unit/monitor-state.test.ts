import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MonitorStateStore } from "@/src/monitor/state-store";

const heldHedge = {
  instrumentId: "AMEX:SH" as const,
  market: "AMEX" as const,
  symbol: "SH",
  displayName: "ProShares Short S&P500",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "FOREIGN_ETF",
};

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MonitorStateStore", () => {
  it("deduplicates sent signals and bounds failed delivery attempts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-"));
    directories.push(directory);
    const store = new MonitorStateStore({ filePath: path.join(directory, "state.json") });

    await expect(store.shouldDeliver("signal-1")).resolves.toBe(true);
    await store.recordDelivery("signal-1", "failed", "telegram_unavailable");
    await store.recordDelivery("signal-1", "failed", "telegram_unavailable");
    await expect(store.shouldDeliver("signal-1")).resolves.toBe(true);
    await store.recordDelivery("signal-1", "failed", "telegram_unavailable");
    await expect(store.shouldDeliver("signal-1")).resolves.toBe(false);

    await store.recordDelivery("signal-2", "sent");
    await expect(store.shouldDeliver("signal-2")).resolves.toBe(false);
  });

  it("exposes heartbeat status without leaking delivery identifiers", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-"));
    directories.push(directory);
    const store = new MonitorStateStore({ filePath: path.join(directory, "state.json") });
    await store.heartbeat("connected", 2, null, {
      providerRequests: 7,
      datasetCacheHits: 11,
      trackedTargets: 5,
      lastProviderSyncAt: "2026-09-01T03:00:00.000Z",
      lastStrategyRefreshAt: "2026-09-01T02:59:00.000Z",
    });

    await expect(store.publicStatus()).resolves.toMatchObject({
      status: "connected",
      enabledStrategies: 2,
      deliveredSignals: 0,
      providerRequests: 7,
      datasetCacheHits: 11,
      trackedTargets: 5,
      lastProviderSyncAt: "2026-09-01T03:00:00.000Z",
      lastStrategyRefreshAt: "2026-09-01T02:59:00.000Z",
    });
  });

  it("persists a successful delivery and paper leg in one state mutation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-"));
    directories.push(directory);
    const store = new MonitorStateStore({ filePath: path.join(directory, "state.json") });

    await store.recordTransition("strategy:target:SELL:bar", {
      positionKey: "strategy:target",
      strategyId: "11111111-1111-4111-8111-111111111111",
      instrumentId: "NYSE:SPY",
      hedgeInstrumentId: "AMEX:SH",
      heldInstrument: heldHedge,
      leg: "LONG_HEDGE",
      signalAt: "2026-09-13T14:00:00.000Z",
    });

    await expect(store.shouldDeliver("strategy:target:SELL:bar")).resolves.toBe(false);
    await expect(store.position("strategy:target")).resolves.toMatchObject({
      leg: "LONG_HEDGE",
      instrumentId: "NYSE:SPY",
      hedgeInstrumentId: "AMEX:SH",
      heldInstrument: heldHedge,
    });
    await expect(store.publicStatus()).resolves.toMatchObject({
      deliveredSignals: 1,
      positions: [expect.objectContaining({ instrumentId: "NYSE:SPY", leg: "LONG_HEDGE" })],
    });
  });

  it("rejects a held instrument that contradicts the paper leg", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-"));
    directories.push(directory);
    const store = new MonitorStateStore({ filePath: path.join(directory, "state.json") });

    await expect(
      store.recordTransition("strategy:target:BUY:bar", {
        positionKey: "strategy:target",
        strategyId: "11111111-1111-4111-8111-111111111111",
        instrumentId: "NYSE:SPY",
        hedgeInstrumentId: "AMEX:SH",
        heldInstrument: heldHedge,
        leg: "LONG_PRIMARY",
        signalAt: "2026-09-13T14:00:00.000Z",
      }),
    ).rejects.toThrow(/paper leg/);
  });
});
