import { describe, expect, it } from "vitest";

import {
  applyBreakEven,
  applyScaleOut,
  calculateInitialStop,
  calculatePositionQuantity,
  createPositionState,
  updateTrailingStops,
} from "@/src/domain/backtest-v3/position";
import type { ExitRule, PositionSizing } from "@/src/domain/strategy-v3/schema";

describe("Strategy v3 position and risk engine", () => {
  it("calculates fixed and ATR initial risk stops for long and short", () => {
    const fixed: ExitRule = {
      kind: "FIXED_STOP",
      id: "fixed",
      priority: 10,
      unit: "PERCENT",
      value: 5,
      quantityPercent: 100,
    };
    const atr: ExitRule = {
      kind: "ATR_STOP",
      id: "atr",
      priority: 5,
      period: 14,
      multiplier: 2,
      quantityPercent: 100,
    };
    expect(calculateInitialStop("LONG", 100, [fixed], () => 3, 1)).toBe(95);
    expect(calculateInitialStop("SHORT", 100, [atr], () => 3, 1)).toBe(106);
  });

  it.each([
    [{ kind: "FIXED_NOTIONAL", value: 1_000 } satisfies PositionSizing, 10],
    [{ kind: "EQUITY_PERCENT", value: 25 } satisfies PositionSizing, 25],
    [{ kind: "RISK_AMOUNT", value: 100 } satisfies PositionSizing, 20],
    [{ kind: "RISK_PERCENT", value: 1 } satisfies PositionSizing, 20],
  ])("sizes a position with allocation caps", (sizing, expected) => {
    expect(
      calculatePositionQuantity({
        sizing,
        equity: 10_000,
        entryPrice: 100,
        initialStop: 95,
        maximumAllocationPercent: 100,
      }),
    ).toBe(expected);
  });

  it("never lowers a long trailing stop and never raises a short trailing stop", () => {
    const trailing: ExitRule[] = [
      {
        kind: "ATR_TRAILING",
        id: "atr-trail",
        priority: 40,
        period: 14,
        multiplier: 2,
        quantityPercent: 100,
      },
      {
        kind: "CHANDELIER",
        id: "chandelier",
        priority: 41,
        period: 22,
        atrPeriod: 14,
        multiplier: 3,
        quantityPercent: 100,
      },
      {
        kind: "PERCENTAGE_TRAILING",
        id: "percent",
        priority: 42,
        percent: 5,
        quantityPercent: 100,
      },
    ];
    const long = createPositionState({
      side: "LONG",
      entryPrice: 100,
      quantity: 10,
      initialStop: 90,
      entryAt: "2026-01-01",
      entryIndex: 0,
    });
    updateTrailingStops(long, trailing, { high: 110, low: 104, close: 108 }, () => 2);
    const firstLong = { ...long.trailingStops };
    updateTrailingStops(long, trailing, { high: 109, low: 90, close: 92 }, () => 10);
    for (const [id, value] of Object.entries(firstLong))
      expect(long.trailingStops[id]).toBeGreaterThanOrEqual(value);

    const short = createPositionState({
      side: "SHORT",
      entryPrice: 100,
      quantity: 10,
      initialStop: 110,
      entryAt: "2026-01-01",
      entryIndex: 0,
    });
    updateTrailingStops(short, trailing, { high: 96, low: 90, close: 92 }, () => 2);
    const firstShort = { ...short.trailingStops };
    updateTrailingStops(short, trailing, { high: 115, low: 91, close: 110 }, () => 10);
    for (const [id, value] of Object.entries(firstShort))
      expect(short.trailingStops[id]).toBeLessThanOrEqual(value);
  });

  it("moves a stop to break-even with an R offset only after trigger", () => {
    const state = createPositionState({
      side: "LONG",
      entryPrice: 100,
      quantity: 10,
      initialStop: 95,
      entryAt: "2026-01-01",
      entryIndex: 0,
    });
    const rule: ExitRule = {
      kind: "BREAK_EVEN",
      id: "be",
      priority: 20,
      triggerR: 1,
      offsetR: 0.1,
    };
    expect(applyBreakEven(state, rule, 104.9)).toBe(false);
    expect(applyBreakEven(state, rule, 105)).toBe(true);
    expect(state.protectiveStop).toBe(100.5);
  });

  it("applies scale-out percentages to initial quantity and never exceeds remaining", () => {
    const state = createPositionState({
      side: "LONG",
      entryPrice: 100,
      quantity: 10,
      initialStop: 95,
      entryAt: "2026-01-01",
      entryIndex: 0,
    });
    expect(applyScaleOut(state, "one-r", 30)).toBe(3);
    expect(applyScaleOut(state, "two-r", 30)).toBe(3);
    expect(applyScaleOut(state, "one-r", 30)).toBe(0);
    expect(applyScaleOut(state, "rest", 100)).toBe(4);
    expect(state.remainingQuantity).toBe(0);
  });
});
