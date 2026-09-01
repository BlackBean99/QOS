import { z } from "zod";

import { InstrumentIdSchema, MarketSchema, instrumentMatchesMarket } from "../instruments";

export const StrategyTimeframeSchema = z.enum(["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"]);
export type StrategyTimeframe = z.infer<typeof StrategyTimeframeSchema>;

const RuleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i);
const PeriodSchema = z.number().int().min(1).max(2_000);
const OffsetSchema = z.number().int().min(0).max(2_000);
const FiniteSchema = z.number().finite();
const PositiveSchema = z.number().finite().positive();
const SourceSchema = z.enum(["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"]);

const indicatorBase = {
  type: z.literal("INDICATOR"),
  timeframe: StrategyTimeframeSchema,
  offset: OffsetSchema,
} as const;

export const VwapVariantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SESSION") }).strict(),
  z.object({ kind: z.literal("WEEKLY") }).strict(),
  z.object({ kind: z.literal("MONTHLY") }).strict(),
  z.object({ kind: z.literal("ANCHORED"), anchor: z.string().trim().min(1).max(40) }).strict(),
  z.object({ kind: z.literal("ROLLING_BARS"), bars: PeriodSchema }).strict(),
  z.object({ kind: z.literal("ROLLING_DAYS"), days: z.number().int().min(1).max(500) }).strict(),
]);
export type VwapVariant = z.infer<typeof VwapVariantSchema>;

