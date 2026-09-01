"use client";

import { useMemo, useState } from "react";

import type { BacktestResultV3 } from "@/src/domain/backtest-v3/engine";
import type { BacktestWindowInput } from "@/src/domain/backtest-window";
import type { InstrumentSummary } from "@/src/domain/instruments";
import { createInstrumentSnapshot } from "@/src/domain/stored-strategy";
import {
  ENTRY_PRESETS_V3,
  EXIT_PRESETS_V3,
  FILTER_PRESETS_V3,
  STRATEGY_CATALOG_V3,
  createPresetStrategyV3,
  createVwapIchimokuStrategyV3,
  type StrategyCatalogCategory,
  type StrategyCatalogPreset,
  type StrategyCatalogRole,
} from "@/src/domain/strategy-v3/catalog";
import {
  ExitRuleSchema,
  StrategyDefinitionV3Schema,
  type ConditionRule,
  type ExitRule,
  type IndicatorOperand,
  type Operand,
  type RuleGroup,
  type RuleNode,
  type StrategyDefinitionV3,
  type StrategyTimeframe,
} from "@/src/domain/strategy-v3/schema";

interface Props {
  instrument: InstrumentSummary;
  initialStrategy?: StrategyDefinitionV3 | null;
  onStrategyChange: (strategy: StrategyDefinitionV3 | null) => void;
  onResult: (result: BacktestResultV3) => void;
  backtestWindow?: BacktestWindowInput;
}

const roles: Array<{ value: "ALL" | StrategyCatalogRole; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "ENTRY", label: "진입" },
  { value: "FILTER", label: "필터" },
  { value: "EXIT", label: "청산" },
];

const categories: Array<"ALL" | StrategyCatalogCategory> = [
  "ALL",
  "TREND",
  "MOMENTUM",
  "BREAKOUT",
  "MEAN_REVERSION",
  "VOLATILITY",
  "VOLUME",
  "VWAP",
  "ICHIMOKU",
  "MARKET_STRUCTURE",
  "RISK_MANAGEMENT",
  "EXIT",
];

const timeframes: StrategyTimeframe[] = ["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"];
const operators: ConditionRule["operator"][] = [
  "GT",
  "GTE",
  "LT",
  "LTE",
  "EQ",
  "CROSS_ABOVE",
  "CROSS_BELOW",
  "TOUCH",
  "BREAK_ABOVE",
  "BREAK_BELOW",
  "BETWEEN",
];

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function rekeyNode(node: RuleNode): RuleNode {
  if (node.type === "CONDITION") return { ...node, id: uid("condition") };
  return { ...node, id: uid("group"), children: node.children.map(rekeyNode) };
}

function rekeyExits(exits: ExitRule[]): ExitRule[] {
  return exits.map((exit) => {
    const id = uid("exit");
    if (exit.kind === "SCALE_OUT")
      return { ...exit, id, levels: exit.levels.map((level) => ({ ...level, id: uid("level") })) };
    if (exit.kind === "CONDITION") return { ...exit, id, rule: rekeyNode(exit.rule) as RuleGroup };
    return { ...exit, id };
  });
}

function hasInitialRiskStop(exits: ExitRule[]): boolean {
  return exits.some((exit) => exit.kind === "FIXED_STOP" || exit.kind === "ATR_STOP");
}

