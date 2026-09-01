import type { ExitRule, PositionSizing } from "@/src/domain/strategy-v3/schema";

export interface PositionStateV3 {
  side: "LONG" | "SHORT";
  entryPrice: number;
  entryAt: string;
  entryIndex: number;
  initialQuantity: number;
  remainingQuantity: number;
  initialStop: number | null;
  initialRiskPerUnit: number | null;
  protectiveStop: number | null;
  highestPriceSinceEntry: number;
  lowestPriceSinceEntry: number;
  trailingStops: Record<string, number>;
  triggeredExitIds: Set<string>;
  realizedPnl: number;
  barsHeld: number;
}

export interface PositionSizingInput {
  sizing: PositionSizing;
  equity: number;
  entryPrice: number;
  initialStop: number | null;
  maximumAllocationPercent: number;
}

export function calculateInitialStop(
  side: "LONG" | "SHORT",
  entryPrice: number,
  exits: ExitRule[],
  atrAt: (period: number) => number | null,
  minimumTick: number,
): number | null {
  const rule = exits
    .filter(
      (exit): exit is Extract<ExitRule, { kind: "FIXED_STOP" | "ATR_STOP" }> =>
        exit.kind === "FIXED_STOP" || exit.kind === "ATR_STOP",
    )
    .toSorted((left, right) => left.priority - right.priority)[0];
  if (!rule) return null;
  let distance: number | null;
  if (rule.kind === "ATR_STOP") {
    const value = atrAt(rule.period);
    distance = value === null ? null : value * rule.multiplier;
  } else {
    distance =
      rule.unit === "PERCENT"
        ? (entryPrice * rule.value) / 100
        : rule.unit === "TICK"
          ? rule.value * minimumTick
          : rule.value;
  }
  if (distance === null || distance <= 0) return null;
  return side === "LONG" ? entryPrice - distance : entryPrice + distance;
}

export function calculatePositionQuantity(input: PositionSizingInput): number {
  const allocationCap = (input.equity * input.maximumAllocationPercent) / 100;
  let notional: number;
  if (input.sizing.kind === "FIXED_NOTIONAL") notional = input.sizing.value;
  else if (input.sizing.kind === "EQUITY_PERCENT")
    notional = (input.equity * input.sizing.value) / 100;
  else {
    if (input.initialStop === null) return 0;
    const riskPerUnit = Math.abs(input.entryPrice - input.initialStop);
    if (riskPerUnit <= 0) return 0;
    const riskAmount =
      input.sizing.kind === "RISK_AMOUNT"
        ? input.sizing.value
        : (input.equity * input.sizing.value) / 100;
    notional = (riskAmount / riskPerUnit) * input.entryPrice;
  }
  return Math.max(
    0,
    Math.floor(Math.min(notional, allocationCap, input.equity) / input.entryPrice),
  );
}

export function createPositionState(input: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  initialStop: number | null;
  entryAt: string;
  entryIndex: number;
}): PositionStateV3 {
  return {
    side: input.side,
    entryPrice: input.entryPrice,
    entryAt: input.entryAt,
    entryIndex: input.entryIndex,
    initialQuantity: input.quantity,
    remainingQuantity: input.quantity,
    initialStop: input.initialStop,
    initialRiskPerUnit:
      input.initialStop === null ? null : Math.abs(input.entryPrice - input.initialStop),
    protectiveStop: input.initialStop,
    highestPriceSinceEntry: input.entryPrice,
    lowestPriceSinceEntry: input.entryPrice,
    trailingStops: {},
    triggeredExitIds: new Set(),
    realizedPnl: 0,
    barsHeld: 0,
  };
}

function currentR(state: PositionStateV3, price: number): number | null {
  if (!state.initialRiskPerUnit) return null;
  return (
    (state.side === "LONG" ? price - state.entryPrice : state.entryPrice - price) /
    state.initialRiskPerUnit
  );
}

function strengthenStop(
  state: PositionStateV3,
  previous: number | undefined,
  candidate: number,
): number {
  if (previous === undefined) return candidate;
  return state.side === "LONG" ? Math.max(previous, candidate) : Math.min(previous, candidate);
}

function refreshProtectiveStop(state: PositionStateV3): void {
  const candidates = [state.protectiveStop, ...Object.values(state.trailingStops)].filter(
    (value): value is number => value !== null,
  );
  if (candidates.length === 0) return;
  state.protectiveStop = state.side === "LONG" ? Math.max(...candidates) : Math.min(...candidates);
}

export function updateTrailingStops(
  state: PositionStateV3,
  exits: ExitRule[],
  candle: Pick<{ high: number; low: number; close: number }, "high" | "low" | "close">,
  atrAt: (period: number) => number | null,
): void {
  state.highestPriceSinceEntry = Math.max(state.highestPriceSinceEntry, candle.high);
  state.lowestPriceSinceEntry = Math.min(state.lowestPriceSinceEntry, candle.low);
  for (const exit of exits) {
    if (
      exit.kind !== "ATR_TRAILING" &&
      exit.kind !== "CHANDELIER" &&
      exit.kind !== "PERCENTAGE_TRAILING"
    )
      continue;
    const r = currentR(
      state,
      state.side === "LONG" ? state.highestPriceSinceEntry : state.lowestPriceSinceEntry,
    );
    const activationR = "activationR" in exit ? exit.activationR : undefined;
    if (activationR !== undefined && (r === null || r < activationR)) continue;
    let candidate: number | null = null;
    if (exit.kind === "PERCENTAGE_TRAILING") {
      candidate =
        state.side === "LONG"
          ? state.highestPriceSinceEntry * (1 - exit.percent / 100)
          : state.lowestPriceSinceEntry * (1 + exit.percent / 100);
    } else {
      const range = atrAt(
        exit.kind === "CHANDELIER" ? (exit.atrPeriod ?? exit.period) : exit.period,
      );
      if (range !== null) {
        candidate =
          state.side === "LONG"
            ? state.highestPriceSinceEntry - range * exit.multiplier
            : state.lowestPriceSinceEntry + range * exit.multiplier;
      }
    }
    if (candidate !== null)
      state.trailingStops[exit.id] = strengthenStop(state, state.trailingStops[exit.id], candidate);
  }
  refreshProtectiveStop(state);
}

export function applyBreakEven(
  state: PositionStateV3,
  rule: Extract<ExitRule, { kind: "BREAK_EVEN" }>,
  favorablePrice: number,
): boolean {
  if (!state.initialRiskPerUnit || state.triggeredExitIds.has(rule.id)) return false;
  const r = currentR(state, favorablePrice);
  if (r === null || r < rule.triggerR) return false;
  const candidate =
    state.entryPrice + (state.side === "LONG" ? 1 : -1) * state.initialRiskPerUnit * rule.offsetR;
  state.protectiveStop =
    state.protectiveStop === null
      ? candidate
      : state.side === "LONG"
        ? Math.max(state.protectiveStop, candidate)
        : Math.min(state.protectiveStop, candidate);
  state.triggeredExitIds.add(rule.id);
  return true;
}

export function applyScaleOut(
  state: PositionStateV3,
  levelId: string,
  quantityPercent: number,
): number {
  if (state.triggeredExitIds.has(levelId) || state.remainingQuantity <= 0) return 0;
  const quantity = Math.min(
    state.remainingQuantity,
    (state.initialQuantity * quantityPercent) / 100,
  );
  state.remainingQuantity -= quantity;
  state.triggeredExitIds.add(levelId);
  return quantity;
}

export function riskMultiple(state: PositionStateV3, price: number): number | null {
  return currentR(state, price);
}
