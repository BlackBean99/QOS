import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getCatalog } from "@/app/api/strategy-engine/catalog/route";
import { POST as compileStrategy } from "@/app/api/strategy-engine/compile/route";
import { createStrategyEngineBacktestHandler } from "@/app/api/strategy-engine/backtests/route";
import { createPresetStrategyV3 } from "@/src/domain/strategy-v3/catalog";
import type { Candle } from "@/src/fixtures/markets";

const instrument = {
  instrumentId: "NASDAQ:NVDA" as const,
  market: "NASDAQ" as const,
  symbol: "NVDA",
  displayName: "NVIDIA",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
};

const candles: Candle[] = Array.from({ length: 90 }, (_, index) => ({
  date: new Date(Date.parse("2026-01-05T14:30:00.000Z") + index * 300_000).toISOString(),
  open: 100 + index * 0.1,
  high: 100.8 + index * 0.1,
  low: 99.4 + index * 0.1,
  close: 100.2 + index * 0.1,
  volume: 1_000 + index * 10,
}));

const originalOpenAIKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
  vi.unstubAllGlobals();
});

describe("Strategy engine v3 routes", () => {
  it("returns the complete searchable catalog", async () => {
    const response = await getCatalog();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.counts).toEqual({ entry: 42, filter: 8, exit: 20, total: 70 });
    expect(
      body.presets.find((preset: { id: string }) => preset.id === "rolling-vwap-breakout"),
    ).toMatchObject({ role: "ENTRY", category: "VWAP" });
  });

  it("compiles natural language to validated DSL without generated code", async () => {
    const response = await compileStrategy(
      new Request("http://qos.local/api/strategy-engine/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentId: instrument.instrumentId,
          timeframe: "5m",
          prompt:
            "15일 VWAP 돌파, ADX 25 이상, 상대 거래량 1.5배. ATR 2배 손절, 2R 절반 매도 후 ATR trailing",
        }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.strategy.version).toBe(3);
    expect(body.strategy.entry.children[0].right.variant).toEqual({
      kind: "ROLLING_DAYS",
      days: 15,
    });
    expect(body.strategy.filters.children).toHaveLength(2);
    expect(body.strategy.exits.map((exit: { kind: string }) => exit.kind)).toEqual(
      expect.arrayContaining(["ATR_STOP", "RISK_REWARD", "SCALE_OUT", "ATR_TRAILING"]),
    );
    expect(JSON.stringify(body.strategy)).not.toContain("function");
  });

  it("combines multiple independent entries into one editable rule chain", async () => {
    const response = await compileStrategy(
      new Request("http://qos.local/api/strategy-engine/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentId: instrument.instrumentId,
          prompt:
            "EMA crossover 그리고 RSI oversold rebound 그리고 Bollinger breakout, ADX 25 이상 필터, ATR stop과 time stop",
        }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.strategy.entry.operator).toBe("AND");
    expect(body.strategy.entry.children).toHaveLength(3);
    expect(body.strategy.filters.children).toHaveLength(1);
    expect(body.strategy.exits.map((exit: { kind: string }) => exit.kind)).toEqual(
      expect.arrayContaining(["ATR_STOP", "TIME"]),
    );
  });

  it("uses optional OpenAI only as an allowlisted intent fallback", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  name: "CMF와 RSI 복합 전략",
                  entryPresetIds: ["cmf-money-flow", "rsi-momentum"],
                  entryOperator: "AND",
                  filterPresetIds: ["market-regime-filter"],
                  filterOperator: "AND",
                  exitPresetIds: ["atr-stop", "time-stop"],
                  timeframe: "15m",
                  side: "LONG",
                }),
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await compileStrategy(
      new Request("http://qos.local/api/strategy-engine/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentId: instrument.instrumentId,
          prompt: "유동성의 질과 가격 강도가 동시에 좋아질 때 들어가고 국면을 확인해 정리해줘",
        }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.compiler).toBe("openai");
    expect(body.strategy.version).toBe(3);
    expect(body.strategy.entry.children).toHaveLength(2);
    expect(JSON.stringify(body.strategy)).not.toMatch(/eval|function|code/);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.store).toBe(false);
    expect(requestBody.text.format.strict).toBe(true);
  });

  it("runs and compares validated strategies with an injected data boundary", async () => {
    const handler = createStrategyEngineBacktestHandler(async () => ({
      candles,
      runtime: {
        marketTimeZone: instrument.timezone,
        sessionOpen: "09:30",
        sessionClose: "16:00",
        source: "fixture",
        adjustedPrices: true,
      },
    }));
    const one = createPresetStrategyV3("ema-crossover", instrument.instrumentId);
    const two = createPresetStrategyV3("rsi-momentum", instrument.instrumentId);
    const response = await handler(
      new Request("http://qos.local/api/strategy-engine/backtests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategies: [one, two], instrument }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.kind).toBe("comparison");
    expect(body.comparison.runs).toHaveLength(2);
  });
});
