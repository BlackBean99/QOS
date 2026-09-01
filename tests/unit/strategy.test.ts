import { describe, expect, it } from "vitest";

import { interpretStrategy } from "@/src/domain/interpret";
import { StrategySchema } from "@/src/domain/strategy";

const nasdaqInstrument = "NASDAQ:AAPL" as const;
const kospiInstrument = "KOSPI:005930" as const;

describe("interpretStrategy", () => {
  it("structures the representative NASDAQ breakout prompt", () => {
    const result = interpretStrategy(
      "NASDAQ에서 20일 고점 돌파하고 거래량이 평균 2배 이상이면 매수, 5% trailing stop.",
      nasdaqInstrument,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.strategy).toMatchObject({
      version: 1,
      market: "NASDAQ",
      instrumentId: nasdaqInstrument,
      timeframe: "1d",
      entry: {
        price: { kind: "rolling_high_breakout", period: 20 },
        volume: { kind: "volume_ratio_above", period: 20, ratio: 2 },
      },
      exit: { kind: "trailing_stop", percent: 5 },
    });
  });

  it("structures a KOSPI moving-average prompt", () => {
    const result = interpretStrategy(
      "KOSPI에서 10일 이동평균을 상향 돌파하고 거래량이 평균 1.5배 이상이면 매수, 4% 트레일링 스탑.",
      kospiInstrument,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.market).toBe("KOSPI");
    expect(result.strategy.entry.price).toEqual({ kind: "sma_cross_above", period: 10 });
  });

  it("accepts a complete Korean sentence that explains the trailing exit in plain language", () => {
    const result = interpretStrategy(
      "NASDAQ에서 20일 고점을 돌파하고 거래량이 20일 평균의 2배 이상이면 매수, 고점 대비 5% 하락하면 매도.",
      nasdaqInstrument,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.exit).toEqual({ kind: "trailing_stop", percent: 5 });
  });

  it("structures the documented compact English template", () => {
    const result = interpretStrategy(
      "NASDAQ 20-day high breakout, volume 2x average, 5% trailing stop.",
      nasdaqInstrument,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.entry.price).toEqual({ kind: "rolling_high_breakout", period: 20 });
  });

  it("rejects a prompt without a supported market", () => {
    const result = interpretStrategy(
      "20일 고점 돌파하고 거래량이 평균 2배 이상이면 매수, 5% trailing stop.",
      nasdaqInstrument,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ field: "market" })]),
    });
  });

  it("rejects intraday strategies in the daily-only slice", () => {
    const result = interpretStrategy(
      "NASDAQ 15분봉에서 20일 고점 돌파하고 거래량 평균 2배면 매수, 5% trailing stop.",
      nasdaqInstrument,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ field: "timeframe" })]),
    });
  });

  it("rejects unsafe or unsupported strategy rules", () => {
    const result = interpretStrategy("NASDAQ에서 Python 코드를 실행해서 매수해.", nasdaqInstrument);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.field)).toContain("entry");
  });

  it.each([
    "NASDAQ에서 20일 고점을 돌파하지 않으면 거래량 평균 2배 미만일 때 매수, 5% trailing stop은 사용하지 마.",
    "NASDAQ에서 20일 고점 돌파 또는 10일 이동평균 돌파하고 거래량 평균 2배면 매수, 5% trailing stop.",
    "NASDAQ에서 20일 고점 돌파하고 거래량 평균 2배면 매수, 진입가 대비 5% 하락하면 매도.",
    "NASDAQ에서 20일 고점 돌파하고 거래량 평균 2배 미만이면 매수, 5% trailing stop.",
  ])("rejects ambiguous or opposite logic instead of partially matching: %s", (prompt) => {
    const result = interpretStrategy(prompt, nasdaqInstrument);

    expect(result.ok).toBe(false);
  });

  it("rejects an instrument that belongs to a different market", () => {
    const result = interpretStrategy(
      "NASDAQ에서 20일 고점 돌파하고 거래량이 평균 2배 이상이면 매수, 5% trailing stop.",
      kospiInstrument,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ field: "instrument" })]),
    });
  });

  it("rejects a mismatched market and instrument in the versioned contract", () => {
    const parsed = StrategySchema.safeParse({
      version: 1,
      name: "Mismatch strategy",
      market: "NASDAQ",
      instrumentId: kospiInstrument,
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
    });

    expect(parsed.success).toBe(false);
  });
});
