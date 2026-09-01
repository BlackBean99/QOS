import { describe, expect, it, vi } from "vitest";

import { createGetCandles } from "@/app/api/market/candles/route";
import { createGetInstruments } from "@/app/api/instruments/route";
import type { TossClient } from "@/src/server/toss/client";
import type { TossInstrumentSearch } from "@/src/server/toss/instrument-search";

describe("TOSS market routes", () => {
  it("validates a non-empty search and returns provider instruments", async () => {
    const search = {
      search: vi.fn(async () => [
        {
          instrumentId: "NASDAQ:AAPL",
          market: "NASDAQ" as const,
          symbol: "AAPL",
          displayName: "애플",
          currency: "USD" as const,
          timezone: "America/New_York" as const,
          synthetic: false,
          aliases: [],
        },
      ]),
    } as unknown as TossInstrumentSearch;
    const get = createGetInstruments(search);

    const response = await get(
      new Request("http://localhost/api/instruments?query=aapl&region=US"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      instruments: [{ instrumentId: "NASDAQ:AAPL", synthetic: false }],
      source: "TOSS OpenAPI",
    });
    expect(search.search).toHaveBeenCalledWith("aapl", { region: "US", limit: 20 });
  });

  it("does not substitute synthetic instruments for an empty query", async () => {
    const search = { search: vi.fn() } as unknown as TossInstrumentSearch;
    const response = await createGetInstruments(search)(
      new Request("http://localhost/api/instruments?query="),
    );

    expect(response.status).toBe(400);
    expect(search.search).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("returns normalized candle metadata and no-store headers", async () => {
    const client = {
      getCandles: vi.fn(async () => ({
        candles: [
          {
            timestamp: "2026-03-25T09:00:00+09:00",
            open: 70000,
            high: 71000,
            low: 69000,
            close: 70500,
            volume: 1234,
            currency: "KRW",
          },
        ],
        nextBefore: null,
      })),
    } as unknown as TossClient;
    const get = createGetCandles(client);
    const response = await get(
      new Request(
        "http://localhost/api/market/candles?instrumentId=KOSPI%3A005930&interval=1d&count=100",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      instrumentId: "KOSPI:005930",
      market: "KOSPI",
      symbol: "005930",
      interval: "1d",
      adjusted: true,
      source: "TOSS OpenAPI",
    });
    expect(client.getCandles).toHaveBeenCalledWith({
      symbol: "005930",
      interval: "1d",
      count: 100,
      before: undefined,
      adjusted: true,
    });
  });

  it("maps provider failures without leaking provider response bodies", async () => {
    const client = {
      getCandles: vi.fn(async () => {
        const error = new Error("secret provider body") as Error & {
          code: string;
          status: number;
        };
        error.name = "TossProviderError";
        error.code = "forbidden";
        error.status = 403;
        throw error;
      }),
    } as unknown as TossClient;
    const response = await createGetCandles(client)(
      new Request("http://localhost/api/market/candles?instrumentId=NASDAQ%3AAAPL&interval=1m"),
    );
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(403);
    expect(payload).toContain("forbidden");
    expect(payload).not.toContain("secret provider body");
  });
});
