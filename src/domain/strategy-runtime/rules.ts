import type { Candle } from "@/src/fixtures/markets";
import type {
  ComparisonOperator,
  ConditionRule,
  Operand,
  RuleGroup,
  RuleNode,
} from "@/src/domain/strategy-v3/schema";

import type { IndicatorRegistry } from "./indicators";

export interface OperandTraceValue {
  value: number | null;
  description: string;
  timeframe?: string;
  sourceCandleAt?: string;
}

export interface ConditionDecisionTrace {
  type: "CONDITION";
  id: string;
  label?: string;
  operator: ComparisonOperator;
  passed: boolean;
  status: "PASS" | "FAIL" | "WARM_UP";
  current: {
    left: number | null;
    right?: number | null;
    lower?: number | null;
    upper?: number | null;
  };
  previous?: { left: number | null; right: number | null };
  operands: OperandTraceValue[];
}

export interface GroupDecisionTrace {
  type: "GROUP";
  id: string;
  label?: string;
  operator: "AND" | "OR" | "NOT";
  passed: boolean;
  children: DecisionTrace[];
}

export type DecisionTrace = ConditionDecisionTrace | GroupDecisionTrace;

export interface RuleEvaluation {
  passed: boolean;
  trace: GroupDecisionTrace;
}

function describeOperand(operand: Operand): string {
  if (operand.type === "CONSTANT") return String(operand.value);
  const details = Object.entries(operand)
    .filter(([key]) => !["type", "timeframe", "offset", "kind"].includes(key))
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(", ");
  return `${operand.kind}${details ? `(${details})` : ""}${operand.offset ? `[-${operand.offset}]` : ""}`;
}

function valueAt(operand: Operand, index: number, registry: IndicatorRegistry): number | null {
  return operand.type === "CONSTANT" ? operand.value : registry.value(operand, index);
}

function traceValue(
  operand: Operand,
  index: number,
  registry: IndicatorRegistry,
  candles: Candle[],
): OperandTraceValue {
  return {
    value: valueAt(operand, index, registry),
    description: describeOperand(operand),
    ...(operand.type === "INDICATOR"
      ? { timeframe: operand.timeframe, sourceCandleAt: candles[index - operand.offset]?.date }
      : {}),
  };
}

function compare(
  operator: ComparisonOperator,
  currentLeft: number,
  currentRight: number,
  previousLeft: number | null,
  previousRight: number | null,
  tolerance = 0,
): boolean {
  if (operator === "GT") return currentLeft > currentRight;
  if (operator === "GTE") return currentLeft >= currentRight;
  if (operator === "LT") return currentLeft < currentRight;
  if (operator === "LTE") return currentLeft <= currentRight;
  if (operator === "EQ") return Math.abs(currentLeft - currentRight) <= tolerance;
  if (operator === "TOUCH") return Math.abs(currentLeft - currentRight) <= tolerance;
  if (previousLeft === null || previousRight === null) return false;
  if (operator === "CROSS_ABOVE" || operator === "BREAK_ABOVE") {
    return previousLeft <= previousRight && currentLeft > currentRight;
  }
  return previousLeft >= previousRight && currentLeft < currentRight;
}

function evaluateCondition(
  rule: ConditionRule,
  index: number,
  registry: IndicatorRegistry,
  candles: Candle[],
): ConditionDecisionTrace {
  const left = traceValue(rule.left, index, registry, candles);
  const operands = [left];
  if (rule.operator === "BETWEEN") {
    const lower = traceValue(rule.range!.lower, index, registry, candles);
    const upper = traceValue(rule.range!.upper, index, registry, candles);
    operands.push(lower, upper);
    const ready = left.value !== null && lower.value !== null && upper.value !== null;
    const passed = ready && left.value! >= lower.value! && left.value! <= upper.value!;
    return {
      type: "CONDITION",
      id: rule.id,
      label: rule.label,
      operator: rule.operator,
      passed,
      status: ready ? (passed ? "PASS" : "FAIL") : "WARM_UP",
      current: { left: left.value, lower: lower.value, upper: upper.value },
      operands,
    };
  }
  const right = traceValue(rule.right!, index, registry, candles);
  operands.push(right);
  const previousLeft = valueAt(rule.left, index - 1, registry);
  const previousRight = valueAt(rule.right!, index - 1, registry);
  const ready = left.value !== null && right.value !== null;
  const requiresPrevious = ["CROSS_ABOVE", "CROSS_BELOW", "BREAK_ABOVE", "BREAK_BELOW"].includes(
    rule.operator,
  );
  const fullyReady =
    ready && (!requiresPrevious || (previousLeft !== null && previousRight !== null));
  const passed =
    fullyReady &&
    compare(rule.operator, left.value!, right.value!, previousLeft, previousRight, rule.tolerance);
  return {
    type: "CONDITION",
    id: rule.id,
    label: rule.label,
    operator: rule.operator,
    passed,
    status: fullyReady ? (passed ? "PASS" : "FAIL") : "WARM_UP",
    current: { left: left.value, right: right.value },
    ...(requiresPrevious ? { previous: { left: previousLeft, right: previousRight } } : {}),
    operands,
  };
}

function evaluateNode(
  node: RuleNode,
  index: number,
  registry: IndicatorRegistry,
  candles: Candle[],
): DecisionTrace {
  if (node.type === "CONDITION") return evaluateCondition(node, index, registry, candles);
  const children = node.children.map((child) => evaluateNode(child, index, registry, candles));
  const passed =
    node.operator === "AND"
      ? children.every((child) => child.passed)
      : node.operator === "OR"
        ? children.some((child) => child.passed)
        : !children[0]?.passed;
  return {
    type: "GROUP",
    id: node.id,
    label: node.label,
    operator: node.operator,
    passed,
    children,
  };
}

export function evaluateRule(
  rule: RuleGroup,
  index: number,
  registry: IndicatorRegistry,
  candles: Candle[],
): RuleEvaluation {
  const trace = evaluateNode(rule, index, registry, candles) as GroupDecisionTrace;
  return { passed: trace.passed, trace };
}
