import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as compile } from "@/app/api/research/strategies/compile/route";
import { POST as backtest } from "@/app/api/research/backtests/route";
import { createReferenceResearchStrategy } from "@/src/domain/advanced-strategy";
import { retryDelayMilliseconds } from "@/src/domain/llm-strategy";

const referencePrompt =
  "NVDA를 5분봉에서 15일 VWAP 상향 돌파 시 매수하고 ATR trailing, Chandelier, 일목 기준선, EMA 9/21, VWAP 3봉 확인, 고점 대비 2%를 비교해줘";

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("research strategy compiler route", () => {
  it("enforces the 4,000-character prompt boundary", async () => {
    const prefix = "5분 VWAP ATR 일목 ";
    const accepted = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({
          prompt: prefix + "x".repeat(4_000 - prefix.length),
          instrumentId: "NASDAQ:NVDA",
        }),
      }),
    );
    expect(accepted.status).toBe(200);
    const rejected = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: "x".repeat(4_001), instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    expect(rejected.status).toBe(422);
  });

  it("uses the cost-free local reference template without any provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: referencePrompt, instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.compiler).toBe("reference-template");
    expect(body.strategy.version).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not pretend arbitrary text was LLM-compiled without a key", async () => {
    const response = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: "내가 생각한 복잡한 전략", instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "LLM_NOT_CONFIGURED" }) }),
    );
  });

  it("validates a mocked OpenAI structured response before returning it", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    const strategy = createReferenceResearchStrategy("NASDAQ:NVDA");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        output: [
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(strategy) }] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: referencePrompt, instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).compiler).toBe("openai");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.store).toBe(false);
    expect(requestBody.text.format.strict).toBe(true);
  });

  it("honors bounded Retry-After backoff and retries one rate limit", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    const strategy = createReferenceResearchStrategy("NASDAQ:NVDA");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          output: [
            { type: "message", content: [{ type: "output_text", text: JSON.stringify(strategy) }] },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: referencePrompt, instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryDelayMilliseconds(new Response(null, { headers: { "retry-after": "8" } }), 0)).toBe(
      1_000,
    );
    expect(retryDelayMilliseconds(null, 0)).toBe(250);
  });

  it("aborts both timed-out attempts and returns a safe provider error", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const responsePromise = compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: referencePrompt, instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await responsePromise;
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("LLM_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when model output is outside Strategy v2", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          output: [
            { type: "message", content: [{ type: "output_text", text: '{"code":"buy()"}' }] },
          ],
        }),
      ),
    );
    const response = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: referencePrompt, instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("INVALID_MODEL_OUTPUT");
  });

  it("fails closed when the model changes the selected instrument", async () => {
    process.env.OPENAI_API_KEY = "test-only";
    const strategy = createReferenceResearchStrategy("KOSPI:005930");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          output: [
            { type: "message", content: [{ type: "output_text", text: JSON.stringify(strategy) }] },
          ],
        }),
      ),
    );
    const response = await compile(
      new Request("http://localhost/api/research/strategies/compile", {
        method: "POST",
        body: JSON.stringify({ prompt: referencePrompt, instrumentId: "NASDAQ:NVDA" }),
      }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("INVALID_MODEL_OUTPUT");
  });
});

describe("research backtest route", () => {
  it("runs only a strict Strategy v2 request", async () => {
    const response = await backtest(
      new Request("http://localhost/api/research/backtests", {
        method: "POST",
        body: JSON.stringify({ strategy: createReferenceResearchStrategy("NASDAQ:NVDA") }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.text();
    expect(new TextEncoder().encode(payload).byteLength).toBeLessThan(800_000);
    expect(JSON.parse(payload).runs).toHaveLength(8);
  });

  it("rejects model-added code fields", async () => {
    const response = await backtest(
      new Request("http://localhost/api/research/backtests", {
        method: "POST",
        body: JSON.stringify({
          strategy: { ...createReferenceResearchStrategy("NASDAQ:NVDA"), code: "eval(prompt)" },
        }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it("keeps the valid 12-run/two-line EMA response below the payload budget", async () => {
    const strategy = createReferenceResearchStrategy("NASDAQ:NVDA");
    const response = await backtest(
      new Request("http://localhost/api/research/backtests", {
        method: "POST",
        body: JSON.stringify({
          strategy: {
            ...strategy,
            exits: Array.from({ length: 12 }, (_, index) => ({
              kind: "ema_cross_below",
              fastPeriod: index + 2,
              slowPeriod: index + 60,
            })),
            overlays: ["EMA"],
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.text();
    expect(new TextEncoder().encode(payload).byteLength).toBeLessThan(800_000);
    expect(JSON.parse(payload).runs).toHaveLength(12);
  });
});
