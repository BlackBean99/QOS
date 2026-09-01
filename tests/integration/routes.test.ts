import { describe, expect, it } from "vitest";

import { POST as runBacktest } from "@/app/api/backtests/route";
import { POST as parseStrategy } from "@/app/api/strategies/parse/route";

const validPrompt =
  "NASDAQ에서 20일 고점 돌파하고 거래량이 평균 2배 이상이면 매수, 5% trailing stop.";
const instrumentId = "NASDAQ:AAPL";

describe("strategy and backtest routes", () => {
  it("returns a structured strategy for a valid prompt", async () => {
    const response = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: validPrompt, instrumentId }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      strategy: { market: "NASDAQ", instrumentId, version: 1 },
    });
  });

  it("returns field-linked issues for an invalid prompt", async () => {
    const response = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: "아무거나 매수", instrumentId }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ field: "market" })]),
    });
  });

  it("runs a backtest only for a validated strategy", async () => {
    const parseResponse = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: validPrompt, instrumentId }),
      }),
    );
    const parsed = await parseResponse.json();
    const response = await runBacktest(
      new Request("http://localhost/api/backtests", {
        method: "POST",
        body: JSON.stringify({ strategy: parsed.strategy }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      market: { market: "NASDAQ", instrumentId, symbol: "AAPL", currency: "USD" },
      priceSeries: expect.arrayContaining([
        expect.objectContaining({ date: expect.any(String), close: expect.any(Number) }),
      ]),
      metrics: { closedTrades: expect.any(Number) },
    });
  });

  it("rejects an invalid strategy instead of coercing it", async () => {
    const response = await runBacktest(
      new Request("http://localhost/api/backtests", {
        method: "POST",
        body: JSON.stringify({ strategy: { market: "NASDAQ", code: "eval(userInput)" } }),
      }),
    );

    expect(response.status).toBe(422);
  });

  it("rejects unknown fields at every strategy contract level", async () => {
    const parseResponse = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: validPrompt, instrumentId }),
      }),
    );
    const parsed = await parseResponse.json();
    const response = await runBacktest(
      new Request("http://localhost/api/backtests", {
        method: "POST",
        body: JSON.stringify({
          strategy: {
            ...parsed.strategy,
            code: "eval(userInput)",
            entry: {
              ...parsed.strategy.entry,
              price: { ...parsed.strategy.entry.price, script: "process.exit()" },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(422);
  });

  it("rejects malformed and oversized strategy requests", async () => {
    const malformed = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", { method: "POST", body: "{" }),
    );
    const oversized = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: "N".repeat(2_001), instrumentId }),
      }),
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(422);
  });

  it("rejects a prompt when the selected instrument belongs to another market", async () => {
    const response = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: validPrompt, instrumentId: "KOSPI:005930" }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ field: "instrument" })]),
    });
  });

  it("requires a supported instrument at the parse boundary", async () => {
    const response = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: validPrompt }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      issues: [
        {
          field: "instrument",
          message: expect.stringContaining("TOSS"),
        },
      ],
    });
  });

  it("rejects a market and instrument mismatch at the backtest boundary", async () => {
    const parseResponse = await parseStrategy(
      new Request("http://localhost/api/strategies/parse", {
        method: "POST",
        body: JSON.stringify({ prompt: validPrompt, instrumentId }),
      }),
    );
    const parsed = await parseResponse.json();
    const response = await runBacktest(
      new Request("http://localhost/api/backtests", {
        method: "POST",
        body: JSON.stringify({
          strategy: { ...parsed.strategy, market: "KOSPI" },
        }),
      }),
    );

    expect(response.status).toBe(422);
  });
});