export const IndicatorOperandSchema = z.discriminatedUnion("kind", [
  z.object({ ...indicatorBase, kind: z.literal("PRICE"), field: SourceSchema }).strict(),
  z.object({ ...indicatorBase, kind: z.literal("VOLUME") }).strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.enum(["SMA", "EMA"]),
      period: PeriodSchema,
      source: SourceSchema.optional(),
    })
    .strict(),
  z.object({ ...indicatorBase, kind: z.literal("RSI"), period: PeriodSchema }).strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("MACD"),
      fastPeriod: PeriodSchema,
      slowPeriod: PeriodSchema,
      signalPeriod: PeriodSchema,
      output: z.enum(["LINE", "SIGNAL", "HISTOGRAM"]),
    })
    .strict()
    .refine((value) => value.fastPeriod < value.slowPeriod, {
      message: "MACD fastPeriod must be smaller than slowPeriod.",
    }),
  z
    .object({
      ...indicatorBase,
      kind: z.enum(["ATR", "ATRP"]),
      period: PeriodSchema,
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("ATR_EXPANSION"),
      period: PeriodSchema,
      averagePeriod: PeriodSchema,
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("ADX"),
      period: PeriodSchema,
      output: z.enum(["ADX", "PLUS_DI", "MINUS_DI"]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("ICHIMOKU"),
      tenkanPeriod: PeriodSchema,
      kijunPeriod: PeriodSchema,
      spanBPeriod: PeriodSchema,
      displacement: z.number().int().min(0).max(200),
      output: z.enum([
        "TENKAN",
        "KIJUN",
        "SPAN_A_SOURCE",
        "SPAN_B_SOURCE",
        "CLOUD_TOP_SOURCE",
        "CLOUD_BOTTOM_SOURCE",
      ]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("STOCHASTIC"),
      kPeriod: PeriodSchema,
      kSmoothing: PeriodSchema,
      dPeriod: PeriodSchema,
      output: z.enum(["K", "D"]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.enum(["ROC", "MOMENTUM"]),
      period: PeriodSchema,
      source: SourceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("BOLLINGER"),
      period: PeriodSchema,
      standardDeviations: PositiveSchema.max(10),
      source: SourceSchema.optional(),
      output: z.enum(["LOWER", "MIDDLE", "UPPER", "WIDTH", "PERCENT_B"]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("BB_WIDTH_PERCENTILE"),
      period: PeriodSchema,
      standardDeviations: PositiveSchema.max(10),
      lookback: PeriodSchema,
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("DONCHIAN"),
      period: PeriodSchema,
      excludeCurrent: z.boolean(),
      output: z.enum(["LOWER", "MIDDLE", "UPPER"]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("KELTNER"),
      emaPeriod: PeriodSchema,
      atrPeriod: PeriodSchema,
      multiplier: PositiveSchema.max(20),
      output: z.enum(["LOWER", "MIDDLE", "UPPER"]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("VWAP"),
      variant: VwapVariantSchema,
      output: z.enum([
        "VALUE",
        "LOWER_BAND",
        "UPPER_BAND",
        "DISTANCE_PERCENT",
        "DISTANCE_ATR",
        "Z_SCORE",
      ]),
      bandStandardDeviations: PositiveSchema.max(10).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        (value.output === "LOWER_BAND" || value.output === "UPPER_BAND") &&
        value.bandStandardDeviations === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["bandStandardDeviations"],
          message: "VWAP band output requires bandStandardDeviations.",
        });
      }
    }),
  z.object({ ...indicatorBase, kind: z.literal("VOLUME_SMA"), period: PeriodSchema }).strict(),
  z.object({ ...indicatorBase, kind: z.literal("RELATIVE_VOLUME"), period: PeriodSchema }).strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("OBV"),
      output: z.enum(["VALUE", "PREVIOUS_HIGH", "PREVIOUS_LOW"]).optional(),
      period: PeriodSchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.output && value.output !== "VALUE" && value.period === undefined) {
        context.addIssue({
          code: "custom",
          path: ["period"],
          message: "OBV breakout outputs require a lookback period.",
        });
      }
    }),
  z.object({ ...indicatorBase, kind: z.literal("CMF"), period: PeriodSchema }).strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("ZSCORE"),
      period: PeriodSchema,
      source: SourceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("MA_DEVIATION"),
      average: z.enum(["SMA", "EMA"]),
      period: PeriodSchema,
      source: SourceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.enum(["HIGHEST", "LOWEST"]),
      period: PeriodSchema,
      field: z.enum(["high", "low", "close"]),
      excludeCurrent: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("OPENING_RANGE"),
      minutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
      output: z.enum(["HIGH", "LOW", "MIDDLE"]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("MARKET_STRUCTURE"),
      lookback: PeriodSchema,
      leftBars: z.number().int().min(1).max(20),
      rightBars: z.number().int().min(0).max(20),
      output: z.enum([
        "PREVIOUS_HIGH",
        "PREVIOUS_LOW",
        "SWING_HIGH",
        "SWING_LOW",
        "PIVOT",
        "SUPPORT",
        "RESISTANCE",
      ]),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("PARABOLIC_SAR"),
      accelerationStep: PositiveSchema.max(1),
      accelerationMaximum: PositiveSchema.max(1),
    })
    .strict(),
  z
    .object({
      ...indicatorBase,
      kind: z.literal("MA_SLOPE"),
      average: z.enum(["SMA", "EMA"]),
      period: PeriodSchema,
      lookback: PeriodSchema,
      source: SourceSchema.optional(),
    })
    .strict(),
]);
export type IndicatorOperand = z.infer<typeof IndicatorOperandSchema>;

export const OperandSchema = z.union([
  z.object({ type: z.literal("CONSTANT"), value: FiniteSchema }).strict(),
  IndicatorOperandSchema,
]);
export type Operand = z.infer<typeof OperandSchema>;

export const ComparisonOperatorSchema = z.enum([
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
]);
export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>;

export const ConditionRuleSchema = z
  .object({
    type: z.literal("CONDITION"),
    id: RuleIdSchema,
    label: z.string().trim().min(1).max(160).optional(),
    left: OperandSchema,
    operator: ComparisonOperatorSchema,
    right: OperandSchema.optional(),
    range: z.object({ lower: OperandSchema, upper: OperandSchema }).strict().optional(),
    tolerance: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operator === "BETWEEN") {
      if (!value.range) {
        context.addIssue({ code: "custom", path: ["range"], message: "BETWEEN requires range." });
      }
      if (value.right) {
        context.addIssue({
          code: "custom",
          path: ["right"],
          message: "BETWEEN does not use right.",
        });
      }
    } else if (!value.right) {
      context.addIssue({
        code: "custom",
        path: ["right"],
        message: `${value.operator} requires right.`,
      });
    }
  });
export type ConditionRule = z.infer<typeof ConditionRuleSchema>;

