import { describe, expect, it } from "vitest";

import { planPaperTransition } from "@/src/monitor/paper-position";

const primary = {
  instrumentId: "NYSE:SPY" as const,
  market: "NYSE" as const,
  symbol: "SPY",
  displayName: "SPDR S&P 500 ETF",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "FOREIGN_ETF",
};
const hedge = {
  instrumentId: "AMEX:SH" as const,
  market: "AMEX" as const,
  symbol: "SH",
  displayName: "ProShares Short S&P500",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "FOREIGN_ETF",
};
const replacementHedge = {
  instrumentId: "NASDAQ:PSQ" as const,
  market: "NASDAQ" as const,
  symbol: "PSQ",
  displayName: "ProShares Short QQQ",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "FOREIGN_ETF",
};

describe("paper position transition", () => {
  it("moves primary SELL to inverse BUY and returns on the next primary BUY", () => {
    const toHedge = planPaperTransition("LONG_PRIMARY", "SELL", primary, hedge);
    expect(toHedge).toEqual({
      nextLeg: "LONG_HEDGE",
      actions: [
        { side: "SELL", instrument: primary },
        { side: "BUY", instrument: hedge },
      ],
    });

    const toPrimary = planPaperTransition(toHedge.nextLeg, "BUY", primary, hedge);
    expect(toPrimary).toEqual({
      nextLeg: "LONG_PRIMARY",
      actions: [
        { side: "SELL", instrument: hedge },
        { side: "BUY", instrument: primary },
      ],
    });
  });

  it("suppresses repeated same-leg signals and handles a legacy target without a hedge", () => {
    expect(planPaperTransition("LONG_PRIMARY", "BUY", primary, hedge).actions).toEqual([]);
    expect(planPaperTransition("LONG_HEDGE", "SELL", primary, hedge).actions).toEqual([]);
    expect(planPaperTransition("WAITING", "SELL", primary)).toEqual({
      nextLeg: "WAITING",
      actions: [{ side: "SELL", instrument: primary }],
    });
  });

  it("closes the actually held inverse before switching hedge configuration", () => {
    expect(planPaperTransition("LONG_HEDGE", "SELL", primary, replacementHedge, hedge)).toEqual({
      nextLeg: "LONG_HEDGE",
      actions: [
        { side: "SELL", instrument: hedge },
        { side: "BUY", instrument: replacementHedge },
      ],
    });
    expect(planPaperTransition("LONG_HEDGE", "BUY", primary, replacementHedge, hedge)).toEqual({
      nextLeg: "LONG_PRIMARY",
      actions: [
        { side: "SELL", instrument: hedge },
        { side: "BUY", instrument: primary },
      ],
    });
  });
});
