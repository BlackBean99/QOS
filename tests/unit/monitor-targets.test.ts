import { describe, expect, it } from "vitest";

import { StoredStrategySchema } from "@/src/domain/stored-strategy";
import { createPresetStrategyV3 } from "@/src/domain/strategy-v3/catalog";
import { createReferenceResearchStrategy } from "@/src/domain/advanced-strategy";
import {
  expandMonitorTargets,
  monitorDeliveryKey,
  monitorEvaluationKey,
  monitorPositionKey,
} from "@/src/monitor/targets";

const apple = {
  instrumentId: "NASDAQ:AAPL" as const,
  market: "NASDAQ" as const,
  symbol: "AAPL",
  displayName: "Apple",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "STOCK",
  isinCode: "US0378331005",
};

const spy = {
  instrumentId: "NYSE:SPY" as const,
  market: "NYSE" as const,
  symbol: "SPY",
  displayName: "SPDR S&P 500 ETF",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "FOREIGN_ETF",
  isinCode: "US78462F1030",
};

const sh = {
  instrumentId: "AMEX:SH" as const,
  market: "AMEX" as const,
  symbol: "SH",
  displayName: "ProShares Short S&P500",
  currency: "USD" as const,
  timezone: "America/New_York" as const,
  synthetic: false,
  securityType: "FOREIGN_ETF",
};

function stored(monitor: {
  enabled: boolean;
  interval: "1d";
  targets?: Array<typeof apple | typeof spy>;
  targetControls?: Array<{
    instrumentId: string;
    enabled: boolean;
    hedgeInstrument?: typeof apple | typeof sh;
  }>;
}) {
  return StoredStrategySchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    revision: 2,
    name: "EMA strategy",
    description: "multi target",
    instrument: apple,
    strategy: createPresetStrategyV3("ema-crossover", apple.instrumentId, { timeframe: "1d" }),
    chart: {
      version: 1,
      period: "1d",
      theme: "upbit-light",
      mainIndicators: ["EMA"],
      subIndicators: ["VOL"],
      drawings: [],
      visibleRange: null,
    },
    monitor,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

describe("monitor targets", () => {
  it("keeps legacy documents on their primary instrument", () => {
    const [runtime] = expandMonitorTargets(stored({ enabled: true, interval: "1d" }));

    expect(runtime?.instrument.instrumentId).toBe("NASDAQ:AAPL");
    expect(runtime?.strategy.instrumentId).toBe("NASDAQ:AAPL");
  });

  it("materializes one validated runtime document per configured target", () => {
    const document = stored({
      enabled: true,
      interval: "1d",
      targets: [apple, spy] as (typeof apple)[],
    });
    const runtimes = expandMonitorTargets(document);

    expect(runtimes.map((runtime) => runtime.instrument.instrumentId)).toEqual([
      "NASDAQ:AAPL",
      "NYSE:SPY",
    ]);
    expect(runtimes.map((runtime) => runtime.strategy.instrumentId)).toEqual([
      "NASDAQ:AAPL",
      "NYSE:SPY",
    ]);
    expect(new Set(runtimes.map(monitorEvaluationKey)).size).toBe(2);
    expect(
      new Set(
        runtimes.map((runtime) => monitorDeliveryKey(runtime, "BUY", "2026-09-01T20:00:00.000Z")),
      ).size,
    ).toBe(2);
  });

  it("keeps v1 and v2 strategies compatible with multi-target materialization", () => {
    const base = stored({
      enabled: true,
      interval: "1d",
      targets: [apple, spy],
    });
    const v1 = StoredStrategySchema.parse({
      ...base,
      strategy: {
        version: 1,
        name: "AAPL breakout",
        market: "NASDAQ",
        instrumentId: apple.instrumentId,
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
    });
    const v2 = StoredStrategySchema.parse({
      ...base,
      strategy: createReferenceResearchStrategy(apple.instrumentId, apple),
      chart: { ...base.chart, period: "5m" },
      monitor: { ...base.monitor, interval: "5m" },
    });

    expect(expandMonitorTargets(v1).map((item) => item.instrument.instrumentId)).toEqual([
      apple.instrumentId,
      spy.instrumentId,
    ]);
    expect(expandMonitorTargets(v2).map((item) => item.instrument.instrumentId)).toEqual([
      apple.instrumentId,
      spy.instrumentId,
    ]);
  });

  it("rejects duplicate target instruments", () => {
    expect(() =>
      stored({
        enabled: true,
        interval: "1d",
        targets: [apple, apple],
      }),
    ).toThrow(/중복/);
  });

  it("excludes only disabled targets and carries an explicit inverse instrument", () => {
    const document = stored({
      enabled: true,
      interval: "1d",
      targets: [apple, spy] as (typeof apple)[],
      targetControls: [
        { instrumentId: apple.instrumentId, enabled: false },
        { instrumentId: spy.instrumentId, enabled: true, hedgeInstrument: sh },
      ],
    });

    const [runtime] = expandMonitorTargets(document);
    expect(runtime?.instrument.instrumentId).toBe(spy.instrumentId);
    expect(runtime?.monitor.targetControls?.[0]).toMatchObject({
      instrumentId: spy.instrumentId,
      enabled: true,
      hedgeInstrument: sh,
    });
  });

  it("rejects controls for missing targets and self-hedges", () => {
    expect(() =>
      stored({
        enabled: true,
        interval: "1d",
        targets: [apple],
        targetControls: [{ instrumentId: spy.instrumentId, enabled: true }],
      }),
    ).toThrow(/감시 대상/);
    expect(() =>
      stored({
        enabled: true,
        interval: "1d",
        targets: [apple],
        targetControls: [
          { instrumentId: apple.instrumentId, enabled: true, hedgeInstrument: apple },
        ],
      }),
    ).toThrow(/헷지/);
  });

  it("only allows the implicit primary instrument when targets are omitted", () => {
    expect(() =>
      stored({
        enabled: true,
        interval: "1d",
        targetControls: [{ instrumentId: spy.instrumentId, enabled: true }],
      }),
    ).toThrow(/실제 감시 대상/);

    expect(
      stored({
        enabled: true,
        interval: "1d",
        targetControls: [{ instrumentId: apple.instrumentId, enabled: false }],
      }).monitor.targetControls,
    ).toEqual([{ instrumentId: apple.instrumentId, enabled: false }]);
  });

  it("keeps paper position identity stable across strategy revisions", () => {
    const revisionTwo = stored({ enabled: true, interval: "1d", targets: [apple] });
    const revisionThree = StoredStrategySchema.parse({
      ...revisionTwo,
      revision: 3,
      updatedAt: "2026-09-01T00:01:00.000Z",
    });

    expect(monitorEvaluationKey(revisionThree)).not.toBe(monitorEvaluationKey(revisionTwo));
    expect(monitorPositionKey(revisionThree)).toBe(monitorPositionKey(revisionTwo));
  });
});
