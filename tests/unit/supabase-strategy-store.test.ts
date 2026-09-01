import { describe, expect, it, vi } from "vitest";

import { NewStoredStrategySchema, type StoredStrategy } from "@/src/domain/stored-strategy";
import { SupabaseStrategyStore } from "@/src/server/supabase-strategy-store";

function newStrategy() {
  return NewStoredStrategySchema.parse({
    name: "AAPL 돌파",
    description: "Supabase persistence",
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
}

function stored(revision = 1): StoredStrategy {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    revision,
    ...newStrategy(),
    name: revision === 1 ? "AAPL 돌파" : "AAPL 돌파 v2",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: `2026-08-25T00:00:0${revision - 1}.000Z`,
  };
}

function row(document: StoredStrategy) {
  const { id, revision, createdAt, updatedAt, ...body } = document;
  return {
    id,
    revision,
    name: document.name,
    description: document.description,
    instrument_id: document.instrument.instrumentId,
    market: document.instrument.market,
    timeframe: document.strategy.timeframe,
    document: body,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

describe("SupabaseStrategyStore", () => {
  it("maps strict rows and sends the secret only in server request headers", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      Response.json([row(stored())]),
      Response.json([row(stored())], { status: 201 }),
      Response.json([row(stored(2))]),
      Response.json([{ id: stored().id }]),
    ];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return responses.shift() ?? Response.json([]);
    });
    const store = new SupabaseStrategyStore({
      url: "https://example.supabase.co",
      key: "server-secret-test-only",
      fetch: fetcher,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: () => stored().id,
    });

    await expect(store.list()).resolves.toEqual([stored()]);
    await expect(store.create(newStrategy())).resolves.toEqual(stored());
    await expect(
      store.update(stored().id, {
        expectedRevision: 1,
        ...newStrategy(),
        name: "AAPL 돌파 v2",
      }),
    ).resolves.toEqual(stored(2));
    await expect(store.delete(stored().id, 2)).resolves.toBe(true);

    expect(requests[0]?.url).toContain("qos_strategies");
    expect(requests[2]?.url).toContain("revision=eq.1");
    expect(requests[3]?.url).toContain("revision=eq.2");
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("apikey")).toBe("server-secret-test-only");
    expect(headers.get("authorization")).toBe("Bearer server-secret-test-only");
    expect(JSON.stringify(await store.exportAll())).not.toContain("server-secret-test-only");
  });

  it("uses a new secret key only as apikey, never as a bearer JWT", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([row(stored())]));
    const store = new SupabaseStrategyStore({
      url: "https://example.supabase.co",
      key: "sb_secret_test-only",
      fetch: fetcher,
    });

    await store.list();
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test-only");
    expect(headers.has("authorization")).toBe(false);
  });

  it("reports an unapplied migration without leaking provider details or keys", async () => {
    const store = new SupabaseStrategyStore({
      url: "https://example.supabase.co",
      key: "server-secret-test-only",
      fetch: async () =>
        Response.json(
          { code: "PGRST205", message: "Could not find public.qos_strategies" },
          { status: 404 },
        ),
    });

    await expect(store.list()).rejects.toMatchObject({ code: "schema_missing" });
    await expect(store.list()).rejects.not.toThrow(
      /server-secret-test-only|public\.qos_strategies/,
    );
  });

  it("rejects malformed Data API rows instead of trusting remote JSON", async () => {
    const store = new SupabaseStrategyStore({
      url: "https://example.supabase.co",
      key: "server-secret-test-only",
      fetch: async () => Response.json([{ id: "not-a-uuid" }]),
    });

    await expect(store.list()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("backs off before retrying a transient read without Retry-After", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({}, { status: 503 }))
        .mockResolvedValueOnce(Response.json([row(stored())]));
      const store = new SupabaseStrategyStore({
        url: "https://example.supabase.co",
        key: "server-secret-test-only",
        fetch: fetcher,
      });

      const pending = store.list();
      await vi.advanceTimersByTimeAsync(149);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual([stored()]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a stable 500-row export cap and rejects overflow instead of truncating", async () => {
    const atLimit = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(Array.from({ length: 500 }, () => row(stored()))))
      .mockResolvedValueOnce(Response.json([]));
    const withinLimit = new SupabaseStrategyStore({
      url: "https://example.supabase.co",
      key: "server-secret-test-only",
      fetch: atLimit,
    });
    await expect(withinLimit.list()).resolves.toHaveLength(500);
    expect(String(atLimit.mock.calls[0]?.[0])).toContain("updated_at.desc%2Cid.asc");

    const overLimit = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(Array.from({ length: 500 }, () => row(stored()))))
      .mockResolvedValueOnce(Response.json([row(stored())]));
    const overflow = new SupabaseStrategyStore({
      url: "https://example.supabase.co",
      key: "server-secret-test-only",
      fetch: overLimit,
    });
    await expect(overflow.exportAll()).rejects.toMatchObject({ code: "store_too_large" });
    expect(String(overLimit.mock.calls[1]?.[0])).toContain("offset=500");
  });
});
