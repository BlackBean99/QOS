import { describe, expect, it } from "vitest";

import {
  ENTRY_PRESETS_V3,
  EXIT_PRESETS_V3,
  FILTER_PRESETS_V3,
  createPresetStrategyV3,
  createVwapIchimokuStrategyV3,
  searchStrategyCatalogV3,
} from "@/src/domain/strategy-v3/catalog";
import { StrategyDefinitionV3Schema } from "@/src/domain/strategy-v3/schema";

describe("Strategy v3 preset catalog", () => {
  it("registers every required entry, exit and filter preset with unique stable ids", () => {
    expect(ENTRY_PRESETS_V3).toHaveLength(43);
    expect(EXIT_PRESETS_V3).toHaveLength(21);
    expect(FILTER_PRESETS_V3).toHaveLength(8);

    const all = [...ENTRY_PRESETS_V3, ...EXIT_PRESETS_V3, ...FILTER_PRESETS_V3];
    expect(new Set(all.map((preset) => preset.id)).size).toBe(all.length);
    expect(
      all.every((preset) => preset.parameters.length > 0 || preset.id === "opposite-signal-exit"),
    ).toBe(true);
    expect(all.every((preset) => preset.supportedSides.length > 0)).toBe(true);
  });

  it("materializes every preset into an executable strict Strategy v3 document", () => {
    for (const preset of ENTRY_PRESETS_V3) {
      expect(
        StrategyDefinitionV3Schema.safeParse(createPresetStrategyV3(preset.id, "NASDAQ:AAPL"))
          .success,
        `entry preset ${preset.id}`,
      ).toBe(true);
    }
    for (const preset of EXIT_PRESETS_V3) {
      expect(
        StrategyDefinitionV3Schema.safeParse(createPresetStrategyV3(preset.id, "NASDAQ:AAPL"))
          .success,
        `exit preset ${preset.id}`,
      ).toBe(true);
    }
    for (const preset of FILTER_PRESETS_V3) {
      expect(
        StrategyDefinitionV3Schema.safeParse(createPresetStrategyV3(preset.id, "NASDAQ:AAPL"))
          .success,
        `filter preset ${preset.id}`,
      ).toBe(true);
    }
  });

  it("searches VWAP across entry, filter and exit roles without hiding variants", () => {
    const results = searchStrategyCatalogV3("VWAP");
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(new Set(results.map((preset) => preset.role))).toEqual(
      expect.objectContaining(new Set(["ENTRY", "EXIT"])),
    );
    expect(results.map((preset) => preset.id)).toEqual(
      expect.arrayContaining([
        "session-vwap-breakout",
        "rolling-vwap-breakout",
        "anchored-vwap-breakout",
        "vwap-deviation-band-reentry",
        "vwap-mean-reversion",
        "vwap-breakdown-exit",
      ]),
    );
  });

  it("exposes every requested non-MA entry family as a searchable editable preset", () => {
    const ids = ENTRY_PRESETS_V3.map((preset) => preset.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "roc-momentum-breakout",
        "donchian-channel-breakout",
        "obv-breakout",
        "cmf-money-flow",
        "previous-level-breakout",
        "support-resistance-breakout",
        "ichimoku-cloud-breakout",
        "vwap-deviation-band-reentry",
        "moving-average-deviation",
      ]),
    );
  });

  it("creates multi-timeframe and volatility presets as editable rule trees", () => {
    const multi = createPresetStrategyV3("multi-timeframe-trend-entry", "NASDAQ:AAPL");
    const squeeze = createPresetStrategyV3("bollinger-squeeze", "NASDAQ:AAPL");
    const serialized = JSON.stringify({ multi: multi.entry, squeeze: squeeze.entry });

    expect(serialized).toContain('"timeframe":"1d"');
    expect(serialized).toContain('"timeframe":"5m"');
    expect(serialized).toContain('"kind":"BB_WIDTH_PERCENTILE"');
    expect(serialized).not.toContain("presetId");
  });

  it("provides the requested VWAP breakout plus Ichimoku exit experiment", () => {
    const strategy = createVwapIchimokuStrategyV3("NASDAQ:NVDA");
    expect(strategy.name).toBe("VWAP Breakout + Ichimoku Exit");
    expect(strategy.exits.map((exit) => exit.id)).toEqual(["kijun-breakdown", "atr-trailing"]);
    expect(strategy.overlays).toHaveLength(2);
  });

  it("models the 15-minute session VWAP open cross as editable entry and exit rules", () => {
    const entry = createPresetStrategyV3("session-vwap-open-cross", "NASDAQ:AAPL", {
      timeframe: "15m",
    });
    const exit = createPresetStrategyV3("session-vwap-open-breakdown-exit", "NASDAQ:AAPL", {
      timeframe: "15m",
    });

    expect(JSON.stringify(entry.entry)).toContain('"field":"open"');
    expect(JSON.stringify(entry.entry)).toContain('"operator":"CROSS_ABOVE"');
    expect(JSON.stringify(entry.entry)).toContain('"kind":"SESSION"');
    expect(JSON.stringify(entry.exits)).toContain('"id":"session-vwap-open-exit-cross"');
    expect(JSON.stringify(exit.exits)).toContain('"field":"open"');
    expect(JSON.stringify(exit.exits)).toContain('"operator":"CROSS_BELOW"');
    expect(createPresetStrategyV3("session-vwap-open-cross", "NASDAQ:AAPL").timeframe).toBe("15m");
  });
});