function countLeaves(node: RuleNode): number {
  return node.type === "CONDITION"
    ? 1
    : node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

function defaultCondition(timeframe: StrategyTimeframe): ConditionRule {
  return {
    type: "CONDITION",
    id: uid("condition"),
    label: "새 조건",
    left: { type: "INDICATOR", timeframe, offset: 0, kind: "PRICE", field: "close" },
    operator: "GT",
    right: { type: "CONSTANT", value: 0 },
  };
}

function tuneTimeframe(
  node: RuleNode,
  previous: StrategyTimeframe,
  next: StrategyTimeframe,
): RuleNode {
  if (node.type === "GROUP")
    return {
      ...node,
      children: node.children.map((child) => tuneTimeframe(child, previous, next)),
    };
  const update = (operand: Operand) =>
    operand.type === "INDICATOR" && operand.timeframe === previous
      ? { ...operand, timeframe: next }
      : operand;
  return {
    ...node,
    left: update(node.left),
    ...(node.right ? { right: update(node.right) } : {}),
    ...(node.range
      ? { range: { lower: update(node.range.lower), upper: update(node.range.upper) } }
      : {}),
  };
}

function flipNode(node: RuleNode): RuleNode {
  if (node.type === "GROUP") return { ...node, children: node.children.map(flipNode) };
  const opposite = {
    GT: "LT",
    GTE: "LTE",
    LT: "GT",
    LTE: "GTE",
    EQ: "EQ",
    TOUCH: "TOUCH",
    BETWEEN: "BETWEEN",
    CROSS_ABOVE: "CROSS_BELOW",
    CROSS_BELOW: "CROSS_ABOVE",
    BREAK_ABOVE: "BREAK_BELOW",
    BREAK_BELOW: "BREAK_ABOVE",
  } as const;
  const flipOperand = (operand: Operand): Operand => {
    if (operand.type === "CONSTANT") return operand;
    if (operand.kind === "ADX" && operand.output !== "ADX")
      return { ...operand, output: operand.output === "PLUS_DI" ? "MINUS_DI" : "PLUS_DI" };
    if (
      operand.kind === "ICHIMOKU" &&
      (operand.output === "CLOUD_TOP_SOURCE" || operand.output === "CLOUD_BOTTOM_SOURCE")
    )
      return {
        ...operand,
        output: operand.output === "CLOUD_TOP_SOURCE" ? "CLOUD_BOTTOM_SOURCE" : "CLOUD_TOP_SOURCE",
      };
    if (operand.kind === "HIGHEST" || operand.kind === "LOWEST")
      return {
        ...operand,
        kind: operand.kind === "HIGHEST" ? "LOWEST" : "HIGHEST",
        field: operand.field === "high" ? "low" : operand.field === "low" ? "high" : operand.field,
      };
    if (
      (operand.kind === "BOLLINGER" || operand.kind === "DONCHIAN" || operand.kind === "KELTNER") &&
      (operand.output === "UPPER" || operand.output === "LOWER")
    )
      return { ...operand, output: operand.output === "UPPER" ? "LOWER" : "UPPER" };
    if (operand.kind === "OPENING_RANGE" && operand.output !== "MIDDLE")
      return { ...operand, output: operand.output === "HIGH" ? "LOW" : "HIGH" };
    if (operand.kind === "MARKET_STRUCTURE") {
      const outputs = {
        PREVIOUS_HIGH: "PREVIOUS_LOW",
        PREVIOUS_LOW: "PREVIOUS_HIGH",
        SWING_HIGH: "SWING_LOW",
        SWING_LOW: "SWING_HIGH",
        SUPPORT: "RESISTANCE",
        RESISTANCE: "SUPPORT",
        PIVOT: "PIVOT",
      } as const;
      return { ...operand, output: outputs[operand.output] };
    }
    return operand;
  };
  return {
    ...node,
    operator: opposite[node.operator],
    left: flipOperand(node.left),
    ...(node.right ? { right: flipOperand(node.right) } : {}),
    ...(node.range
      ? { range: { lower: flipOperand(node.range.lower), upper: flipOperand(node.range.upper) } }
      : {}),
  };
}

function OperandEditor({
  value,
  onChange,
}: {
  value: Operand;
  onChange: (value: Operand) => void;
}) {
  if (value.type === "CONSTANT") {
    return (
      <label className="engine-inline-field">
        <span>값</span>
        <input
          type="number"
          step="any"
          value={value.value}
          onChange={(event) => onChange({ ...value, value: Number(event.target.value) })}
        />
      </label>
    );
  }
  const numeric = Object.entries(value).filter(
    ([key, item]) => key !== "offset" && typeof item === "number",
  );
  const selectOptions: Record<string, string[]> = {
    source: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    field: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    average: ["SMA", "EMA"],
  };
  if (value.kind === "MACD") selectOptions.output = ["LINE", "SIGNAL", "HISTOGRAM"];
  if (value.kind === "ADX") selectOptions.output = ["ADX", "PLUS_DI", "MINUS_DI"];
  if (value.kind === "ICHIMOKU")
    selectOptions.output = [
      "TENKAN",
      "KIJUN",
      "SPAN_A_SOURCE",
      "SPAN_B_SOURCE",
      "CLOUD_TOP_SOURCE",
      "CLOUD_BOTTOM_SOURCE",
    ];
  if (value.kind === "STOCHASTIC") selectOptions.output = ["K", "D"];
  if (value.kind === "BOLLINGER" || value.kind === "DONCHIAN" || value.kind === "KELTNER")
    selectOptions.output = ["LOWER", "MIDDLE", "UPPER"];
  if (value.kind === "VWAP")
    selectOptions.output = [
      "VALUE",
      "LOWER_BAND",
      "UPPER_BAND",
      "DISTANCE_PERCENT",
      "DISTANCE_ATR",
      "Z_SCORE",
    ];
  if (value.kind === "OPENING_RANGE") selectOptions.output = ["HIGH", "LOW", "MIDDLE"];
  if (value.kind === "MARKET_STRUCTURE")
    selectOptions.output = [
      "PREVIOUS_HIGH",
      "PREVIOUS_LOW",
      "SWING_HIGH",
      "SWING_LOW",
      "PIVOT",
      "SUPPORT",
      "RESISTANCE",
    ];
  if (value.kind === "OBV") selectOptions.output = ["VALUE", "PREVIOUS_HIGH", "PREVIOUS_LOW"];
  const selects = Object.entries(selectOptions).filter(([key]) => key in value);
  return (
    <div className="engine-operand">
      <div className="engine-operand-head">
        {value.kind === "SMA" || value.kind === "EMA" ? (
          <label>
            <span className="sr-only">이동평균 종류</span>
            <select
              value={value.kind}
              onChange={(event) =>
                onChange({
                  ...value,
                  kind: event.target.value as "SMA" | "EMA",
                })
              }
            >
              <option value="EMA">EMA</option>
              <option value="SMA">SMA</option>
            </select>
          </label>
        ) : (
          <strong>{value.kind}</strong>
        )}
        <label>
          <span className="sr-only">{value.kind} timeframe</span>
          <select
            value={value.timeframe}
            onChange={(event) =>
              onChange({ ...value, timeframe: event.target.value as StrategyTimeframe })
            }
          >
            {timeframes.map((timeframe) => (
              <option key={timeframe}>{timeframe}</option>
            ))}
          </select>
        </label>
        <label>
          <span>offset</span>
          <input
            type="number"
            min="0"
            max="2000"
            value={value.offset}
            onChange={(event) => onChange({ ...value, offset: Number(event.target.value) })}
          />
        </label>
      </div>
      {value.kind === "VWAP" ? (
        <div className="engine-vwap-variant">
          <label>
            <span>VWAP 종류</span>
            <select
              value={value.variant.kind}
              onChange={(event) => {
                const kind = event.target.value;
                const variant =
                  kind === "ROLLING_DAYS"
                    ? ({ kind, days: 15 } as const)
                    : kind === "ROLLING_BARS"
                      ? ({ kind, bars: 20 } as const)
                      : kind === "ANCHORED"
                        ? ({ kind, anchor: new Date().toISOString() } as const)
                        : ({ kind } as Extract<IndicatorOperand, { kind: "VWAP" }>["variant"]);
                onChange({ ...value, variant });
              }}
            >
              {["SESSION", "WEEKLY", "MONTHLY", "ANCHORED", "ROLLING_BARS", "ROLLING_DAYS"].map(
                (kind) => (
                  <option key={kind}>{kind}</option>
                ),
              )}
            </select>
          </label>
          {"days" in value.variant ? (
            <label>
              <span>일</span>
              <input
                type="number"
                min="1"
                value={value.variant.days}
                onChange={(event) =>
                  onChange({
                    ...value,
                    variant: { kind: "ROLLING_DAYS", days: Number(event.target.value) },
                  })
                }
              />
            </label>
          ) : null}
          {"bars" in value.variant ? (
            <label>
              <span>봉</span>
              <input
                type="number"
                min="1"
                value={value.variant.bars}
                onChange={(event) =>
                  onChange({
                    ...value,
                    variant: { kind: "ROLLING_BARS", bars: Number(event.target.value) },
                  })
                }
              />
            </label>
          ) : null}
          {"anchor" in value.variant ? (
            <label>
              <span>Anchor ISO</span>
              <input
                value={value.variant.anchor}
                onChange={(event) =>
                  onChange({ ...value, variant: { kind: "ANCHORED", anchor: event.target.value } })
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {selects.length ? (
        <div className="engine-parameter-row">
          {selects.map(([key, options]) => (
            <label key={key}>
              <span>{key}</span>
              <select
                value={String((value as unknown as Record<string, unknown>)[key])}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.value } as IndicatorOperand)
                }
              >
                {options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
          {"excludeCurrent" in value ? (
            <label>
              <span>현재 봉 제외</span>
              <input
                type="checkbox"
                checked={value.excludeCurrent}
                onChange={(event) => onChange({ ...value, excludeCurrent: event.target.checked })}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {numeric.length ? (
        <div className="engine-parameter-row">
          {numeric.map(([key, item]) => (
            <label key={key} title={`${value.kind} ${key}`}>
              <span>{key}</span>
              <input
                type="number"
                min="0"
                step="any"
                value={item as number}
                onChange={(event) =>
                  onChange({ ...value, [key]: Number(event.target.value) } as IndicatorOperand)
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConditionEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: ConditionRule;
  onChange: (rule: ConditionRule) => void;
  onRemove: () => void;
}) {
  return (
    <article className="engine-condition">
      <header>
        <input
          aria-label="Rule label"
          value={rule.label ?? rule.id}
          onChange={(event) => onChange({ ...rule, label: event.target.value })}
        />
        <button type="button" className="text-button danger" onClick={onRemove}>
          삭제
        </button>
      </header>
      <OperandEditor value={rule.left} onChange={(left) => onChange({ ...rule, left })} />
      <label className="engine-operator">
        <span>비교</span>
        <select
          value={rule.operator}
          onChange={(event) => {
            const operator = event.target.value as ConditionRule["operator"];
            onChange(
              operator === "BETWEEN"
                ? {
                    ...rule,
                    operator,
                    right: undefined,
                    range: rule.range ?? {
                      lower: { type: "CONSTANT", value: 0 },
                      upper: { type: "CONSTANT", value: 100 },
                    },
                  }
                : {
                    ...rule,
                    operator,
                    range: undefined,
                    right: rule.right ?? { type: "CONSTANT", value: 0 },
                  },
            );
          }}
        >
          {operators.map((operator) => (
            <option key={operator}>{operator}</option>
          ))}
        </select>
      </label>
      {rule.operator === "BETWEEN" ? (
        <div className="engine-range">
          <OperandEditor
            value={rule.range!.lower}
            onChange={(lower) => onChange({ ...rule, range: { ...rule.range!, lower } })}
          />
          <OperandEditor
            value={rule.range!.upper}
            onChange={(upper) => onChange({ ...rule, range: { ...rule.range!, upper } })}
          />
        </div>
      ) : (
        <OperandEditor value={rule.right!} onChange={(right) => onChange({ ...rule, right })} />
      )}
    </article>
  );
}

function RuleGroupEditor({
  group,
  timeframe,
  onChange,
  removable,
  onRemove,
}: {
  group: RuleGroup;
  timeframe: StrategyTimeframe;
  onChange: (group: RuleGroup) => void;
  removable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <section className="engine-rule-group">
      <header>
        <label>
          <span className="sr-only">그룹 논리 연산</span>
          <select
            value={group.operator}
            onChange={(event) =>
              onChange({
                ...group,
                operator: event.target.value as RuleGroup["operator"],
                children:
                  event.target.value === "NOT" ? group.children.slice(0, 1) : group.children,
              })
            }
          >
            <option>AND</option>
            <option>OR</option>
            <option>NOT</option>
          </select>
        </label>
        <span>{countLeaves(group)} rules</span>
        {removable ? (
          <button type="button" className="text-button danger" onClick={onRemove}>
            그룹 삭제
          </button>
        ) : null}
      </header>
      <div className="engine-rule-children">
        {group.children.map((child, index) =>
          child.type === "GROUP" ? (
            <RuleGroupEditor
              key={child.id}
              group={child}
              timeframe={timeframe}
              removable
              onRemove={() =>
                onChange({
                  ...group,
                  children: group.children.filter((_, childIndex) => childIndex !== index),
                })
              }
              onChange={(next) =>
                onChange({
                  ...group,
                  children: group.children.map((item, childIndex) =>
                    childIndex === index ? next : item,
                  ),
                })
              }
            />
          ) : (
            <ConditionEditor
              key={child.id}
              rule={child}
              onRemove={() =>
                onChange({
                  ...group,
                  children: group.children.filter((_, childIndex) => childIndex !== index),
                })
              }
              onChange={(next) =>
                onChange({
                  ...group,
                  children: group.children.map((item, childIndex) =>
                    childIndex === index ? next : item,
                  ),
                })
              }
            />
          ),
        )}
      </div>
      {group.operator !== "NOT" || group.children.length === 0 ? (
        <div className="engine-group-actions">
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange({ ...group, children: [...group.children, defaultCondition(timeframe)] })
            }
          >
            + 조건
          </button>
          {group.operator !== "NOT" ? (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onChange({
                  ...group,
                  children: [
                    ...group.children,
                    {
                      type: "GROUP",
                      id: uid("group"),
                      operator: "AND",
                      children: [defaultCondition(timeframe)],
                    },
                  ],
                })
              }
            >
              + 중첩 그룹
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExitEditor({
  exit,
  timeframe,
  onChange,
  onRemove,
}: {
  exit: ExitRule;
  timeframe: StrategyTimeframe;
  onChange: (exit: ExitRule) => void;
  onRemove: () => void;
}) {
  const numbers = Object.entries(exit).filter(
    ([key, value]) => !["priority"].includes(key) && typeof value === "number",
  );
  return (
    <article className="engine-exit-card">
      <header>
        <div>
          <span>{exit.kind}</span>
          <strong>{exit.id}</strong>
        </div>
        <button type="button" className="text-button danger" onClick={onRemove}>
          삭제
        </button>
      </header>
      <div className="engine-parameter-row">
        <label title="동일 시점에는 낮은 숫자의 exit이 먼저 평가됩니다.">
          <span>priority</span>
          <input
            type="number"
            min="1"
            value={exit.priority}
            onChange={(event) => onChange({ ...exit, priority: Number(event.target.value) })}
          />
        </label>
        {numbers.map(([key, value]) => (
          <label key={key}>
            <span>{key}</span>
            <input
              type="number"
              step="any"
              value={value as number}
              onChange={(event) =>
                onChange({ ...exit, [key]: Number(event.target.value) } as ExitRule)
              }
            />
          </label>
        ))}
      </div>
      {exit.kind === "FIXED_STOP" || exit.kind === "FIXED_TAKE_PROFIT" ? (
        <label className="engine-inline-field">
          <span>거리 단위</span>
          <select
            value={exit.unit}
            onChange={(event) =>
              onChange({ ...exit, unit: event.target.value as typeof exit.unit })
            }
          >
            <option>PERCENT</option>
            <option>ABSOLUTE</option>
            <option>TICK</option>
          </select>
        </label>
      ) : null}
      {exit.kind === "TIME" ? (
        <div className="engine-parameter-row">
          <label>
            <span>시간 청산 방식</span>
            <select
              value={exit.mode}
              onChange={(event) => {
                const mode = event.target.value as typeof exit.mode;
                onChange({
                  ...exit,
                  mode,
                  ...(mode === "SESSION_END"
                    ? { value: undefined }
                    : mode === "CLOCK"
                      ? { value: "15:20" }
                      : { value: 20 }),
                });
              }}
            >
              <option>BARS</option>
              <option>DAYS</option>
              <option>SESSION_END</option>
              <option>CLOCK</option>
            </select>
          </label>
          {exit.mode === "CLOCK" ? (
            <label>
              <span>거래소 시각</span>
              <input
                type="time"
                value={String(exit.value)}
                onChange={(event) => onChange({ ...exit, value: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {exit.kind === "SCALE_OUT" ? (
        <div className="engine-scale-levels">
          {exit.levels.map((level, index) => (
            <div key={level.id}>
              <select
                aria-label={`${level.id} trigger kind`}
                value={level.trigger.kind}
                onChange={(event) =>
                  onChange({
                    ...exit,
                    levels: exit.levels.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            trigger: {
                              kind: event.target.value as typeof level.trigger.kind,
                              value: item.trigger.value,
                            },
                          }
                        : item,
                    ),
                  })
                }
              >
                <option>PERCENT</option>
                <option>R_MULTIPLE</option>
                <option>ABSOLUTE</option>
              </select>
              <input
                aria-label={`${level.id} trigger`}
                type="number"
                value={level.trigger.value}
                onChange={(event) =>
                  onChange({
                    ...exit,
                    levels: exit.levels.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            trigger: { ...item.trigger, value: Number(event.target.value) },
                          }
                        : item,
                    ),
                  })
                }
              />
              <input
                aria-label={`${level.id} quantity percent`}
                type="number"
                value={level.quantityPercent}
                onChange={(event) =>
                  onChange({
                    ...exit,
                    levels: exit.levels.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, quantityPercent: Number(event.target.value) }
                        : item,
                    ),
                  })
                }
              />
              <span>%</span>
            </div>
          ))}
        </div>
      ) : null}
      {exit.kind === "CONDITION" ? (
        <RuleGroupEditor
          group={exit.rule}
          timeframe={timeframe}
          onChange={(rule) => onChange({ ...exit, rule })}
        />
      ) : null}
    </article>
  );
}

function TraceView({ trace }: { trace: GroupDecisionTraceLike }) {
  return (
    <ul className="engine-trace-list">
      {trace.children.map((child) => (
        <li key={child.id} data-pass={child.passed}>
          {child.type === "CONDITION" ? (
            <>
              <span>{child.label ?? child.id}</span>
              <strong>{child.passed ? "PASS" : child.status}</strong>
              <code>
                {child.current.left ?? "—"} {child.operator}{" "}
                {child.current.right ?? child.current.lower ?? "—"}
              </code>
            </>
          ) : (
            <>
              <span>{child.label ?? child.id}</span>
              <strong>
                {child.operator} · {child.passed ? "PASS" : "FAIL"}
              </strong>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

type GroupDecisionTraceLike = BacktestResultV3["trades"][number]["entryTrace"];

function ResultPanel({
  result,
  comparisons,
}: {
  result: BacktestResultV3;
  comparisons: BacktestResultV3[];
}) {
  const metric = result.metrics;
  return (
    <section
      className="engine-results"
      id="strategy-engine-results"
      tabIndex={-1}
      aria-labelledby="engine-results-title"
    >
      <header>
        <div>
          <span>BACKTEST / EXPLAINABLE</span>
          <h3 id="engine-results-title">검증 결과</h3>
        </div>
        <p>
          {result.period.bars.toLocaleString("ko-KR")} bars · {result.dataPolicy.source}
        </p>
      </header>
      <dl className="engine-metrics">
        {[
          ["총 수익률", `${metric.totalReturnPercent.toFixed(2)}%`],
          ["CAGR", `${metric.cagrPercent.toFixed(2)}%`],
          ["MDD", `${metric.maximumDrawdownPercent.toFixed(2)}%`],
          ["Sharpe", metric.sharpeRatio.toFixed(2)],
          ["Sortino", metric.sortinoRatio.toFixed(2)],
          ["Profit factor", metric.profitFactor?.toFixed(2) ?? "—"],
          ["승률", `${metric.winRatePercent.toFixed(1)}%`],
          ["거래", String(metric.numberOfTrades)],
          ["평균 R", metric.averageRMultiple?.toFixed(2) ?? "—"],
          ["Exposure", `${metric.exposurePercent.toFixed(1)}%`],
          ["수수료", metric.commissionCost.toLocaleString("ko-KR")],
          ["슬리피지", metric.slippageCost.toLocaleString("ko-KR")],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {comparisons.length > 1 ? (
        <div className="engine-comparison-table">
          <h4>Exit comparison</h4>
          <div role="table" aria-label="청산 전략 성과 비교">
            <div role="row" className="engine-comparison-head">
              <span role="columnheader">전략</span>
              <span role="columnheader">Return</span>
              <span role="columnheader">MDD</span>
              <span role="columnheader">Sharpe</span>
              <span role="columnheader">Trades</span>
              <span role="columnheader">Costs</span>
            </div>
            {comparisons.map((run) => (
              <div role="row" key={run.strategy.name}>
                <strong role="cell">{run.strategy.name}</strong>
                <span role="cell">{run.metrics.totalReturnPercent.toFixed(2)}%</span>
                <span role="cell">{run.metrics.maximumDrawdownPercent.toFixed(2)}%</span>
                <span role="cell">{run.metrics.sharpeRatio.toFixed(2)}</span>
                <span role="cell">{run.metrics.numberOfTrades}</span>
                <span role="cell">
                  {(run.metrics.commissionCost + run.metrics.slippageCost).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="engine-result-grid">
        <div>
          <h4>Trade ledger</h4>
          {result.trades.length ? (
            result.trades.slice(0, 30).map((trade, index) => (
              <details key={`${trade.entryAt}-${index}`}>
                <summary>
                  <span>{trade.entryAt}</span>
                  <strong>
                    {trade.netPnl.toLocaleString("ko-KR")} · {trade.exitReason ?? "OPEN"}
                  </strong>
                </summary>
                <TraceView trace={trade.entryTrace} />
                <dl>
                  <div>
                    <dt>진입</dt>
                    <dd>{trade.entryPrice}</dd>
                  </div>
                  <div>
                    <dt>MFE / MAE</dt>
                    <dd>
                      {trade.mfePercent.toFixed(2)}% / {trade.maePercent.toFixed(2)}%
                    </dd>
                  </div>
                  <div>
                    <dt>비용</dt>
                    <dd>{trade.fee.toFixed(2)}</dd>
                  </div>
                </dl>
              </details>
            ))
          ) : (
            <p className="engine-empty-copy">
              이 구간에는 완성된 거래가 없습니다. Warm-up, 규칙 trace와 데이터 범위를 확인하세요.
            </p>
          )}
        </div>
        <aside>
          <h4>실행 가정</h4>
          <ul>
            {result.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>데이터 한계</h4>
          <ul>
            {result.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

export function StrategyEngineWorkbench({
  instrument,
  initialStrategy,
  onStrategyChange,
  onResult,
  backtestWindow,
}: Props) {
  const [strategy, setStrategy] = useState<StrategyDefinitionV3 | null>(initialStrategy ?? null);
  const [query, setQuery] = useState("");
  const [naturalPrompt, setNaturalPrompt] = useState("");
  const [role, setRole] = useState<"ALL" | StrategyCatalogRole>("ALL");
  const [category, setCategory] = useState<"ALL" | StrategyCatalogCategory>("ALL");
  const [status, setStatus] = useState("진입 preset을 선택해 전략을 시작하세요.");
  const [busy, setBusy] = useState(false);
  const [compileBusy, setCompileBusy] = useState(false);
  const [result, setResult] = useState<BacktestResultV3 | null>(null);
  const [comparisonExitIds, setComparisonExitIds] = useState<string[]>([]);
  const [comparisonResults, setComparisonResults] = useState<BacktestResultV3[]>([]);
  const [jsonDraft, setJsonDraft] = useState(
    initialStrategy ? JSON.stringify(initialStrategy, null, 2) : "",
  );

  const filtered = useMemo(
    () =>
      STRATEGY_CATALOG_V3.filter((preset) => {
        const term = query.trim().toLocaleLowerCase("ko-KR");
        return (
          (role === "ALL" || preset.role === role) &&
          (category === "ALL" || preset.category === category) &&
          (!term ||
            [preset.name, preset.description, preset.purpose, ...preset.keywords]
              .join(" ")
              .toLocaleLowerCase("ko-KR")
              .includes(term))
        );
      }),
    [query, role, category],
  );

  function commit(next: StrategyDefinitionV3) {
    setStrategy(next);
    setJsonDraft(JSON.stringify(next, null, 2));
    setResult(null);
    setComparisonResults([]);
    onStrategyChange(next);
  }

  function addPreset(preset: StrategyCatalogPreset) {
    if (!strategy) {
      if (preset.role !== "ENTRY") {
        setStatus(
          "먼저 진입 preset을 선택해 주세요. 그 뒤 Filter와 Exit을 계속 추가할 수 있습니다.",
        );
        return;
      }
      const next = createPresetStrategyV3(preset.id, instrument.instrumentId);
      commit(next);
      setStatus(
        `${preset.name}에서 시작했습니다. Entry/Filter는 최대 64개까지 계속 추가할 수 있습니다.`,
      );
      return;
    }
    const generated = createPresetStrategyV3(preset.id, instrument.instrumentId, {
      timeframe: strategy.timeframe,
      side: strategy.side,
    });
    if (preset.role === "ENTRY")
      commit({
        ...strategy,
        entry: {
          ...strategy.entry,
          children: [...strategy.entry.children, rekeyNode(generated.entry)],
        },
      });
    if (preset.role === "FILTER")
      commit({
        ...strategy,
        filters: {
          ...strategy.filters,
          children: [...strategy.filters.children, rekeyNode(generated.filters)],
        },
      });
    if (preset.role === "EXIT") {
      const selected = generated.exits.filter((exit) => !exit.id.startsWith("baseline-"));
      const baselineStop = generated.exits.find((exit) => exit.id === "baseline-stop");
      const additions =
        !hasInitialRiskStop(strategy.exits) && baselineStop
          ? [baselineStop, ...selected]
          : selected;
      commit({ ...strategy, exits: [...strategy.exits, ...rekeyExits(additions)] });
    }
    setStatus(`${preset.name}을 Rule Chain에 추가했습니다.`);
  }

  function changeTimeframe(next: StrategyTimeframe) {
    if (!strategy) return;
    commit({
      ...strategy,
      timeframe: next,
      entry: tuneTimeframe(strategy.entry, strategy.timeframe, next) as RuleGroup,
      filters: tuneTimeframe(strategy.filters, strategy.timeframe, next) as RuleGroup,
    });
  }

  function changeSide(next: "LONG" | "SHORT") {
    if (!strategy || next === strategy.side) return;
    commit({
      ...strategy,
      side: next,
      entry: flipNode(strategy.entry) as RuleGroup,
      filters: flipNode(strategy.filters) as RuleGroup,
      exits: strategy.exits.map((exit) =>
        exit.kind === "CONDITION" ? { ...exit, rule: flipNode(exit.rule) as RuleGroup } : exit,
      ),
    });
    setStatus(`${next} 방향에 맞춰 비교 연산과 방향성 indicator output을 반전했습니다.`);
  }

  async function compilePrompt() {
    if (compileBusy || naturalPrompt.trim().length < 3) return;
    setCompileBusy(true);
    setStatus("자연어를 allowlist 기반 Strategy v3 Rule Chain으로 변환 중입니다.");
    try {
      const response = await fetch("/api/strategy-engine/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: naturalPrompt.trim(),
          instrumentId: instrument.instrumentId,
          ...(strategy ? { timeframe: strategy.timeframe, side: strategy.side } : {}),
        }),
      });
      const payload = (await response.json()) as {
        compiler?: "deterministic-dsl" | "openai";
        strategy?: StrategyDefinitionV3;
        error?: { message?: string };
      };
      if (!response.ok || !payload.strategy) {
        throw new Error(
          payload.error?.message ?? "자연어 전략을 Rule Chain으로 변환하지 못했습니다.",
        );
      }
      const next = StrategyDefinitionV3Schema.parse(payload.strategy);
      commit(next);
      setStatus(
        `${payload.compiler === "openai" ? "OpenAI 보완" : "로컬 DSL"} 변환 완료 · Entry ${countLeaves(next.entry)}개 · Filter ${countLeaves(next.filters)}개 · Exit ${next.exits.length}개. 실행 전에 규칙을 확인하세요.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "자연어 전략을 변환하지 못했습니다.");
    } finally {
      setCompileBusy(false);
    }
  }

  async function run() {
    if (!strategy || busy) return;
    const validated = StrategyDefinitionV3Schema.safeParse(strategy);
    if (!validated.success) {
      setStatus(
        validated.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" · "),
      );
      return;
    }
    setBusy(true);
    setStatus("TOSS 완료 봉을 불러와 Strategy v3를 실행 중입니다.");
    try {
      const strategies = comparisonExitIds.length
        ? comparisonExitIds.map((id) => {
            const preset = EXIT_PRESETS_V3.find((item) => item.id === id)!;
            const generated = createPresetStrategyV3(id, instrument.instrumentId, {
              timeframe: strategy.timeframe,
              side: strategy.side,
            });
            return {
              ...strategy,
              name: `${strategy.name} / ${preset.name}`,
              exits: generated.exits,
            };
          })
        : [strategy];
      const response = await fetch("/api/strategy-engine/backtests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategies,
          instrument: createInstrumentSnapshot(instrument),
          ...(backtestWindow?.startDate && backtestWindow.endDate
            ? { window: backtestWindow }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        kind?: "single" | "comparison";
        result?: BacktestResultV3;
        comparison?: { runs: Array<{ result: BacktestResultV3 }> };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "백테스트를 완료하지 못했습니다.");
      const runs =
        payload.kind === "comparison"
          ? (payload.comparison?.runs.map((run) => run.result) ?? [])
          : payload.result
            ? [payload.result]
            : [];
      const next = runs[0];
      if (!next) throw new Error("백테스트 결과가 비어 있습니다.");
      setResult(next);
      setComparisonResults(runs);
      onResult(next);
      setStatus(
        payload.kind === "comparison"
          ? `${payload.comparison?.runs.length ?? 0}개 Exit 비교를 완료했습니다.`
          : `${next.metrics.numberOfTrades}개 거래를 검증했습니다.`,
      );
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>("#strategy-engine-results")?.focus(),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "백테스트를 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function applyJson() {
    try {
      const next = StrategyDefinitionV3Schema.parse(JSON.parse(jsonDraft));
      commit(next);
      setStatus("고급 Strategy JSON을 검증해 적용했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JSON을 확인해 주세요.");
    }
  }

  return (
    <section
      className="strategy-engine"
      id="strategy-builder"
      aria-labelledby="strategy-engine-title"
    >
      <header className="engine-hero">
        <div>
          <span>STRATEGY ENGINE / V3</span>
          <h2 id="strategy-engine-title">
            아이디어를 규칙으로.
            <br />
            규칙을 증거로.
          </h2>
        </div>
        <p>
          Entry, Filter, Exit을 독립적으로 쌓습니다. Preset은 출발점이며 모든
          operand·timeframe·parameter를 수정할 수 있습니다.
        </p>
      </header>
      <form
        className="engine-natural-compiler"
        onSubmit={(event) => {
          event.preventDefault();
          void compilePrompt();
        }}
      >
        <label htmlFor="strategy-v3-natural-prompt">
          <span>NATURAL LANGUAGE → VALIDATED RULE CHAIN</span>
          <strong>여러 진입·필터·청산을 한 번에 적어도 됩니다.</strong>
        </label>
        <textarea
          id="strategy-v3-natural-prompt"
          value={naturalPrompt}
          maxLength={4_000}
          rows={3}
          onChange={(event) => setNaturalPrompt(event.target.value)}
          placeholder="예: EMA20/60 상향 돌파와 RSI 50 돌파, ADX 25 이상·상대거래량 1.5배일 때 진입. ATR 2배 손절, 2R 분할매도 후 ATR trailing."
        />
        <div>
          <small>
            로컬 사전 우선 · optional OpenAI 보완 · 코드 생성/실행 없음 · strict v3 schema 재검증
          </small>
          <button
            className="primary-button"
            type="submit"
            disabled={compileBusy || naturalPrompt.trim().length < 3}
          >
            {compileBusy ? "Rule Chain 생성 중" : "Rule Chain 생성"}
          </button>
        </div>
      </form>
      <div className="engine-shell">
        <aside className="engine-catalog" aria-label="전략 카탈로그">
          <header>
            <div>
              <span>LIBRARY</span>
              <strong>
                {ENTRY_PRESETS_V3.length} Entry · {FILTER_PRESETS_V3.length} Filter ·{" "}
                {EXIT_PRESETS_V3.length} Exit
              </strong>
            </div>
            <span>{filtered.length} results</span>
          </header>
          <label className="engine-search">
            <span className="sr-only">전략 검색</span>
            <input
              type="search"
              placeholder="VWAP, RSI, Ichimoku, trailing…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="engine-featured"
            type="button"
            onClick={() => {
              const next = createVwapIchimokuStrategyV3(instrument.instrumentId);
              commit(next);
              setStatus("VWAP Breakout + Ichimoku Exit 실험 preset을 불러왔습니다.");
            }}
          >
            <span>FEATURED EXPERIMENT</span>
            <strong>VWAP Breakout + Ichimoku Exit</strong>
            <small>Rolling 15-Day VWAP · Kijun · ATR trailing</small>
          </button>
          <div className="engine-filter-row" aria-label="전략 역할 필터">
            {roles.map((item) => (
              <button
                type="button"
                key={item.value}
                aria-pressed={role === item.value}
                onClick={() => setRole(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="engine-category">
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <div className="engine-preset-list">
            {filtered.map((preset) => (
              <article key={`${preset.role}-${preset.id}`} className="engine-preset">
                <header>
                  <span>
                    {preset.role} / {preset.category}
                  </span>
                  <em>{preset.supportedSides.join(" · ")}</em>
                </header>
                <h3>{preset.name}</h3>
                <p>{preset.description}</p>
                <dl>
                  <div>
                    <dt>용도</dt>
                    <dd>{preset.purpose}</dd>
                  </div>
                  <div>
                    <dt>데이터</dt>
                    <dd>{preset.dataRequirements.join(", ")}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Parameters {preset.parameters.length}</summary>
                  <ul>
                    {preset.parameters.map((parameter) => (
                      <li key={parameter.key} title={parameter.description}>
                        <span>{parameter.label}</span>
                        <strong>{parameter.defaultValue}</strong>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="engine-preset-actions">
                  <button type="button" onClick={() => addPreset(preset)}>
                    {strategy
                      ? "Rule Chain에 추가"
                      : preset.role === "ENTRY"
                        ? "이 전략으로 시작"
                        : "진입 먼저 선택"}
                  </button>
                  {preset.role === "EXIT" && strategy ? (
                    <button
                      type="button"
                      aria-pressed={comparisonExitIds.includes(preset.id)}
                      onClick={() =>
                        setComparisonExitIds((current) =>
                          current.includes(preset.id)
                            ? current.filter((id) => id !== preset.id)
                            : current.length < 3
                              ? [...current, preset.id]
                              : current,
                        )
                      }
                    >
                      비교
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </aside>

        <div className="engine-builder">
          <div className="engine-sticky-bar">
            <div>
              <span>{instrument.market}</span>
              <strong>{instrument.symbol}</strong>
              <em>{instrument.currency}</em>
            </div>
            {strategy ? (
              <>
                <label>
                  <span>Timeframe</span>
                  <select
                    value={strategy.timeframe}
                    onChange={(event) => changeTimeframe(event.target.value as StrategyTimeframe)}
                  >
                    {timeframes.map((timeframe) => (
                      <option key={timeframe}>{timeframe}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Side</span>
                  <select
                    value={strategy.side}
                    onChange={(event) => changeSide(event.target.value as "LONG" | "SHORT")}
                  >
                    <option>LONG</option>
                    <option>SHORT</option>
                  </select>
                </label>
                <button
                  className="engine-run"
                  type="button"
                  disabled={busy}
                  onClick={() => void run()}
                >
                  {busy
                    ? "실행 중"
                    : comparisonExitIds.length
                      ? `${comparisonExitIds.length}개 비교`
                      : "백테스트"}
                </button>
              </>
            ) : null}
          </div>
          <p className="engine-status" role="status" aria-live="polite">
            {status}
          </p>
          {!strategy ? (
            <div className="engine-empty">
              <span>NO ENTRY YET</span>
              <h3>왼쪽에서 어떤 진입 아이디어든 선택하세요.</h3>
              <p>
                EMA에 제한되지 않습니다. VWAP, momentum, volatility, volume, mean reversion,
                Ichimoku, market structure와 MTF가 같은 Rule Chain으로 들어옵니다.
              </p>
            </div>
          ) : (
            <>
              <label className="engine-name">
                <span>전략 이름</span>
                <input
                  value={strategy.name}
                  maxLength={120}
                  onChange={(event) => commit({ ...strategy, name: event.target.value })}
                />
              </label>
              <section className="engine-stage">
                <header>
                  <div>
                    <span>01</span>
                    <h3>ENTRY</h3>
                  </div>
                  <p>{countLeaves(strategy.entry)} / 64 conditions</p>
                </header>
                <RuleGroupEditor
                  group={strategy.entry}
                  timeframe={strategy.timeframe}
                  onChange={(entry) => commit({ ...strategy, entry })}
                />
              </section>
              <section className="engine-stage">
                <header>
                  <div>
                    <span>02</span>
                    <h3>FILTERS</h3>
                  </div>
                  <p>{countLeaves(strategy.filters)} / 64 conditions · higher timeframe 가능</p>
                </header>
                <RuleGroupEditor
                  group={strategy.filters}
                  timeframe={strategy.timeframe}
                  onChange={(filters) => commit({ ...strategy, filters })}
                />
              </section>
              <section className="engine-stage">
                <header>
                  <div>
                    <span>03</span>
                    <h3>EXIT</h3>
                  </div>
                  <p>낮은 priority가 먼저 실행됩니다.</p>
                </header>
                <div className="engine-exit-list">
                  {strategy.exits.map((exit, index) => (
                    <ExitEditor
                      key={exit.id}
                      exit={exit}
                      timeframe={strategy.timeframe}
                      onRemove={() =>
                        commit({
                          ...strategy,
                          exits: strategy.exits.filter((_, itemIndex) => itemIndex !== index),
                        })
                      }
                      onChange={(next) => {
                        const parsed = ExitRuleSchema.safeParse(next);
                        if (parsed.success)
                          commit({
                            ...strategy,
                            exits: strategy.exits.map((item, itemIndex) =>
                              itemIndex === index ? parsed.data : item,
                            ),
                          });
                        else
                          setStatus(parsed.error.issues[0]?.message ?? "Exit 값을 확인해 주세요.");
                      }}
                    />
                  ))}
                </div>
              </section>
              <section className="engine-stage">
                <header>
                  <div>
                    <span>04</span>
                    <h3>RISK · EXECUTION</h3>
                  </div>
                  <p>Paper only</p>
                </header>
                <div className="engine-risk-grid">
                  <label>
                    <span>Position sizing</span>
                    <select
                      value={strategy.positionSizing.kind}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          positionSizing: {
                            kind: event.target.value,
                            value: strategy.positionSizing.value,
                          } as StrategyDefinitionV3["positionSizing"],
                        })
                      }
                    >
                      <option value="FIXED_NOTIONAL">Fixed notional</option>
                      <option value="EQUITY_PERCENT">% Equity</option>
                      <option value="RISK_AMOUNT">Risk amount</option>
                      <option value="RISK_PERCENT">Risk %</option>
                    </select>
                  </label>
                  <label>
                    <span>Value</span>
                    <input
                      type="number"
                      min="0.01"
                      value={strategy.positionSizing.value}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          positionSizing: {
                            ...strategy.positionSizing,
                            value: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Max positions</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={strategy.risk.maximumPositions}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          risk: {
                            ...strategy.risk,
                            maximumPositions: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Max symbol allocation %</span>
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      value={strategy.risk.maximumSymbolAllocationPercent}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          risk: {
                            ...strategy.risk,
                            maximumSymbolAllocationPercent: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Max daily loss %</span>
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      value={strategy.risk.maximumDailyLossPercent ?? 5}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          risk: {
                            ...strategy.risk,
                            maximumDailyLossPercent: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Max strategy drawdown %</span>
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      value={strategy.risk.maximumStrategyDrawdownPercent ?? 30}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          risk: {
                            ...strategy.risk,
                            maximumStrategyDrawdownPercent: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Max portfolio drawdown %</span>
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      value={strategy.risk.maximumPortfolioDrawdownPercent ?? 30}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          risk: {
                            ...strategy.risk,
                            maximumPortfolioDrawdownPercent: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Consecutive loss breaker</span>
                    <input
                      type="number"
                      min="1"
                      value={strategy.risk.consecutiveLossLimit ?? 5}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          risk: {
                            ...strategy.risk,
                            consecutiveLossLimit: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label title="현재 TOSS instrument snapshot에는 sector metadata가 없어 engine이 집행할 수 없습니다.">
                    <span>Sector exposure</span>
                    <input value="데이터 미지원" disabled />
                  </label>
                  <label>
                    <span>Order</span>
                    <select
                      value={strategy.execution.order.type}
                      onChange={(event) => {
                        const type = event.target.value;
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            order:
                              type === "MARKET"
                                ? { type }
                                : {
                                    type: type as "LIMIT" | "STOP",
                                    offsetUnit: "PERCENT",
                                    offset: 0.1,
                                  },
                          },
                        });
                      }}
                    >
                      <option>MARKET</option>
                      <option>LIMIT</option>
                      <option>STOP</option>
                    </select>
                  </label>
                  {strategy.execution.order.type !== "MARKET" ? (
                    <>
                      <label>
                        <span>Order offset unit</span>
                        <select
                          value={strategy.execution.order.offsetUnit}
                          onChange={(event) =>
                            commit({
                              ...strategy,
                              execution: {
                                ...strategy.execution,
                                order: {
                                  ...strategy.execution.order,
                                  offsetUnit: event.target.value as "PERCENT" | "TICK",
                                } as StrategyDefinitionV3["execution"]["order"],
                              },
                            })
                          }
                        >
                          <option>PERCENT</option>
                          <option>TICK</option>
                        </select>
                      </label>
                      <label>
                        <span>Order offset</span>
                        <input
                          type="number"
                          step="any"
                          value={strategy.execution.order.offset}
                          onChange={(event) =>
                            commit({
                              ...strategy,
                              execution: {
                                ...strategy.execution,
                                order: {
                                  ...strategy.execution.order,
                                  offset: Number(event.target.value),
                                } as StrategyDefinitionV3["execution"]["order"],
                              },
                            })
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    <span>Fill timing</span>
                    <select
                      value={strategy.execution.fillAt}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            fillAt: event.target.value as "NEXT_BAR_OPEN" | "SAME_BAR_CLOSE",
                          },
                        })
                      }
                    >
                      <option>NEXT_BAR_OPEN</option>
                      <option>SAME_BAR_CLOSE</option>
                    </select>
                  </label>
                  <label>
                    <span>Commission bps</span>
                    <input
                      type="number"
                      min="0"
                      value={strategy.execution.commissionBps}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            commissionBps: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Slippage bps</span>
                    <input
                      type="number"
                      min="0"
                      value={strategy.execution.slippageBps}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            slippageBps: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Spread bps</span>
                    <input
                      type="number"
                      min="0"
                      value={strategy.execution.spreadBps}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            spreadBps: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Minimum tick</span>
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      value={strategy.execution.minimumTick}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            minimumTick: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Starting capital</span>
                    <input
                      type="number"
                      min="1"
                      value={strategy.execution.startingCapital}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            startingCapital: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Intrabar</span>
                    <select
                      value={strategy.execution.intrabarPolicy}
                      onChange={(event) =>
                        commit({
                          ...strategy,
                          execution: {
                            ...strategy.execution,
                            intrabarPolicy: event.target
                              .value as StrategyDefinitionV3["execution"]["intrabarPolicy"],
                          },
                        })
                      }
                    >
                      <option>CONSERVATIVE</option>
                      <option>OPTIMISTIC</option>
                      <option>OPEN_HIGH_LOW_CLOSE</option>
                      <option>OPEN_LOW_HIGH_CLOSE</option>
                    </select>
                  </label>
                </div>
                {strategy.execution.fillAt === "SAME_BAR_CLOSE" ? (
                  <p className="engine-execution-warning" role="alert">
                    현재 종가 신호를 같은 종가에 체결하는 비기본 연구 가정입니다. 결과가 낙관적으로
                    왜곡될 수 있습니다.
                  </p>
                ) : null}
              </section>
              <details className="engine-advanced">
                <summary>Advanced Strategy DSL / JSON</summary>
                <p>
                  중첩 depth 8, Entry·Filter 각 64개 조건까지 직접 구성할 수 있습니다. 서버에서 같은
                  strict schema로 다시 검증합니다.
                </p>
                <textarea
                  value={jsonDraft}
                  spellCheck={false}
                  onChange={(event) => setJsonDraft(event.target.value)}
                />
                <button type="button" onClick={applyJson}>
                  검증 후 적용
                </button>
              </details>
            </>
          )}
        </div>
      </div>
      {result ? <ResultPanel result={result} comparisons={comparisonResults} /> : null}
    </section>
  );
}
