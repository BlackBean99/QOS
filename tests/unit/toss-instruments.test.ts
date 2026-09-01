import { describe, expect, it, vi } from "vitest";

import { TossInstrumentSearch } from "@/src/server/toss/instrument-search";
import type { TossClient } from "@/src/server/toss/client";

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
    const search = new TossInstrumentSearch(client);

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
    const search = new TossInstrumentSearch(client, { now: () => 1_000 });

    expect(await search.search("없는종목", { markets: ["NASDAQ"] })).toEqual([]);
    expect(await search.search("여전히없음", { markets: ["NASDAQ"] })).toEqual([]);
    expect(client.listStocks).toHaveBeenCalledTimes(1);
  });
});