export interface RuleGroup {
  type: "GROUP";
  id: string;
  label?: string;
  operator: "AND" | "OR" | "NOT";
  children: RuleNode[];
}

export type RuleNode = ConditionRule | RuleGroup;

export const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    ConditionRuleSchema,
    z
      .object({
        type: z.literal("GROUP"),
        id: RuleIdSchema,
        label: z.string().trim().min(1).max(160).optional(),
        operator: z.enum(["AND", "OR", "NOT"]),
        children: z.array(RuleNodeSchema).max(64),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.operator === "NOT" && value.children.length !== 1) {
          context.addIssue({
            code: "custom",
            path: ["children"],
            message: "NOT requires exactly one child.",
          });
        }
      }),
  ]),
);

export const RuleGroupSchema = RuleNodeSchema.refine(
  (value): value is RuleGroup => value.type === "GROUP",
  "A rule group is required.",
);

const exitBase = {
  id: RuleIdSchema,
  priority: z.number().int().min(1).max(1_000),
} as const;
const quantityPercent = z.number().finite().positive().max(100);

const ExitConditionSchema = z
  .object({
    ...exitBase,
    kind: z.literal("CONDITION"),
    rule: RuleGroupSchema,
    quantityPercent,
  })
  .strict();
const FixedStopSchema = z
  .object({
    ...exitBase,
    kind: z.literal("FIXED_STOP"),
    unit: z.enum(["PERCENT", "ABSOLUTE", "TICK"]),
    value: PositiveSchema,
    quantityPercent,
  })
  .strict();
const FixedTakeProfitSchema = z
  .object({
    ...exitBase,
    kind: z.literal("FIXED_TAKE_PROFIT"),
    unit: z.enum(["PERCENT", "ABSOLUTE", "TICK"]),
    value: PositiveSchema,
    quantityPercent,
  })
  .strict();
const RiskRewardExitSchema = z
  .object({
    ...exitBase,
    kind: z.literal("RISK_REWARD"),
    multiple: PositiveSchema.max(100),
    quantityPercent,
  })
  .strict();
const AtrStopSchema = z
  .object({
    ...exitBase,
    kind: z.literal("ATR_STOP"),
    period: PeriodSchema,
    multiplier: PositiveSchema.max(20),
    quantityPercent,
  })
  .strict();
const AtrTrailingSchema = z
  .object({
    ...exitBase,
    kind: z.literal("ATR_TRAILING"),
    period: PeriodSchema,
    multiplier: PositiveSchema.max(20),
    activationR: z.number().finite().nonnegative().optional(),
    quantityPercent,
  })
  .strict();
const ChandelierSchema = z
  .object({
    ...exitBase,
    kind: z.literal("CHANDELIER"),
    period: PeriodSchema,
    atrPeriod: PeriodSchema.optional(),
    multiplier: PositiveSchema.max(20),
    quantityPercent,
  })
  .strict();
const PercentageTrailingSchema = z
  .object({
    ...exitBase,
    kind: z.literal("PERCENTAGE_TRAILING"),
    percent: PositiveSchema.max(100),
    activationR: z.number().finite().nonnegative().optional(),
    quantityPercent,
  })
  .strict();
const BreakEvenSchema = z
  .object({
    ...exitBase,
    kind: z.literal("BREAK_EVEN"),
    triggerR: PositiveSchema.max(100),
    offsetR: z.number().finite().min(-10).max(10),
  })
  .strict();

export const ScaleOutTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERCENT"), value: PositiveSchema.max(10_000) }).strict(),
  z.object({ kind: z.literal("R_MULTIPLE"), value: PositiveSchema.max(100) }).strict(),
  z.object({ kind: z.literal("ABSOLUTE"), value: PositiveSchema }).strict(),
]);

