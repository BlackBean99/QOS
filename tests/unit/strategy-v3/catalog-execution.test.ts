import { describe, expect, it } from "vitest";

import { runBacktestV3 } from "@/src/domain/backtest-v3/engine";
import {
  ENTRY_PRESETS_V3,
  EXIT_PRESETS_V3,
  FILTER_PRESETS_V3,
  createPresetStrategyV3,
} from "@/src/domain/strategy-v3/catalog";
import type { Candle } from "@/src/fixtures/markets";

function executionFixture(): Candle[] {
  const start = Date.parse("2026-01-05T14:30:00.000Z");
  return Array.from({ length: 240 }, (_, index) => {
    const session = Math.floor(index / 15);
    const bar = index % 15;
    const close = 100 + session * 0.35 + Math.sin(index / 4) * 4 + (bar === 14 ? 1.5 : 0);
    return {
      date: new Date(start + session * 86_400_000 + bar * 300_000).toISOString(),
      open: close - Math.sin(index) * 0.5,
      high: close + 1.4,
      low: close - 1.3,
      close,
      volume: 1_000 + (index % 9) * 250,
    };
  });
}

describe("Strategy v3 full catalog execution", () => {
  it("executes all 42 entry, 8 filter and 20 exit preset documents through one engine", () => {
    const candles = executionFixture();
    const presets = [...ENTRY_PRESETS_V3, ...FILTER_PRESETS_V3, ...EXIT_PRESETS_V3];
    for (const preset of presets) {
      const result = runBacktestV3(createPresetStrategyV3(preset.id, "NASDAQ:NVDA"), candles, {
        marketTimeZone: "America/New_York",
        sessionOpen: "09:30",
        sessionClose: "16:00",
        source: "catalog-execution-fixture",
        adjustedPrices: true,
      });
      expect(result.strategy.version, preset.id).toBe(3);
      expect(Number.isFinite(result.metrics.endingEquity), preset.id).toBe(true);
      expect(result.equityCurve, preset.id).toHaveLength(candles.length);
    }
  }, 20_000);
});
