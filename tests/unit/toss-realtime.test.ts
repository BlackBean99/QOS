import { describe, expect, it } from "vitest";

import { createTradeSubscription, parseTradeFrame } from "@/src/server/toss/realtime";

describe("TOSS realtime contract", () => {
  it("groups domestic and US symbols into one full-replace declaration", () => {
    expect(
      createTradeSubscription(
        [
          { market: "KOSPI", symbol: "005930" },
          { market: "NASDAQ", symbol: "AAPL" },
          { market: "KOSDAQ", symbol: "247540" },
          { market: "NYSE", symbol: "BRK.B" },
          { market: "NASDAQ", symbol: "AAPL" },
        ],
        "request-1",
      ),
    ).toEqual([
      { id: "request-1" },
      { type: "trade:kr", codes: ["005930", "247540"] },
      { type: "trade:us", codes: ["AAPL", "BRK.B"] },
    ]);
  });

  it("validates decimal trade frames and ignores ack/pong frames", () => {
    expect(
      parseTradeFrame(
        JSON.stringify({
          type: "message",
          topic: "trade:us:AAPL",
          data: {
            price: "243.26",
            volume: "8",
            timestamp: "2026-06-18T23:30:00.000+09:00",
            currency: "USD",
          },
        }),
      ),
    ).toEqual({
      marketRegion: "us",
      symbol: "AAPL",
      price: 243.26,
      volume: 8,
      timestamp: "2026-06-18T23:30:00.000+09:00",
      currency: "USD",
    });
    expect(parseTradeFrame("PONG")).toBeNull();
    expect(parseTradeFrame(JSON.stringify({ type: "subscriptions", subscribed: [] }))).toBeNull();
    expect(parseTradeFrame("not json")).toBeNull();
  });
});
