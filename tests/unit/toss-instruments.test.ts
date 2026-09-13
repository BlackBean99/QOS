import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TossInstrumentSearch } from "@/src/server/toss/instrument-search";
import { TossProviderError, type TossClient } from "@/src/server/toss/client";
import { InstrumentCatalogStore } from "@/src/server/toss/instrument-catalog-store";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function catalogStore(): Promise<InstrumentCatalogStore> {
  const directory = await mkdtemp(path.join(tmpdir(), "qos-instrument-catalog-"));
  directories.push(directory);
  return new InstrumentCatalogStore({ filePath: path.join(directory, "catalog.json") });
}

describe("TossInstrumentSearch", () => {
  it("searches actual provider rows by Korean name and ticker", async () => {
    const client = {
      listStocks: vi.fn(async (market: string) =>
        market === "KOSPI"
          ? [
              {
                symbol: "005930",
                name: "삼성전자",
                securityType: "STOCK" as const,
                isCommonShare: true,
                isinCode: "KR7005930003",
              },
            ]
          : market === "NASDAQ"
            ? [
                {
                  symbol: "AAPL",
                  name: "애플",
                  securityType: "STOCK" as const,
                  isCommonShare: true,
                  isinCode: "US0378331005",
                },
              ]
            : [],
      ),
    } as unknown as TossClient;
    const search = new TossInstrumentSearch(client, {
      catalogStore: await catalogStore(),
      minimumRefreshIntervalMs: 0,
    });

    await expect(search.search("삼성", { region: "KR" })).resolves.toEqual([
      expect.objectContaining({
        instrumentId: "KOSPI:005930",
        displayName: "삼성전자",
        currency: "KRW",
        timezone: "Asia/Seoul",
        synthetic: false,
      }),
    ]);
    await expect(search.search("aapl", { region: "US" })).resolves.toEqual([
      expect.objectContaining({
        instrumentId: "NASDAQ:AAPL",
        displayName: "애플",
        currency: "USD",
        timezone: "America/New_York",
      }),
    ]);
  });

  it("returns no synthetic fallback and reuses the daily market cache", async () => {
    const client = {
      listStocks: vi.fn(async () => []),
    } as unknown as TossClient;
    const search = new TossInstrumentSearch(client, {
      now: () => 1_000,
      catalogStore: await catalogStore(),
      minimumRefreshIntervalMs: 0,
    });

    expect(await search.search("없는종목", { markets: ["NASDAQ"] })).toEqual([]);
    expect(await search.search("여전히없음", { markets: ["NASDAQ"] })).toEqual([]);
    expect(client.listStocks).toHaveBeenCalledTimes(1);
  });

  it("serializes cold market refreshes at the provider quota boundary", async () => {
    let now = 10_000;
    const startedAt: number[] = [];
    const client = {
      listStocks: vi.fn(async () => {
        startedAt.push(now);
        return [];
      }),
    } as unknown as TossClient;
    const search = new TossInstrumentSearch(client, {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      catalogStore: await catalogStore(),
      minimumRefreshIntervalMs: 1_100,
    });

    await search.searchWithMetadata("없는종목", {
      markets: ["KOSPI", "KOSDAQ", "KR_ETC"],
    });

    expect(startedAt).toEqual([10_000, 11_100, 12_200]);
    expect(client.listStocks).toHaveBeenCalledTimes(3);
  });

  it("persists all provider security types and reuses them after a process restart", async () => {
    const store = await catalogStore();
    const rows = [
      {
        symbol: "069500",
        name: "KODEX 200",
        securityType: "ETF",
        isCommonShare: true,
        isinCode: "KR7069500007",
      },
      {
        symbol: "005935",
        name: "삼성전자우",
        securityType: "STOCK",
        isCommonShare: false,
        isinCode: "KR7005931001",
      },
    ];
    const provider = { listStocks: vi.fn(async () => rows) } as unknown as TossClient;
    const first = new TossInstrumentSearch(provider, {
      now: () => Date.parse("2026-09-01T00:00:00.000Z"),
      catalogStore: store,
      minimumRefreshIntervalMs: 0,
    });

    await expect(first.searchWithMetadata("KODEX", { markets: ["KOSPI"] })).resolves.toMatchObject({
      instruments: [{ instrumentId: "KOSPI:069500", securityType: "ETF" }],
      cache: { status: "REFRESHED", origin: "PROVIDER", markets: 1 },
    });

    const offlineProvider = {
      listStocks: vi.fn(async () => {
        throw new Error("network must not be used for a fresh disk cache");
      }),
    } as unknown as TossClient;
    const restarted = new TossInstrumentSearch(offlineProvider, {
      now: () => Date.parse("2026-09-01T01:00:00.000Z"),
      catalogStore: store,
      minimumRefreshIntervalMs: 0,
    });

    await expect(
      restarted.searchWithMetadata("삼성전자우", { markets: ["KOSPI"] }),
    ).resolves.toMatchObject({
      instruments: [{ instrumentId: "KOSPI:005935", securityType: "STOCK" }],
      cache: { status: "HIT", origin: "DISK", markets: 1 },
    });
    expect(offlineProvider.listStocks).not.toHaveBeenCalled();
  });

  it("serves a bounded stale catalog when the provider is rate limited", async () => {
    const store = await catalogStore();
    let now = Date.parse("2026-09-01T00:00:00.000Z");
    const client = {
      listStocks: vi
        .fn()
        .mockResolvedValueOnce([
          {
            symbol: "SPY",
            name: "SPDR S&P 500 ETF",
            securityType: "FOREIGN_ETF",
            isCommonShare: true,
            isinCode: "US78462F1030",
          },
        ])
        .mockRejectedValue(new TossProviderError("rate_limited", "provider rate limited", 429)),
    } as unknown as TossClient;
    const search = new TossInstrumentSearch(client, {
      now: () => now,
      catalogStore: store,
      minimumRefreshIntervalMs: 0,
    });
    await search.searchWithMetadata("SPY", { markets: ["NYSE"] });

    now += 25 * 60 * 60_000;
    await expect(search.searchWithMetadata("SPY", { markets: ["NYSE"] })).resolves.toMatchObject({
      instruments: [{ instrumentId: "NYSE:SPY", securityType: "FOREIGN_ETF" }],
      cache: { status: "STALE" },
    });

    now += 7 * 24 * 60 * 60_000;
    await expect(search.searchWithMetadata("SPY", { markets: ["NYSE"] })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("coalesces concurrent cold reads and exposes memory provenance afterward", async () => {
    const provider = {
      listStocks: vi.fn(async () => [
        {
          symbol: "QQQ",
          name: "Invesco QQQ ETF",
          securityType: "FOREIGN_ETF",
          isCommonShare: true,
          isinCode: "US46090E1038",
        },
      ]),
    } as unknown as TossClient;
    const search = new TossInstrumentSearch(provider, {
      catalogStore: await catalogStore(),
      minimumRefreshIntervalMs: 0,
    });

    const [first, second] = await Promise.all([
      search.searchWithMetadata("QQQ", { markets: ["NASDAQ"] }),
      search.searchWithMetadata("QQQ", { markets: ["NASDAQ"] }),
    ]);
    expect(provider.listStocks).toHaveBeenCalledTimes(1);
    expect(first.cache.origin).toBe("PROVIDER");
    expect(second.cache.origin).toBe("PROVIDER");
    await expect(search.searchWithMetadata("QQQ", { markets: ["NASDAQ"] })).resolves.toMatchObject({
      cache: { status: "HIT", origin: "MEMORY" },
    });
  });
});
