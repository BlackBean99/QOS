import { describe, expect, it, vi } from "vitest";

import {
  RecommendationCache,
  rankRecommendationCandidates,
  type RecommendationCandidate,
} from "@/src/server/strategy-recommendations";

function candidate(
  presetId: string,
  totalReturnPercent: number,
  maximumDrawdownPercent: number,
  sharpeRatio: number,
  numberOfTrades = 3,
): RecommendationCandidate {
  return {
    presetId,
    presetName: presetId,
    category: "TREND",
    strategy: {} as RecommendationCandidate["strategy"],
    metrics: {
      totalReturnPercent,
      maximumDrawdownPercent,
      sharpeRatio,
      numberOfTrades,
    },
  };
}

describe("strategy recommendations", () => {
  it("ranks traded candidates by return, drawdown, Sharpe and stable id", () => {
    const ranked = rankRecommendationCandidates([
      candidate("no-trade", 99, 0, 99, 0),
      candidate("b", 12, 5, 1.1),
      candidate("a", 12, 4, 0.8),
      candidate("c", 11, 1, 3),
    ]);

    expect(ranked.map((item) => item.presetId)).toEqual(["a", "b", "c"]);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("coalesces concurrent work and reuses a bounded TTL result", async () => {
    let now = 1_000;
    const cache = new RecommendationCache<string>({ maximumEntries: 2, now: () => now });
    const create = vi.fn(async () => "result");

    const [first, second] = await Promise.all([
      cache.getOrCreate("same", 500, create),
      cache.getOrCreate("same", 500, create),
    ]);
    expect(first).toEqual({ value: "result", cache: "MISS" });
    expect(second).toEqual({ value: "result", cache: "COALESCED" });
    expect(create).toHaveBeenCalledTimes(1);

    expect(await cache.getOrCreate("same", 500, create)).toEqual({
      value: "result",
      cache: "HIT",
    });
    now = 1_501;
    await cache.getOrCreate("same", 500, create);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