const ScaleOutSchema = z
  .object({
    ...exitBase,
    kind: z.literal("SCALE_OUT"),
    levels: z
      .array(
        z
          .object({
            id: RuleIdSchema,
            trigger: ScaleOutTriggerSchema,
            quantityPercent,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((value, context) => {
    const total = value.levels.reduce((sum, level) => sum + level.quantityPercent, 0);
    if (total > 100) {
      context.addIssue({
        code: "custom",
        path: ["levels"],
        message: "Scale-out quantities cannot exceed 100% of the initial position.",
      });
    }
    if (new Set(value.levels.map((level) => level.id)).size !== value.levels.length) {
      context.addIssue({
        code: "custom",
        path: ["levels"],
        message: "Scale-out ids must be unique.",
      });
    }
  });
const TimeExitSchema = z
  .object({
    ...exitBase,
    kind: z.literal("TIME"),
    mode: z.enum(["BARS", "DAYS", "SESSION_END", "CLOCK"]),
    value: z.union([PositiveSchema, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).optional(),
    quantityPercent,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "CLOCK" && typeof value.value !== "string") {
      context.addIssue({ code: "custom", path: ["value"], message: "CLOCK requires HH:mm." });
    }
    if ((value.mode === "BARS" || value.mode === "DAYS") && typeof value.value !== "number") {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: `${value.mode} requires a number.`,
      });
    }
    if (value.mode === "SESSION_END" && value.value !== undefined) {
      context.addIssue({ code: "custom", path: ["value"], message: "SESSION_END has no value." });
    }
  });
const OppositeSignalSchema = z
  .object({
    ...exitBase,
    kind: z.literal("OPPOSITE_SIGNAL"),
    quantityPercent,
  })
  .strict();

export const ExitRuleSchema = z.discriminatedUnion("kind", [
  ExitConditionSchema,
  FixedStopSchema,
  FixedTakeProfitSchema,
  RiskRewardExitSchema,
  AtrStopSchema,
  AtrTrailingSchema,
  ChandelierSchema,
  PercentageTrailingSchema,
  BreakEvenSchema,
  ScaleOutSchema,
  TimeExitSchema,
  OppositeSignalSchema,
]);
export type ExitRule = z.infer<typeof ExitRuleSchema>;

export const PositionSizingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FIXED_NOTIONAL"), value: PositiveSchema }).strict(),
  z.object({ kind: z.literal("EQUITY_PERCENT"), value: PositiveSchema.max(100) }).strict(),
  z.object({ kind: z.literal("RISK_AMOUNT"), value: PositiveSchema }).strict(),
  z.object({ kind: z.literal("RISK_PERCENT"), value: PositiveSchema.max(100) }).strict(),
]);
export type PositionSizing = z.infer<typeof PositionSizingSchema>;

export const RiskControlsSchema = z
  .object({
    maximumPositions: z.number().int().min(1).max(100),
    maximumSymbolAllocationPercent: PositiveSchema.max(100),
    maximumDailyLossPercent: PositiveSchema.max(100).optional(),
    maximumStrategyDrawdownPercent: PositiveSchema.max(100).optional(),
    maximumPortfolioDrawdownPercent: PositiveSchema.max(100).optional(),
    consecutiveLossLimit: z.number().int().min(1).max(1_000).optional(),
    maximumSectorExposurePercent: PositiveSchema.max(100).optional(),
  })
  .strict();

export const OrderPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MARKET") }).strict(),
  z
    .object({
      type: z.literal("LIMIT"),
      offsetUnit: z.enum(["PERCENT", "TICK"]),
      offset: FiniteSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("STOP"),
      offsetUnit: z.enum(["PERCENT", "TICK"]),
      offset: FiniteSchema,
    })
    .strict(),
]);

export const ExecutionPolicySchema = z
  .object({
    signalAt: z.literal("BAR_CLOSE"),
    fillAt: z.enum(["NEXT_BAR_OPEN", "SAME_BAR_CLOSE"]),
    order: OrderPolicySchema,
    intrabarPolicy: z.enum([
      "CONSERVATIVE",
      "OPTIMISTIC",
      "OPEN_HIGH_LOW_CLOSE",
      "OPEN_LOW_HIGH_CLOSE",
    ]),
    commissionBps: z.number().finite().nonnegative().max(10_000),
    slippageBps: z.number().finite().nonnegative().max(10_000),
    spreadBps: z.number().finite().nonnegative().max(10_000),
    minimumTick: PositiveSchema,
    startingCapital: PositiveSchema,
  })
  .strict();
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const OverlaySelectionSchema = z
  .object({
    id: RuleIdSchema,
    operand: IndicatorOperandSchema,
    label: z.string().trim().min(1).max(160),
  })
  .strict();

