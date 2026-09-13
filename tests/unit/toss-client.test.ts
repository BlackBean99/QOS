import { describe, expect, it, vi } from "vitest";

import { TossClient } from "@/src/server/toss/client";

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

describe("TossClient", () => {
  it("uses one cached client-credentials token for subsequent requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "server-only-token", token_type: "Bearer", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        response({
          result: [
            {
              symbol: "005930",
              name: "삼성전자",
              securityType: "STOCK",
              isCommonShare: true,
              isinCode: "KR7005930003",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ result: [] }));
    const client = new TossClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchMock,
      sleep: async () => undefined,
    });

    await client.listStocks("KOSPI");
    await client.listStocks("KOSDAQ");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openapi.tossinvest.com/oauth2/token");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      "grant_type=client_credentials&client_id=client-id&client_secret=client-secret",
    );
    const authorization = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization");
    expect(authorization).toBe("Bearer server-only-token");
    const catalogUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(catalogUrl.searchParams.get("market")).toBe("KOSPI");
    expect(catalogUrl.searchParams.get("status")).toBe("ACTIVE");
    expect(catalogUrl.searchParams.has("securityType")).toBe(false);
    expect(catalogUrl.searchParams.has("commonShare")).toBe(false);
  });

  it("validates and orders provider candles oldest first", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", token_type: "Bearer", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        response({
          result: {
            candles: [
              {
                timestamp: "2026-03-25T09:01:00+09:00",
                openPrice: "72000",
                highPrice: "72100",
                lowPrice: "71900",
                closePrice: "72050",
                volume: "150",
                currency: "KRW",
              },
              {
                timestamp: "2026-03-25T09:00:00+09:00",
                openPrice: "71900",
                highPrice: "72000",
                lowPrice: "71800",
                closePrice: "72000",
                volume: "100",
                currency: "KRW",
              },
            ],
            nextBefore: "2026-03-25T09:00:00+09:00",
          },
        }),
      );
    const client = new TossClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: fetchMock,
      sleep: async () => undefined,
    });

    const page = await client.getCandles({ symbol: "005930", interval: "1m", count: 2 });

    expect(page.candles.map((candle) => candle.timestamp)).toEqual([
      "2026-03-25T09:00:00+09:00",
      "2026-03-25T09:01:00+09:00",
    ]);
    expect(page.candles[0]).toMatchObject({ open: 71900, close: 72000, volume: 100 });
  });

  it("does not internally retry quota-sensitive stock master calls", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", token_type: "Bearer", expires_in: 3600 }),
      )
      .mockResolvedValue(
        response({ error: { code: "rate-limit-exceeded", message: "slow down" } }, 429, {
          "retry-after": "20",
        }),
      );
    const client = new TossClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: fetchMock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    await expect(client.listStocks("NASDAQ")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(sleeps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses exponential fallback when Retry-After is missing on ordinary requests", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", token_type: "Bearer", expires_in: 3600 }),
      )
      .mockResolvedValue(response({ error: "busy" }, 503));
    const client = new TossClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: fetchMock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    await expect(client.getCandles({ symbol: "AAPL", interval: "1m" })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(sleeps).toEqual([250, 500]);
  });

  it("fails closed on malformed decimal candle data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ access_token: "token", token_type: "Bearer", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        response({
          result: {
            candles: [
              {
                timestamp: "2026-03-25T09:00:00+09:00",
                openPrice: "not-a-number",
                highPrice: "1",
                lowPrice: "1",
                closePrice: "1",
                volume: "1",
                currency: "KRW",
              },
            ],
            nextBefore: null,
          },
        }),
      );
    const client = new TossClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: fetchMock,
      sleep: async () => undefined,
    });

    await expect(
      client.getCandles({ symbol: "005930", interval: "1m", count: 1 }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
