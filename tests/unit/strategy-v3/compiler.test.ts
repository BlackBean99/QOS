import { describe, expect, it } from "vitest";

import { compileStrategyV3Deterministically } from "@/src/domain/strategy-v3/compiler";

describe("Strategy v3 deterministic compiler", () => {
  it("compiles a 15-minute open/Session VWAP transition into paired entry and exit rules", () => {
    const compiled = compileStrategyV3Deterministically(
      "15분봉 시가가 세션 VWAP 위로 돌파하면 매수하고 아래로 이탈하면 매도",
      "NASDAQ:AAPL",
      { timeframe: "15m" },
    );
    const serialized = JSON.stringify(compiled.strategy);

    expect(serialized).toContain('"id":"session-vwap-open-cross"');
    expect(serialized).toContain('"id":"session-vwap-open-exit-cross"');
    expect(serialized).toContain('"field":"open"');
  });
});