function ruleStats(node: RuleNode, depth = 1): { leaves: number; depth: number; ids: string[] } {
  if (node.type === "CONDITION") return { leaves: 1, depth, ids: [node.id] };
  const children = node.children.map((child) => ruleStats(child, depth + 1));
  return {
    leaves: children.reduce((sum, child) => sum + child.leaves, 0),
    depth: Math.max(depth, ...children.map((child) => child.depth)),
    ids: [node.id, ...children.flatMap((child) => child.ids)],
  };
}

function hasInitialRiskStop(exits: ExitRule[]): boolean {
  return exits.some((exit) => exit.kind === "FIXED_STOP" || exit.kind === "ATR_STOP");
}

export const StrategyDefinitionV3Schema = z
  .object({
    version: z.literal(3),
    name: z.string().trim().min(3).max(120),
    market: MarketSchema,
    instrumentId: InstrumentIdSchema,
    timeframe: StrategyTimeframeSchema,
    side: z.enum(["LONG", "SHORT"]),
    entry: RuleGroupSchema,
    filters: RuleGroupSchema,
    exits: z.array(ExitRuleSchema).min(1).max(40),
    positionSizing: PositionSizingSchema,
    risk: RiskControlsSchema,
    execution: ExecutionPolicySchema,
    overlays: z.array(OverlaySelectionSchema).max(40),
  })
  .strict()
  .superRefine((strategy, context) => {
    if (!instrumentMatchesMarket(strategy.instrumentId, strategy.market)) {
      context.addIssue({
        code: "custom",
        path: ["instrumentId"],
        message: "Strategy market and instrumentId must match.",
      });
    }
    for (const [path, group] of [
      ["entry", strategy.entry],
      ["filters", strategy.filters],
    ] as const) {
      const stats = ruleStats(group);
      if (path === "entry" && stats.leaves === 0) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Entry requires at least one condition.",
        });
      }
      if (stats.leaves > 64) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} rule chain cannot exceed 64 leaf conditions.`,
        });
      }
      if (stats.depth > 8) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} rule chain cannot exceed depth 8.`,
        });
      }
      if (new Set(stats.ids).size !== stats.ids.length) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} rule ids must be unique.`,
        });
      }
    }
    const exitIds = strategy.exits.map((exit) => exit.id);
    if (new Set(exitIds).size !== exitIds.length) {
      context.addIssue({ code: "custom", path: ["exits"], message: "Exit ids must be unique." });
    }
    const scaleOutTotal = strategy.exits
      .filter((exit): exit is Extract<ExitRule, { kind: "SCALE_OUT" }> => exit.kind === "SCALE_OUT")
      .flatMap((exit) => exit.levels)
      .reduce((sum, level) => sum + level.quantityPercent, 0);
    if (scaleOutTotal > 100) {
      context.addIssue({
        code: "custom",
        path: ["exits"],
        message: "All scale-out quantities combined cannot exceed 100%.",
      });
    }
    if (
      (strategy.positionSizing.kind === "RISK_AMOUNT" ||
        strategy.positionSizing.kind === "RISK_PERCENT") &&
      !hasInitialRiskStop(strategy.exits)
    ) {
      context.addIssue({
        code: "custom",
        path: ["positionSizing"],
        message: "Risk-based position sizing requires a fixed or ATR initial stop.",
      });
    }
    const hasRDependentExit = strategy.exits.some(
      (exit) =>
        exit.kind === "RISK_REWARD" ||
        exit.kind === "BREAK_EVEN" ||
        (exit.kind === "SCALE_OUT" &&
          exit.levels.some((level) => level.trigger.kind === "R_MULTIPLE")),
    );
    if (hasRDependentExit && !hasInitialRiskStop(strategy.exits)) {
      context.addIssue({
        code: "custom",
        path: ["exits"],
        message: "R-based exits require a fixed or ATR initial stop.",
      });
    }
  });

export type StrategyDefinitionV3 = z.infer<typeof StrategyDefinitionV3Schema>;
