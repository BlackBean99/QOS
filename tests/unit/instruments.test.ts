import { describe, expect, it } from "vitest";

import {
  InstrumentIdSchema,
  getInstrumentDefinition,
  instrumentMatchesMarket,
  searchInstruments,
} from "@/src/domain/instruments";

describe("instrument catalog", () => {
  it("finds an instrument by ticker without case sensitivity", () => {
    expect(searchInstruments("nvda")).toEqual([
      expect.objectContaining({
        instrumentId: "NASDAQ:NVDA",
        market: "NASDAQ",
        symbol: "NVDA",
        displayName: "NVIDIA",
      }),
    ]);
  });

  it("finds a Korean instrument by a partial display name", () => {
    expect(searchInstruments("하이닉스")).toEqual([
      expect.objectContaining({
        instrumentId: "KOSPI:000660",
        market: "KOSPI",
        symbol: "000660",
      }),
    ]);
  });

  it("lists only the requested market when the query is empty", () => {
    const results = searchInstruments("", "KOSPI");

    expect(results).toHaveLength(2);
    expect(results.every((instrument) => instrument.market === "KOSPI")).toBe(true);
  });

  it("returns an empty result instead of falling back to another instrument", () => {
    expect(searchInstruments("없는종목")).toEqual([]);
  });

  it("accepts provider-backed instrument ids and rejects malformed ids", () => {
    expect(InstrumentIdSchema.safeParse("NYSE:BRK.B").success).toBe(true);
    expect(InstrumentIdSchema.safeParse("KOSDAQ:247540").success).toBe(true);
    expect(InstrumentIdSchema.safeParse("NASDAQ:unknown").success).toBe(false);
    expect(InstrumentIdSchema.safeParse("NASDAQ:AAPL:EXTRA").success).toBe(false);
    expect(instrumentMatchesMarket("NYSE:BRK.B", "NYSE")).toBe(true);
    expect(instrumentMatchesMarket("NYSE:BRK.B", "NASDAQ")).toBe(false);
  });

  it("keeps bundled definitions only as deterministic test fixtures", () => {
    expect(getInstrumentDefinition("NASDAQ:AAPL")).toMatchObject({
      market: "NASDAQ",
      symbol: "AAPL",
      synthetic: true,
    });
  });
});
