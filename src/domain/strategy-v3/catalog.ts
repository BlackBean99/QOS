import type { InstrumentId } from "../instruments";
import { getMarketDefaults } from "../instruments";
import type {
  ComparisonOperator,
  ConditionRule,
  ExitRule,
  IndicatorOperand,
  Operand,
  RuleGroup,
  RuleNode,
  StrategyDefinitionV3,
  StrategyTimeframe,
} from "./schema";
import { StrategyDefinitionV3Schema } from "./schema";

export type StrategyCatalogRole = "ENTRY" | "FILTER" | "EXIT";
export type StrategyCatalogCategory =
  | "TREND"
  | "MOMENTUM"
  | "BREAKOUT"
  | "MEAN_REVERSION"
  | "VOLATILITY"
  | "VOLUME"
  | "VWAP"
  | "ICHIMOKU"
  | "MARKET_STRUCTURE"
  | "RISK_MANAGEMENT"
  | "EXIT";

export interface PresetParameterMetadata {
  key: string;
  label: string;
  description: string;
  type: "INTEGER" | "NUMBER" | "PERCENT" | "SELECT" | "TIMEFRAME";
  defaultValue: number | string;
  minimum?: number;
  maximum?: number;
  step?: number;
  options?: string[];
}

interface PresetContext {
  timeframe: StrategyTimeframe;
  side: "LONG" | "SHORT";
}

interface CatalogPresetBase {
  id: string;
  name: string;
  role: StrategyCatalogRole;
  category: StrategyCatalogCategory;
  description: string;
  purpose: string;
  dataRequirements: string[];
  supportedSides: Array<"LONG" | "SHORT">;
  recommendedRegimes: string[];
  parameters: PresetParameterMetadata[];
  keywords: string[];
}

export interface RuleCatalogPreset extends CatalogPresetBase {
  role: "ENTRY" | "FILTER";
  create: (context: PresetContext) => RuleGroup;
}

export interface ExitCatalogPreset extends CatalogPresetBase {
  role: "EXIT";
  create: (context: PresetContext) => ExitRule[];
}

export type StrategyCatalogPreset = RuleCatalogPreset | ExitCatalogPreset;

const tf = (context: PresetContext, timeframe?: StrategyTimeframe) =>
  timeframe ?? context.timeframe;
const constant = (value: number): Operand => ({ type: "CONSTANT", value });
const price = (
  context: PresetContext,
  field: "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4" = "close",
  timeframe?: StrategyTimeframe,
  offset = 0,
): IndicatorOperand => ({
  type: "INDICATOR",
  kind: "PRICE",
  timeframe: tf(context, timeframe),
  field,
  offset,
});
const indicator = <T extends Omit<IndicatorOperand, "type" | "timeframe" | "offset">>(
  context: PresetContext,
  definition: T,
  timeframe?: StrategyTimeframe,
  offset = 0,
): IndicatorOperand =>
  ({
    type: "INDICATOR",
    timeframe: tf(context, timeframe),
    offset,
    ...definition,
  }) as IndicatorOperand;
const condition = (
  id: string,
  left: Operand,
  operator: ComparisonOperator,
  right: Operand,
  label?: string,
): ConditionRule => ({ type: "CONDITION", id, label, left, operator, right });
const group = (
  id: string,
  children: RuleNode[],
  operator: "AND" | "OR" | "NOT" = "AND",
  label?: string,
): RuleGroup => ({ type: "GROUP", id, label, operator, children });
const direction = (
  context: PresetContext,
  longOperator: ComparisonOperator,
  shortOperator: ComparisonOperator,
): ComparisonOperator => (context.side === "LONG" ? longOperator : shortOperator);

const integer = (
  key: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  description: string,
): PresetParameterMetadata => ({
  key,
  label,
  description,
  type: "INTEGER",
  defaultValue,
  minimum,
  maximum,
  step: 1,
});
const number = (
  key: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  step: number,
  description: string,
): PresetParameterMetadata => ({
  key,
  label,
  description,
  type: "NUMBER",
  defaultValue,
  minimum,
  maximum,
  step,
});
const sides = ["LONG", "SHORT"] as Array<"LONG" | "SHORT">;

const entry = (
  preset: Omit<RuleCatalogPreset, "role" | "supportedSides"> & {
    supportedSides?: Array<"LONG" | "SHORT">;
  },
): RuleCatalogPreset => ({
  ...preset,
  role: "ENTRY",
  supportedSides: preset.supportedSides ?? sides,
});
const filter = (
  preset: Omit<RuleCatalogPreset, "role" | "supportedSides"> & {
    supportedSides?: Array<"LONG" | "SHORT">;
  },
): RuleCatalogPreset => ({
  ...preset,
  role: "FILTER",
  supportedSides: preset.supportedSides ?? sides,
});
const exit = (
  preset: Omit<ExitCatalogPreset, "role" | "supportedSides"> & {
    supportedSides?: Array<"LONG" | "SHORT">;
  },
): ExitCatalogPreset => ({
  ...preset,
  role: "EXIT",
  supportedSides: preset.supportedSides ?? sides,
});

const fastSlow = [
  integer("fastPeriod", "빠른 기간", 20, 2, 500, "빠른 이동평균 또는 oscillator 기간입니다."),
  integer("slowPeriod", "느린 기간", 60, 3, 1_000, "느린 기준선 기간입니다."),
];
const atrParameters = [
  integer("period", "ATR 기간", 14, 2, 500, "시장 변동성을 계산할 기간입니다."),
  number("multiplier", "ATR 배수", 2, 0.1, 20, 0.1, "변동성에 맞춘 거리 배수입니다."),
];

export const ENTRY_PRESETS_V3: RuleCatalogPreset[] = [
  entry({
    id: "ema-crossover",
    name: "EMA / SMA Crossover",
    category: "TREND",
    description: "빠른 이동평균이 느린 이동평균을 교차할 때 진입합니다.",
    purpose: "Trend following",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: fastSlow,
    keywords: ["EMA", "SMA", "golden cross", "이평선"],
    create: (context) =>
      group("ema-crossover-entry", [
        condition(
          "ema-fast-slow-cross",
          indicator(context, { kind: "EMA", period: 20, source: "close" }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, { kind: "EMA", period: 60, source: "close" }),
        ),
      ]),
  }),
  entry({
    id: "ema-trend-pullback",
    name: "EMA Trend Pullback",
    category: "TREND",
    description: "장기 추세 안에서 EMA를 시험한 뒤 다시 회복할 때 진입합니다.",
    purpose: "Trend continuation",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: fastSlow,
    keywords: ["EMA", "pullback", "눌림목"],
    create: (context) => {
      const fast = indicator(context, { kind: "EMA", period: 20, source: "close" });
      const slow = indicator(context, { kind: "EMA", period: 60, source: "close" });
      return group("ema-pullback-entry", [
        condition("ema-trend", fast, direction(context, "GT", "LT"), slow),
        condition(
          "ema-touch",
          price(context, context.side === "LONG" ? "low" : "high"),
          direction(context, "LTE", "GTE"),
          fast,
        ),
        condition(
          "ema-reclaim",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          fast,
        ),
      ]);
    },
  }),
  entry({
    id: "macd-crossover",
    name: "MACD Crossover",
    category: "TREND",
    description: "MACD line과 signal line의 방향 교차를 사용합니다.",
    purpose: "Trend momentum confirmation",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("fastPeriod", "Fast", 12, 2, 200, "MACD fast EMA입니다."),
      integer("slowPeriod", "Slow", 26, 3, 500, "MACD slow EMA입니다."),
      integer("signalPeriod", "Signal", 9, 2, 200, "Signal EMA입니다."),
    ],
    keywords: ["MACD", "signal", "histogram"],
    create: (context) =>
      group("macd-entry", [
        condition(
          "macd-cross",
          indicator(context, {
            kind: "MACD",
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            output: "LINE",
          }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "MACD",
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            output: "SIGNAL",
          }),
        ),
        condition(
          "macd-zero-filter",
          indicator(context, {
            kind: "MACD",
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            output: "LINE",
          }),
          direction(context, "GT", "LT"),
          constant(0),
        ),
      ]),
  }),
  entry({
    id: "adx-dmi-trend",
    name: "ADX + DMI Trend",
    category: "TREND",
    description: "ADX 추세 강도와 +DI/-DI 방향을 함께 확인합니다.",
    purpose: "Trend strength confirmation",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("period", "ADX 기간", 14, 2, 200, "Wilder ADX 기간입니다."),
      number("threshold", "ADX 임계값", 25, 0, 100, 0.5, "추세 강도 filter 값입니다."),
    ],
    keywords: ["ADX", "DMI", "+DI", "-DI"],
    create: (context) =>
      group("adx-dmi-entry", [
        condition(
          "adx-strength",
          indicator(context, { kind: "ADX", period: 14, output: "ADX" }),
          "GT",
          constant(25),
        ),
        condition(
          "dmi-direction",
          indicator(context, {
            kind: "ADX",
            period: 14,
            output: context.side === "LONG" ? "PLUS_DI" : "MINUS_DI",
          }),
          "GT",
          indicator(context, {
            kind: "ADX",
            period: 14,
            output: context.side === "LONG" ? "MINUS_DI" : "PLUS_DI",
          }),
        ),
      ]),
  }),
  entry({
    id: "ichimoku-trend",
    name: "Ichimoku Trend",
    category: "ICHIMOKU",
    description: "가격의 구름 위치와 전환선/기준선 교차를 조합합니다.",
    purpose: "Multi-component trend following",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("tenkanPeriod", "Tenkan", 9, 2, 200, "전환선 기간입니다."),
      integer("kijunPeriod", "Kijun", 26, 2, 300, "기준선 기간입니다."),
      integer("spanBPeriod", "Span B", 52, 2, 500, "선행스팬 B source 기간입니다."),
    ],
    keywords: ["Ichimoku", "cloud", "Kijun", "일목"],
    create: (context) => {
      const cloudOutput = context.side === "LONG" ? "CLOUD_TOP_SOURCE" : "CLOUD_BOTTOM_SOURCE";
      return group("ichimoku-entry", [
        condition(
          "price-cloud",
          price(context),
          direction(context, "GT", "LT"),
          indicator(context, {
            kind: "ICHIMOKU",
            tenkanPeriod: 9,
            kijunPeriod: 26,
            spanBPeriod: 52,
            displacement: 26,
            output: cloudOutput,
          }),
        ),
        condition(
          "tenkan-kijun-cross",
          indicator(context, {
            kind: "ICHIMOKU",
            tenkanPeriod: 9,
            kijunPeriod: 26,
            spanBPeriod: 52,
            displacement: 26,
            output: "TENKAN",
          }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "ICHIMOKU",
            tenkanPeriod: 9,
            kijunPeriod: 26,
            spanBPeriod: 52,
            displacement: 26,
            output: "KIJUN",
          }),
        ),
      ]);
    },
  }),
  entry({
    id: "rsi-momentum",
    name: "RSI Momentum",
    category: "MOMENTUM",
    description: "RSI가 사용자 기준선을 돌파하는 momentum 진입입니다.",
    purpose: "Momentum continuation",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("period", "RSI 기간", 14, 2, 200, "Wilder RSI 기간입니다."),
      number("threshold", "기준값", 50, 0, 100, 1, "Momentum 기준입니다."),
    ],
    keywords: ["RSI", "momentum", "50"],
    create: (context) =>
      group("rsi-momentum-entry", [
        condition(
          "rsi-momentum-cross",
          indicator(context, { kind: "RSI", period: 14 }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          constant(50),
        ),
      ]),
  }),
  entry({
    id: "rsi-oversold-rebound",
    name: "RSI Oversold Rebound",
    category: "MEAN_REVERSION",
    description: "RSI가 oversold/overbought 기준선 안으로 복귀할 때 진입합니다.",
    purpose: "Mean-reversion timing",
    dataRequirements: ["Close"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      integer("period", "RSI 기간", 14, 2, 200, "Wilder RSI 기간입니다."),
      number("threshold", "Oversold", 30, 0, 100, 1, "강제 30이 아닌 사용자 기준입니다."),
    ],
    keywords: ["RSI", "oversold", "rebound", "과매도"],
    create: (context) =>
      group("rsi-rebound-entry", [
        condition(
          "rsi-rebound",
          indicator(context, { kind: "RSI", period: 14 }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          constant(context.side === "LONG" ? 30 : 70),
        ),
      ]),
  }),
  entry({
    id: "stochastic-rebound",
    name: "Stochastic Rebound",
    category: "MOMENTUM",
    description: "%K/%D 교차와 oversold/overbought 영역을 함께 사용합니다.",
    purpose: "Momentum rebound",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      integer("kPeriod", "%K 기간", 14, 2, 200, "Stochastic range 기간입니다."),
      integer("dPeriod", "%D 기간", 3, 1, 50, "%D smoothing입니다."),
      number("threshold", "영역 기준", 20, 0, 100, 1, "Oversold/overbought 기준입니다."),
    ],
    keywords: ["Stochastic", "%K", "%D", "rebound"],
    create: (context) => {
      const k = indicator(context, {
        kind: "STOCHASTIC",
        kPeriod: 14,
        kSmoothing: 3,
        dPeriod: 3,
        output: "K",
      });
      const d = indicator(context, {
        kind: "STOCHASTIC",
        kPeriod: 14,
        kSmoothing: 3,
        dPeriod: 3,
        output: "D",
      });
      return group("stochastic-entry", [
        condition("stochastic-cross", k, direction(context, "CROSS_ABOVE", "CROSS_BELOW"), d),
        condition(
          "stochastic-zone",
          k,
          direction(context, "LT", "GT"),
          constant(context.side === "LONG" ? 30 : 70),
        ),
      ]);
    },
  }),
  entry({
    id: "n-bar-breakout",
    name: "N-Bar Breakout",
    category: "BREAKOUT",
    description: "현재 봉을 제외한 이전 N개 봉의 최고/최저를 돌파합니다.",
    purpose: "Price breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING", "VOLATILITY_EXPANSION"],
    parameters: [integer("period", "돌파 기간", 20, 2, 1_000, "현재 봉을 제외한 lookback입니다.")],
    keywords: ["N-bar", "highest high", "breakout", "고점돌파"],
    create: (context) =>
      group("n-bar-entry", [
        condition(
          "n-bar-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: context.side === "LONG" ? "HIGHEST" : "LOWEST",
            period: 20,
            field: context.side === "LONG" ? "high" : "low",
            excludeCurrent: true,
          }),
        ),
      ]),
  }),
  entry({
    id: "bollinger-breakout",
    name: "Bollinger Breakout",
    category: "BREAKOUT",
    description: "가격이 Bollinger outer band를 돌파할 때 진입합니다.",
    purpose: "Volatility breakout",
    dataRequirements: ["Close"],
    recommendedRegimes: ["VOLATILITY_EXPANSION"],
    parameters: [
      integer("period", "BB 기간", 20, 2, 500, "중심 이동평균 기간입니다."),
      number("standardDeviations", "표준편차", 2, 0.1, 10, 0.1, "Band 거리입니다."),
    ],
    keywords: ["Bollinger", "band", "breakout"],
    create: (context) =>
      group("bollinger-breakout-entry", [
        condition(
          "bollinger-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "BOLLINGER",
            period: 20,
            standardDeviations: 2,
            source: "close",
            output: context.side === "LONG" ? "UPPER" : "LOWER",
          }),
        ),
      ]),
  }),
  entry({
    id: "bollinger-squeeze",
    name: "Bollinger Squeeze",
    category: "VOLATILITY",
    description: "Band width percentile 축소와 band breakout을 결합합니다.",
    purpose: "Volatility expansion setup",
    dataRequirements: ["Close"],
    recommendedRegimes: ["LOW_VOLATILITY", "VOLATILITY_EXPANSION"],
    parameters: [
      integer("period", "BB 기간", 20, 2, 500, "Band 기간입니다."),
      integer(
        "percentileLookback",
        "Percentile 기간",
        120,
        20,
        1_000,
        "Width percentile 표본입니다.",
      ),
      number("percentile", "Squeeze percentile", 20, 0, 100, 1, "낮을수록 강한 squeeze입니다."),
    ],
    keywords: ["Bollinger", "squeeze", "width", "percentile"],
    create: (context) =>
      group("bollinger-squeeze-entry", [
        condition(
          "bb-width-squeeze",
          indicator(context, {
            kind: "BB_WIDTH_PERCENTILE",
            period: 20,
            standardDeviations: 2,
            lookback: 120,
          }),
          "LT",
          constant(20),
        ),
        condition(
          "bb-squeeze-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "BOLLINGER",
            period: 20,
            standardDeviations: 2,
            output: context.side === "LONG" ? "UPPER" : "LOWER",
          }),
        ),
      ]),
  }),
  entry({
    id: "keltner-breakout",
    name: "Keltner Breakout",
    category: "BREAKOUT",
    description: "가격이 ATR 기반 Keltner channel을 돌파합니다.",
    purpose: "Volatility-adjusted breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING", "VOLATILITY_EXPANSION"],
    parameters: [
      integer("period", "EMA 기간", 20, 2, 500, "Channel 중심 EMA입니다."),
      number("multiplier", "ATR 배수", 2, 0.1, 20, 0.1, "Channel 폭입니다."),
    ],
    keywords: ["Keltner", "channel", "ATR"],
    create: (context) =>
      group("keltner-entry", [
        condition(
          "keltner-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "KELTNER",
            emaPeriod: 20,
            atrPeriod: 14,
            multiplier: 2,
            output: context.side === "LONG" ? "UPPER" : "LOWER",
          }),
        ),
      ]),
  }),
  entry({
    id: "atr-volatility-breakout",
    name: "ATR Volatility Breakout",
    category: "VOLATILITY",
    description: "ATR가 자체 평균 대비 확장된 상태에서 가격 돌파를 요구합니다.",
    purpose: "Volatility expansion confirmation",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["VOLATILITY_EXPANSION"],
    parameters: [
      ...atrParameters,
      integer("averagePeriod", "ATR 평균 기간", 20, 2, 500, "ATR baseline 기간입니다."),
    ],
    keywords: ["ATR", "ATRP", "volatility expansion"],
    create: (context) =>
      group("atr-breakout-entry", [
        condition(
          "atr-expansion",
          indicator(context, { kind: "ATR_EXPANSION", period: 14, averagePeriod: 20 }),
          "GT",
          constant(1.2),
        ),
        condition(
          "atr-price-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: context.side === "LONG" ? "HIGHEST" : "LOWEST",
            period: 20,
            field: context.side === "LONG" ? "high" : "low",
            excludeCurrent: true,
          }),
        ),
      ]),
  }),
  entry({
    id: "session-vwap-breakout",
    name: "Session VWAP Breakout",
    category: "VWAP",
    description: "현재 정규 세션 VWAP을 가격이 교차 돌파합니다.",
    purpose: "Intraday trend entry",
    dataRequirements: ["Intraday OHLCV", "Exchange session"],
    recommendedRegimes: ["TRENDING"],
    parameters: [integer("band", "Band σ", 1, 1, 3, "선택 VWAP band입니다.")],
    keywords: ["VWAP", "session", "intraday", "돌파"],
    create: (context) =>
      group("session-vwap-entry", [
        condition(
          "session-vwap-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, { kind: "VWAP", variant: { kind: "SESSION" }, output: "VALUE" }),
        ),
      ]),
  }),
  entry({
    id: "vwap-reclaim",
    name: "VWAP Reclaim",
    category: "VWAP",
    description: "VWAP 반대편에서 다시 유리한 쪽 종가로 복귀합니다.",
    purpose: "Intraday reclaim",
    dataRequirements: ["Intraday OHLCV"],
    recommendedRegimes: ["TRENDING", "RANGING"],
    parameters: [integer("confirmationBars", "확인 봉", 1, 1, 12, "Reclaim 확인 봉 수입니다.")],
    keywords: ["VWAP", "reclaim", "복귀"],
    create: (context) =>
      group("vwap-reclaim-entry", [
        condition(
          "vwap-reclaim",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, { kind: "VWAP", variant: { kind: "SESSION" }, output: "VALUE" }),
        ),
      ]),
  }),
  entry({
    id: "vwap-pullback",
    name: "VWAP Pullback",
    category: "VWAP",
    description: "VWAP 추세 방향, touch와 재회복을 함께 요구합니다.",
    purpose: "Intraday pullback",
    dataRequirements: ["Intraday OHLCV"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      number("tolerancePercent", "접근 허용폭", 0.2, 0, 10, 0.1, "VWAP 근처로 간주할 거리입니다."),
    ],
    keywords: ["VWAP", "pullback", "눌림"],
    create: (context) => {
      const vwap = indicator(context, {
        kind: "VWAP",
        variant: { kind: "SESSION" },
        output: "VALUE",
      });
      return group("vwap-pullback-entry", [
        condition("vwap-trend-side", price(context), direction(context, "GT", "LT"), vwap),
        condition(
          "vwap-touch",
          price(context, context.side === "LONG" ? "low" : "high"),
          direction(context, "LTE", "GTE"),
          vwap,
        ),
        condition(
          "vwap-recovery",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          vwap,
        ),
      ]);
    },
  }),
  entry({
    id: "vwap-mean-reversion",
    name: "VWAP Mean Reversion",
    category: "VWAP",
    description: "VWAP 이격의 percentage, ATR 또는 Z-score를 사용합니다.",
    purpose: "Intraday mean reversion",
    dataRequirements: ["Intraday OHLCV"],
    recommendedRegimes: ["RANGING"],
    parameters: [number("zScore", "Z-score", 2, 0.1, 10, 0.1, "VWAP 이격 표준화 임계값입니다.")],
    keywords: ["VWAP", "mean reversion", "z-score", "ATR distance"],
    create: (context) =>
      group("vwap-mean-reversion-entry", [
        condition(
          "vwap-zscore-extreme",
          indicator(context, { kind: "VWAP", variant: { kind: "SESSION" }, output: "Z_SCORE" }),
          direction(context, "LT", "GT"),
          constant(context.side === "LONG" ? -2 : 2),
        ),
      ]),
  }),
  entry({
    id: "rolling-vwap-breakout",
    name: "Rolling VWAP Breakout",
    category: "VWAP",
    description: "명시적인 Rolling Days VWAP을 가격이 돌파합니다.",
    purpose: "Multi-session volume-weighted trend",
    dataRequirements: ["OHLCV", "Sessions"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("days", "Rolling 일수", 15, 1, 500, "Session VWAP과 구분되는 day window입니다."),
    ],
    keywords: ["VWAP", "rolling", "15일 VWAP"],
    create: (context) =>
      group("rolling-vwap-entry", [
        condition(
          "rolling-vwap-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "VWAP",
            variant: { kind: "ROLLING_DAYS", days: 15 },
            output: "VALUE",
          }),
        ),
      ]),
  }),
  entry({
    id: "volume-confirmed-breakout",
    name: "Volume Confirmed Breakout",
    category: "VOLUME",
    description: "이전 N-bar 가격 돌파와 relative volume을 함께 요구합니다.",
    purpose: "Breakout confirmation",
    dataRequirements: ["OHLCV"],
    recommendedRegimes: ["TRENDING", "VOLATILITY_EXPANSION"],
    parameters: [
      integer("period", "돌파/거래량 기간", 20, 2, 500, "이전 가격·거래량 window입니다."),
      number("relativeVolume", "상대 거래량", 1.5, 0.1, 20, 0.1, "현재/평균 거래량 비율입니다."),
    ],
    keywords: ["volume", "relative volume", "breakout", "거래량"],
    create: (context) =>
      group("volume-breakout-entry", [
        condition(
          "volume-price-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: context.side === "LONG" ? "HIGHEST" : "LOWEST",
            period: 20,
            field: context.side === "LONG" ? "high" : "low",
            excludeCurrent: true,
          }),
        ),
        condition(
          "relative-volume",
          indicator(context, { kind: "RELATIVE_VOLUME", period: 20 }),
          "GT",
          constant(1.5),
        ),
      ]),
  }),
  entry({
    id: "opening-range-breakout",
    name: "Opening Range Breakout",
    category: "BREAKOUT",
    description: "거래소 session open 기준 opening range를 돌파합니다.",
    purpose: "Intraday opening momentum",
    dataRequirements: ["Intraday OHLCV", "Exchange timezone"],
    recommendedRegimes: ["TRENDING", "HIGH_VOLATILITY"],
    parameters: [
      integer("minutes", "Opening Range", 15, 5, 60, "5/15/30/60분 opening range입니다."),
    ],
    keywords: ["opening range", "ORB", "session open"],
    create: (context) =>
      group("opening-range-entry", [
        condition(
          "opening-range-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "OPENING_RANGE",
            minutes: 15,
            output: context.side === "LONG" ? "HIGH" : "LOW",
          }),
        ),
      ]),
  }),
  entry({
    id: "zscore-mean-reversion",
    name: "Z-Score Mean Reversion",
    category: "MEAN_REVERSION",
    description: "가격 Z-score가 극단 구간에 도달하면 평균 회귀를 가정합니다.",
    purpose: "Statistical mean reversion",
    dataRequirements: ["Close"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      integer("period", "Z-score 기간", 20, 2, 500, "평균과 표준편차 기간입니다."),
      number("threshold", "Z-score", 2, 0.1, 10, 0.1, "극단 진입 기준입니다."),
    ],
    keywords: ["z-score", "mean reversion", "통계"],
    create: (context) =>
      group("zscore-entry", [
        condition(
          "zscore-extreme",
          indicator(context, { kind: "ZSCORE", period: 20, source: "close" }),
          direction(context, "LT", "GT"),
          constant(context.side === "LONG" ? -2 : 2),
        ),
      ]),
  }),
  entry({
    id: "bollinger-mean-reversion",
    name: "Bollinger Mean Reversion",
    category: "MEAN_REVERSION",
    description: "가격이 outer band 밖에서 band 내부로 재진입합니다.",
    purpose: "Band re-entry mean reversion",
    dataRequirements: ["Close"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      integer("period", "BB 기간", 20, 2, 500, "Band 기간입니다."),
      number("standardDeviations", "표준편차", 2, 0.1, 10, 0.1, "Outer band 거리입니다."),
    ],
    keywords: ["Bollinger", "re-entry", "mean reversion"],
    create: (context) =>
      group("bollinger-reentry", [
        condition(
          "bollinger-reentry-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "BOLLINGER",
            period: 20,
            standardDeviations: 2,
            output: context.side === "LONG" ? "LOWER" : "UPPER",
          }),
        ),
      ]),
  }),
  entry({
    id: "market-structure-breakout",
    name: "Market Structure Breakout",
    category: "MARKET_STRUCTURE",
    description: "미래 봉 없이 확정된 swing/support/resistance level을 돌파합니다.",
    purpose: "Structure breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("lookback", "Structure 기간", 20, 3, 500, "Structure 탐색 기간입니다."),
      integer("confirmationBars", "확정 봉", 2, 0, 20, "Swing 확정 지연입니다."),
    ],
    keywords: ["market structure", "swing", "pivot", "support", "resistance"],
    create: (context) =>
      group("market-structure-entry", [
        condition(
          "structure-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "MARKET_STRUCTURE",
            lookback: 20,
            leftBars: 2,
            rightBars: 2,
            output: context.side === "LONG" ? "SWING_HIGH" : "SWING_LOW",
          }),
        ),
      ]),
  }),
  entry({
    id: "multi-timeframe-trend-entry",
    name: "Multi-Timeframe Trend Entry",
    category: "TREND",
    description: "완료된 Daily 추세와 primary timeframe 진입 신호를 결합합니다.",
    purpose: "Higher-timeframe confirmation",
    dataRequirements: ["Primary OHLCV", "Completed daily candles"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      ...fastSlow,
      integer(
        "vwapWindow",
        "VWAP window",
        1,
        1,
        500,
        "Primary entry VWAP variant parameter입니다.",
      ),
    ],
    keywords: ["multi-timeframe", "MTF", "daily", "VWAP"],
    create: (context) =>
      group("multi-timeframe-entry", [
        condition(
          "daily-ema-trend",
          indicator(context, { kind: "EMA", period: 20, source: "close" }, "1d"),
          direction(context, "GT", "LT"),
          indicator(context, { kind: "EMA", period: 60, source: "close" }, "1d"),
        ),
        condition(
          "primary-vwap-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, { kind: "VWAP", variant: { kind: "SESSION" }, output: "VALUE" }),
        ),
      ]),
  }),
  entry({
    id: "price-above-moving-average",
    name: "Price Above Moving Average",
    category: "TREND",
    description: "가격과 빠른/느린 이동평균의 정렬을 진입 Rule로 사용합니다.",
    purpose: "Trend alignment entry",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: fastSlow,
    keywords: ["price above MA", "EMA trend", "이평선 위"],
    create: (context) => {
      const fast = indicator(context, { kind: "EMA", period: 20, source: "close" });
      const slow = indicator(context, { kind: "EMA", period: 60, source: "close" });
      return group("price-above-ma-entry", [
        condition("price-fast-ma", price(context), direction(context, "GT", "LT"), fast),
        condition("fast-slow-ma", fast, direction(context, "GT", "LT"), slow),
      ]);
    },
  }),
  entry({
    id: "roc-momentum-breakout",
    name: "ROC Breakout",
    category: "MOMENTUM",
    description: "Rate of Change가 사용자 기준선을 교차할 때 진입합니다.",
    purpose: "Rate-of-change momentum",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("period", "ROC 기간", 10, 1, 500, "변화율 비교 기간입니다."),
      number("threshold", "기준값", 0, -100, 100, 0.1, "ROC 교차 기준입니다."),
    ],
    keywords: ["ROC", "rate of change", "momentum breakout"],
    create: (context) =>
      group("roc-entry", [
        condition(
          "roc-cross",
          indicator(context, { kind: "ROC", period: 10 }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          constant(0),
        ),
      ]),
  }),
  entry({
    id: "momentum-breakout",
    name: "Momentum Breakout",
    category: "MOMENTUM",
    description: "단순 가격 Momentum이 사용자 기준선을 교차할 때 진입합니다.",
    purpose: "Absolute momentum",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("period", "Momentum 기간", 10, 1, 500, "현재 가격과 비교할 과거 기간입니다."),
      number("threshold", "기준값", 0, -1_000_000, 1_000_000, 0.1, "절대 momentum 기준입니다."),
    ],
    keywords: ["momentum", "모멘텀", "price change"],
    create: (context) =>
      group("momentum-entry", [
        condition(
          "momentum-cross",
          indicator(context, { kind: "MOMENTUM", period: 10 }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          constant(0),
        ),
      ]),
  }),
  entry({
    id: "donchian-channel-breakout",
    name: "Donchian Channel Breakout",
    category: "BREAKOUT",
    description: "현재 봉을 제외한 Donchian upper/lower channel을 돌파합니다.",
    purpose: "Channel breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING", "VOLATILITY_EXPANSION"],
    parameters: [
      integer("period", "Donchian 기간", 20, 2, 1_000, "현재 봉을 제외할 channel 기간입니다."),
    ],
    keywords: ["Donchian", "channel", "돈치안"],
    create: (context) =>
      group("donchian-entry", [
        condition(
          "donchian-breakout",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "DONCHIAN",
            period: 20,
            excludeCurrent: true,
            output: context.side === "LONG" ? "UPPER" : "LOWER",
          }),
        ),
      ]),
  }),
  entry({
    id: "ichimoku-cloud-breakout",
    name: "Ichimoku Cloud Breakout",
    category: "ICHIMOKU",
    description: "가격이 source cloud 경계를 교차 돌파할 때 진입합니다.",
    purpose: "Cloud breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("kijunPeriod", "Kijun", 26, 2, 300, "기준선 기간입니다."),
      integer("spanBPeriod", "Span B", 52, 2, 500, "구름 장기 기간입니다."),
    ],
    keywords: ["Ichimoku", "cloud breakout", "구름 돌파"],
    create: (context) =>
      group("ichimoku-cloud-breakout-entry", [
        condition(
          "ichimoku-cloud-break",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "ICHIMOKU",
            tenkanPeriod: 9,
            kijunPeriod: 26,
            spanBPeriod: 52,
            displacement: 26,
            output: context.side === "LONG" ? "CLOUD_TOP_SOURCE" : "CLOUD_BOTTOM_SOURCE",
          }),
        ),
      ]),
  }),
  entry({
    id: "ichimoku-kijun-reclaim",
    name: "Ichimoku Kijun Reclaim / Breakdown",
    category: "ICHIMOKU",
    description: "가격이 Kijun을 재회복하거나 반대 방향으로 이탈할 때 진입합니다.",
    purpose: "Kijun reclaim or breakdown",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING", "RANGING"],
    parameters: [integer("kijunPeriod", "Kijun", 26, 2, 500, "사용자 기준선 기간입니다.")],
    keywords: ["Kijun reclaim", "Kijun breakdown", "기준선 복귀"],
    create: (context) =>
      group("kijun-reclaim-entry", [
        condition(
          "kijun-reclaim",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "ICHIMOKU",
            tenkanPeriod: 9,
            kijunPeriod: 26,
            spanBPeriod: 52,
            displacement: 26,
            output: "KIJUN",
          }),
        ),
      ]),
  }),
  entry({
    id: "vwap-breakdown-entry",
    name: "VWAP Breakdown",
    category: "VWAP",
    description: "가격이 명시한 VWAP 아래로 교차하는 breakdown Rule입니다.",
    purpose: "VWAP downside entry",
    dataRequirements: ["Intraday OHLCV"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      {
        key: "variant",
        label: "VWAP 종류",
        description: "Session과 rolling을 구분합니다.",
        type: "SELECT",
        defaultValue: "SESSION",
        options: ["SESSION", "ROLLING_DAYS"],
      },
    ],
    keywords: ["VWAP breakdown", "VWAP 하향", "short VWAP"],
    create: (context) =>
      group("vwap-breakdown-entry", [
        condition(
          "vwap-breakdown",
          price(context),
          "CROSS_BELOW",
          indicator(context, { kind: "VWAP", variant: { kind: "SESSION" }, output: "VALUE" }),
        ),
      ]),
  }),
  entry({
    id: "weekly-vwap-breakout",
    name: "Weekly VWAP Breakout",
    category: "VWAP",
    description: "거래소 주간 경계로 초기화되는 Weekly VWAP 돌파입니다.",
    purpose: "Weekly volume-weighted trend",
    dataRequirements: ["OHLCV", "Exchange timezone"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      {
        key: "variant",
        label: "VWAP 종류",
        description: "주간 누적 VWAP입니다.",
        type: "SELECT",
        defaultValue: "WEEKLY",
        options: ["WEEKLY"],
      },
    ],
    keywords: ["Weekly VWAP", "주간 VWAP"],
    create: (context) =>
      group("weekly-vwap-entry", [
        condition(
          "weekly-vwap-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, { kind: "VWAP", variant: { kind: "WEEKLY" }, output: "VALUE" }),
        ),
      ]),
  }),
  entry({
    id: "monthly-vwap-breakout",
    name: "Monthly VWAP Breakout",
    category: "VWAP",
    description: "거래소 월간 경계로 초기화되는 Monthly VWAP 돌파입니다.",
    purpose: "Monthly volume-weighted trend",
    dataRequirements: ["OHLCV", "Exchange timezone"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      {
        key: "variant",
        label: "VWAP 종류",
        description: "월간 누적 VWAP입니다.",
        type: "SELECT",
        defaultValue: "MONTHLY",
        options: ["MONTHLY"],
      },
    ],
    keywords: ["Monthly VWAP", "월간 VWAP"],
    create: (context) =>
      group("monthly-vwap-entry", [
        condition(
          "monthly-vwap-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, { kind: "VWAP", variant: { kind: "MONTHLY" }, output: "VALUE" }),
        ),
      ]),
  }),
  entry({
    id: "anchored-vwap-breakout",
    name: "Anchored VWAP Breakout",
    category: "VWAP",
    description: "명시한 ISO anchor 이후 누적한 Anchored VWAP을 돌파합니다.",
    purpose: "Event-anchored trend",
    dataRequirements: ["OHLCV", "Anchor timestamp"],
    recommendedRegimes: ["ALL"],
    parameters: [
      {
        key: "anchor",
        label: "Anchor",
        description: "이벤트 또는 swing 기준 ISO timestamp입니다.",
        type: "SELECT",
        defaultValue: "2000-01-01T00:00:00.000Z",
        options: ["2000-01-01T00:00:00.000Z"],
      },
    ],
    keywords: ["Anchored VWAP", "AVWAP", "앵커 VWAP"],
    create: (context) =>
      group("anchored-vwap-entry", [
        condition(
          "anchored-vwap-cross",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "VWAP",
            variant: { kind: "ANCHORED", anchor: "2000-01-01T00:00:00.000Z" },
            output: "VALUE",
          }),
        ),
      ]),
  }),
  entry({
    id: "vwap-deviation-band-reentry",
    name: "VWAP Standard Deviation Band",
    category: "VWAP",
    description: "VWAP ±Nσ 바깥에서 band 안으로 재진입하는 Rule입니다.",
    purpose: "VWAP band mean reversion",
    dataRequirements: ["Intraday OHLCV"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      number("standardDeviations", "표준편차", 2, 0.1, 10, 0.1, "1σ, 2σ, 3σ 등 band 거리입니다."),
    ],
    keywords: ["VWAP band", "standard deviation", "VWAP σ"],
    create: (context) =>
      group("vwap-band-entry", [
        condition(
          "vwap-band-reentry",
          price(context),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          indicator(context, {
            kind: "VWAP",
            variant: { kind: "SESSION" },
            output: context.side === "LONG" ? "LOWER_BAND" : "UPPER_BAND",
            bandStandardDeviations: 2,
          }),
        ),
      ]),
  }),
  entry({
    id: "rsi-mean-reversion-confirmed",
    name: "RSI Mean Reversion + Price Confirmation",
    category: "MEAN_REVERSION",
    description: "RSI 극단 복귀와 현재 가격 반등을 동시에 요구합니다.",
    purpose: "Confirmed oscillator mean reversion",
    dataRequirements: ["Close"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      integer("period", "RSI 기간", 14, 2, 200, "RSI 기간입니다."),
      number("threshold", "극단 기준", 30, 0, 100, 1, "사용자 oversold/overbought 기준입니다."),
    ],
    keywords: ["RSI mean reversion", "price confirmation", "RSI 가격 반등"],
    create: (context) =>
      group("rsi-confirmed-entry", [
        condition(
          "rsi-return",
          indicator(context, { kind: "RSI", period: 14 }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          constant(context.side === "LONG" ? 30 : 70),
        ),
        condition(
          "price-confirmation",
          price(context),
          direction(context, "GT", "LT"),
          price(context, "close", undefined, 1),
        ),
      ]),
  }),
  entry({
    id: "moving-average-deviation",
    name: "Moving Average Deviation",
    category: "MEAN_REVERSION",
    description: "가격의 SMA/EMA 대비 percentage deviation 극단을 사용합니다.",
    purpose: "Moving-average mean reversion",
    dataRequirements: ["Close"],
    recommendedRegimes: ["RANGING"],
    parameters: [
      integer("period", "평균 기간", 20, 2, 500, "이격도 기준 평균입니다."),
      number("deviationPercent", "이격 %", 5, 0.1, 100, 0.1, "평균에서 벗어난 비율입니다."),
    ],
    keywords: ["MA deviation", "이격도", "moving average deviation"],
    create: (context) =>
      group("ma-deviation-entry", [
        condition(
          "ma-deviation-extreme",
          indicator(context, { kind: "MA_DEVIATION", average: "EMA", period: 20, source: "close" }),
          direction(context, "LT", "GT"),
          constant(context.side === "LONG" ? -5 : 5),
        ),
      ]),
  }),
  entry({
    id: "relative-volume-entry",
    name: "Relative Volume Entry",
    category: "VOLUME",
    description: "현재 거래량/평균 거래량 비율을 독립 진입 Rule로 사용합니다.",
    purpose: "Volume participation entry",
    dataRequirements: ["Volume"],
    recommendedRegimes: ["TRENDING", "HIGH_VOLATILITY"],
    parameters: [
      integer("period", "평균 기간", 20, 2, 500, "거래량 평균 기간입니다."),
      number("multiplier", "상대 거래량", 1.5, 0.1, 100, 0.1, "현재/평균 비율입니다."),
    ],
    keywords: ["Relative Volume", "RVOL", "상대 거래량"],
    create: (context) =>
      group("relative-volume-entry", [
        condition(
          "relative-volume-threshold",
          indicator(context, { kind: "RELATIVE_VOLUME", period: 20 }),
          "GT",
          constant(1.5),
        ),
      ]),
  }),
  entry({
    id: "obv-breakout",
    name: "OBV Trend / Breakout",
    category: "VOLUME",
    description: "OBV가 현재 봉을 제외한 이전 N봉 극값을 돌파합니다.",
    purpose: "Volume-flow breakout",
    dataRequirements: ["Close", "Volume"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("period", "OBV lookback", 20, 2, 500, "현재 봉을 제외한 OBV 극값 기간입니다."),
    ],
    keywords: ["OBV", "on balance volume", "OBV breakout"],
    create: (context) =>
      group("obv-entry", [
        condition(
          "obv-breakout",
          indicator(context, { kind: "OBV", output: "VALUE" }),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "OBV",
            output: context.side === "LONG" ? "PREVIOUS_HIGH" : "PREVIOUS_LOW",
            period: 20,
          }),
        ),
      ]),
  }),
  entry({
    id: "cmf-money-flow",
    name: "Chaikin Money Flow",
    category: "VOLUME",
    description: "CMF가 사용자 기준선 위/아래로 교차할 때 진입합니다.",
    purpose: "Accumulation/distribution flow",
    dataRequirements: ["OHLCV"],
    recommendedRegimes: ["ALL"],
    parameters: [
      integer("period", "CMF 기간", 20, 2, 500, "Chaikin Money Flow 기간입니다."),
      number("threshold", "CMF 기준", 0, -1, 1, 0.01, "0 또는 사용자 기준선입니다."),
    ],
    keywords: ["CMF", "Chaikin Money Flow", "자금 흐름"],
    create: (context) =>
      group("cmf-entry", [
        condition(
          "cmf-cross",
          indicator(context, { kind: "CMF", period: 20 }),
          direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
          constant(0),
        ),
      ]),
  }),
  entry({
    id: "previous-level-breakout",
    name: "Previous High / Low Breakout",
    category: "MARKET_STRUCTURE",
    description: "완료된 직전 high/low level의 돌파를 사용합니다.",
    purpose: "Previous level breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("lookback", "Structure lookback", 20, 2, 500, "이전 구조 탐색 기간입니다."),
    ],
    keywords: ["previous high", "previous low", "전고점", "전저점"],
    create: (context) =>
      group("previous-level-entry", [
        condition(
          "previous-level-break",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "MARKET_STRUCTURE",
            lookback: 20,
            leftBars: 2,
            rightBars: 2,
            output: context.side === "LONG" ? "PREVIOUS_HIGH" : "PREVIOUS_LOW",
          }),
        ),
      ]),
  }),
  entry({
    id: "support-resistance-breakout",
    name: "Support / Resistance Breakout",
    category: "MARKET_STRUCTURE",
    description: "미래 봉 없이 확정된 support/resistance level 돌파입니다.",
    purpose: "Confirmed structure breakout",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("lookback", "Structure lookback", 20, 3, 500, "확정 구조 탐색 기간입니다."),
      integer(
        "confirmationBars",
        "확정 봉",
        2,
        0,
        20,
        "미래정보 대신 실제 확정 지연을 적용합니다.",
      ),
    ],
    keywords: ["support", "resistance", "지지", "저항", "pivot"],
    create: (context) =>
      group("support-resistance-entry", [
        condition(
          "support-resistance-break",
          price(context),
          direction(context, "BREAK_ABOVE", "BREAK_BELOW"),
          indicator(context, {
            kind: "MARKET_STRUCTURE",
            lookback: 20,
            leftBars: 2,
            rightBars: 2,
            output: context.side === "LONG" ? "RESISTANCE" : "SUPPORT",
          }),
        ),
      ]),
  }),
];

export const FILTER_PRESETS_V3: RuleCatalogPreset[] = [
  filter({
    id: "adx-trend-filter",
    name: "ADX Trend Filter",
    category: "TREND",
    description: "ADX가 사용자 임계값보다 강할 때만 허용합니다.",
    purpose: "Trend strength filter",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("period", "ADX 기간", 14, 2, 200, "Wilder 기간입니다."),
      number("threshold", "ADX 임계값", 25, 0, 100, 0.5, "추세 강도 기준입니다."),
    ],
    keywords: ["ADX", "trend filter"],
    create: (context) =>
      group("adx-filter", [
        condition(
          "adx-filter-strength",
          indicator(context, { kind: "ADX", period: 14, output: "ADX" }),
          "GT",
          constant(25),
        ),
      ]),
  }),
  filter({
    id: "ema-trend-filter",
    name: "EMA Trend Filter",
    category: "TREND",
    description: "가격과 두 EMA의 정렬 상태를 확인합니다.",
    purpose: "Directional trend filter",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: fastSlow,
    keywords: ["EMA", "price above moving average"],
    create: (context) =>
      group("ema-filter", [
        condition(
          "price-fast-ema",
          price(context),
          direction(context, "GT", "LT"),
          indicator(context, { kind: "EMA", period: 20, source: "close" }),
        ),
        condition(
          "fast-slow-ema",
          indicator(context, { kind: "EMA", period: 20, source: "close" }),
          direction(context, "GT", "LT"),
          indicator(context, { kind: "EMA", period: 60, source: "close" }),
        ),
      ]),
  }),
  filter({
    id: "higher-timeframe-trend",
    name: "Higher Timeframe Trend",
    category: "TREND",
    description: "완료된 higher timeframe EMA 정렬을 사용합니다.",
    purpose: "MTF confirmation",
    dataRequirements: ["Completed higher-timeframe OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      ...fastSlow,
      {
        key: "timeframe",
        label: "Higher timeframe",
        description: "완료 봉만 사용합니다.",
        type: "TIMEFRAME",
        defaultValue: "1d",
        options: ["60m", "4h", "1d", "1w"],
      },
    ],
    keywords: ["higher timeframe", "daily", "MTF"],
    create: (context) =>
      group("higher-timeframe-filter", [
        condition(
          "higher-ema-trend",
          indicator(context, { kind: "EMA", period: 20, source: "close" }, "1d"),
          direction(context, "GT", "LT"),
          indicator(context, { kind: "EMA", period: 60, source: "close" }, "1d"),
        ),
      ]),
  }),
  filter({
    id: "volume-filter",
    name: "Volume Filter",
    category: "VOLUME",
    description: "현재 거래량을 이전 평균 거래량과 비교합니다.",
    purpose: "Liquidity/participation confirmation",
    dataRequirements: ["Volume"],
    recommendedRegimes: ["ALL"],
    parameters: [
      integer("period", "평균 기간", 20, 2, 500, "이전 volume average 기간입니다."),
      number("multiplier", "거래량 배수", 1.5, 0.1, 20, 0.1, "평균 대비 요구 배수입니다."),
    ],
    keywords: ["volume", "average volume", "거래량"],
    create: (context) =>
      group("volume-filter", [
        condition(
          "volume-average-filter",
          indicator(context, { kind: "RELATIVE_VOLUME", period: 20 }),
          "GT",
          constant(1.5),
        ),
      ]),
  }),
  filter({
    id: "relative-volume-filter",
    name: "Relative Volume",
    category: "VOLUME",
    description: "현재 volume/이전 평균 volume 비율을 사용합니다.",
    purpose: "Relative participation",
    dataRequirements: ["Volume"],
    recommendedRegimes: ["ALL"],
    parameters: [
      integer("period", "평균 기간", 20, 2, 500, "이전 volume 기간입니다."),
      number("ratio", "Relative Volume", 1.5, 0.1, 20, 0.1, "현재/평균 비율입니다."),
    ],
    keywords: ["relative volume", "RVOL"],
    create: (context) =>
      group("relative-volume-filter", [
        condition(
          "relative-volume-ratio",
          indicator(context, { kind: "RELATIVE_VOLUME", period: 20 }),
          "GT",
          constant(1.5),
        ),
      ]),
  }),
  filter({
    id: "atr-volatility-filter",
    name: "ATR Volatility Filter",
    category: "VOLATILITY",
    description: "ATRP 또는 ATR expansion으로 변동성 범위를 제한합니다.",
    purpose: "Volatility eligibility",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["HIGH_VOLATILITY", "LOW_VOLATILITY"],
    parameters: [
      integer("period", "ATR 기간", 14, 2, 500, "ATR 기간입니다."),
      number("minimumAtrp", "최소 ATRP", 1, 0, 100, 0.1, "가격 대비 ATR 비율입니다."),
    ],
    keywords: ["ATR", "ATRP", "volatility filter"],
    create: (context) =>
      group("atr-volatility-filter", [
        condition(
          "atrp-minimum",
          indicator(context, { kind: "ATRP", period: 14 }),
          "GT",
          constant(1),
        ),
      ]),
  }),
  filter({
    id: "bollinger-width-filter",
    name: "Bollinger Band Width",
    category: "VOLATILITY",
    description: "Band width percentile로 squeeze/expansion 상태를 제한합니다.",
    purpose: "Volatility regime filter",
    dataRequirements: ["Close"],
    recommendedRegimes: ["LOW_VOLATILITY", "HIGH_VOLATILITY"],
    parameters: [
      integer("lookback", "Percentile 기간", 120, 20, 1_000, "Width 분포 기간입니다."),
      number("percentile", "Percentile", 20, 0, 100, 1, "허용 percentile입니다."),
    ],
    keywords: ["Bollinger width", "squeeze", "percentile"],
    create: (context) =>
      group("bb-width-filter", [
        condition(
          "bb-width-percentile",
          indicator(context, {
            kind: "BB_WIDTH_PERCENTILE",
            period: 20,
            standardDeviations: 2,
            lookback: 120,
          }),
          "LT",
          constant(20),
        ),
      ]),
  }),
  filter({
    id: "market-regime-filter",
    name: "Market Regime Filter",
    category: "RISK_MANAGEMENT",
    description: "ADX, MA slope, ATRP와 Band width를 조합해 시장 환경을 제한합니다.",
    purpose: "Regime-aware eligibility",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY"],
    parameters: [
      {
        key: "regime",
        label: "Regime",
        description: "권장 환경이며 수익 보장이 아닙니다.",
        type: "SELECT",
        defaultValue: "TRENDING",
        options: ["TRENDING", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY"],
      },
    ],
    keywords: ["regime", "trending", "ranging", "volatility"],
    create: (context) =>
      group("market-regime-filter", [
        condition(
          "regime-adx",
          indicator(context, { kind: "ADX", period: 14, output: "ADX" }),
          "GT",
          constant(25),
        ),
        condition(
          "regime-slope",
          indicator(context, {
            kind: "MA_SLOPE",
            average: "EMA",
            period: 20,
            lookback: 5,
            source: "close",
          }),
          direction(context, "GT", "LT"),
          constant(0),
        ),
      ]),
  }),
];

const conditionExit = (id: string, label: string, rule: RuleGroup, priority = 50): ExitRule[] => [
  { kind: "CONDITION", id, priority, rule: { ...rule, label }, quantityPercent: 100 },
];

export const EXIT_PRESETS_V3: ExitCatalogPreset[] = [
  exit({
    id: "fixed-stop-loss",
    name: "Fixed Stop Loss",
    category: "RISK_MANAGEMENT",
    description: "Entry 기준 percent/absolute/tick 손절입니다.",
    purpose: "Hard risk stop",
    dataRequirements: ["OHLC", "Tick size"],
    recommendedRegimes: ["ALL"],
    parameters: [number("value", "Stop 거리", 2, 0.01, 100, 0.1, "Entry 기준 손절 거리입니다.")],
    keywords: ["stop loss", "fixed stop", "손절"],
    create: () => [
      {
        kind: "FIXED_STOP",
        id: "fixed-stop",
        priority: 10,
        unit: "PERCENT",
        value: 2,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "fixed-take-profit",
    name: "Fixed Take Profit",
    category: "EXIT",
    description: "Entry 기준 고정 수익 목표입니다.",
    purpose: "Profit target",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["ALL"],
    parameters: [number("value", "Target", 5, 0.01, 1_000, 0.1, "Entry 기준 target입니다.")],
    keywords: ["take profit", "target", "익절"],
    create: () => [
      {
        kind: "FIXED_TAKE_PROFIT",
        id: "fixed-target",
        priority: 30,
        unit: "PERCENT",
        value: 5,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "risk-reward-exit",
    name: "Risk Reward Exit",
    category: "EXIT",
    description: "Initial risk의 R 배수로 목표를 계산합니다.",
    purpose: "R-multiple target",
    dataRequirements: ["Initial stop"],
    recommendedRegimes: ["ALL"],
    parameters: [
      number("multiple", "R Multiple", 2, 0.1, 100, 0.1, "1R, 1.5R, 2R 등을 설정합니다."),
    ],
    keywords: ["risk reward", "R multiple"],
    create: () => [
      {
        kind: "RISK_REWARD",
        id: "risk-reward-target",
        priority: 30,
        multiple: 2,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "atr-stop",
    name: "ATR Stop",
    category: "RISK_MANAGEMENT",
    description: "Entry ATR 배수로 initial stop을 정합니다.",
    purpose: "Volatility-adjusted hard stop",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["ALL"],
    parameters: atrParameters,
    keywords: ["ATR stop", "volatility stop"],
    create: () => [
      {
        kind: "ATR_STOP",
        id: "atr-stop",
        priority: 10,
        period: 14,
        multiplier: 2,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "atr-trailing",
    name: "ATR Trailing",
    category: "EXIT",
    description: "가격을 따라 단조롭게 움직이는 ATR trailing stop입니다.",
    purpose: "Trend exit",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: atrParameters,
    keywords: ["ATR trailing", "monotonic"],
    create: () => [
      {
        kind: "ATR_TRAILING",
        id: "atr-trailing",
        priority: 40,
        period: 14,
        multiplier: 2,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "chandelier-exit",
    name: "Chandelier Exit",
    category: "EXIT",
    description: "진입 이후 high/low와 ATR로 stop을 갱신합니다.",
    purpose: "Trend exit",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      ...atrParameters,
      integer("highestPeriod", "High/Low 기간", 22, 2, 500, "Chandelier extreme 기간입니다."),
    ],
    keywords: ["Chandelier", "highest since entry"],
    create: () => [
      {
        kind: "CHANDELIER",
        id: "chandelier",
        priority: 40,
        period: 22,
        atrPeriod: 14,
        multiplier: 3,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "percentage-trailing",
    name: "Percentage Trailing",
    category: "EXIT",
    description: "진입 이후 최고/최저 가격 대비 percentage trailing입니다.",
    purpose: "Simple trailing exit",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [number("percent", "Trailing %", 3, 0.1, 100, 0.1, "고점/저점 대비 거리입니다.")],
    keywords: ["percentage trailing", "peak"],
    create: () => [
      {
        kind: "PERCENTAGE_TRAILING",
        id: "percentage-trailing",
        priority: 40,
        percent: 3,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "break-even-stop",
    name: "Break Even Stop",
    category: "RISK_MANAGEMENT",
    description: "Trigger R 도달 뒤 stop을 entry±offset R로 이동합니다.",
    purpose: "Risk reduction",
    dataRequirements: ["Initial stop"],
    recommendedRegimes: ["ALL"],
    parameters: [
      number("triggerR", "Trigger R", 1, 0.1, 100, 0.1, "Break-even 활성화 R입니다."),
      number("offsetR", "Offset R", 0, -10, 10, 0.1, "Entry에서 추가 확보할 R입니다."),
    ],
    keywords: ["break even", "breakeven", "본전"],
    create: () => [{ kind: "BREAK_EVEN", id: "break-even", priority: 20, triggerR: 1, offsetR: 0 }],
  }),
  exit({
    id: "partial-take-profit",
    name: "Partial Take Profit",
    category: "EXIT",
    description: "한 target에서 포지션 일부만 청산합니다.",
    purpose: "Scale out",
    dataRequirements: ["Initial stop"],
    recommendedRegimes: ["ALL"],
    parameters: [
      number("triggerR", "Target R", 2, 0.1, 100, 0.1, "부분 익절 target입니다."),
      number("quantityPercent", "청산 비율", 50, 0.1, 100, 0.1, "초기 수량 대비 비율입니다."),
    ],
    keywords: ["partial", "scale out", "부분매도"],
    create: () => [
      {
        kind: "SCALE_OUT",
        id: "partial-target",
        priority: 30,
        levels: [
          { id: "partial-2r", trigger: { kind: "R_MULTIPLE", value: 2 }, quantityPercent: 50 },
        ],
      },
    ],
  }),
  exit({
    id: "multi-level-scale-out",
    name: "Multi-Level Scale Out",
    category: "EXIT",
    description: "여러 R/percentage target에서 단계적으로 청산합니다.",
    purpose: "Multi-stage profit taking",
    dataRequirements: ["Initial stop"],
    recommendedRegimes: ["ALL"],
    parameters: [
      number("firstR", "TP1 R", 1, 0.1, 100, 0.1, "첫 target입니다."),
      number("secondR", "TP2 R", 2, 0.1, 100, 0.1, "두 번째 target입니다."),
    ],
    keywords: ["multi-level", "scale out", "TP1", "TP2"],
    create: () => [
      {
        kind: "SCALE_OUT",
        id: "multi-scale",
        priority: 30,
        levels: [
          { id: "scale-1r", trigger: { kind: "R_MULTIPLE", value: 1 }, quantityPercent: 30 },
          { id: "scale-2r", trigger: { kind: "R_MULTIPLE", value: 2 }, quantityPercent: 30 },
        ],
      },
    ],
  }),
  exit({
    id: "ema-breakdown-exit",
    name: "EMA Breakdown",
    category: "EXIT",
    description: "Close가 EMA를 반대 방향으로 교차하면 청산합니다.",
    purpose: "Trend invalidation",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: [integer("period", "EMA 기간", 20, 2, 500, "Exit EMA 기간입니다.")],
    keywords: ["EMA breakdown", "moving average exit"],
    create: (context) =>
      conditionExit(
        "ema-breakdown",
        "EMA breakdown",
        group("ema-breakdown-rule", [
          condition(
            "ema-exit-cross",
            price(context),
            direction(context, "CROSS_BELOW", "CROSS_ABOVE"),
            indicator(context, { kind: "EMA", period: 20, source: "close" }),
          ),
        ]),
      ),
  }),
  exit({
    id: "macd-reversal-exit",
    name: "MACD Reversal",
    category: "EXIT",
    description: "MACD line/signal 반대 교차입니다.",
    purpose: "Momentum reversal exit",
    dataRequirements: ["Close"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("fastPeriod", "Fast", 12, 2, 200, "MACD fast입니다."),
      integer("slowPeriod", "Slow", 26, 3, 500, "MACD slow입니다."),
    ],
    keywords: ["MACD reversal", "dead cross"],
    create: (context) =>
      conditionExit(
        "macd-reversal",
        "MACD reversal",
        group("macd-reversal-rule", [
          condition(
            "macd-exit-cross",
            indicator(context, {
              kind: "MACD",
              fastPeriod: 12,
              slowPeriod: 26,
              signalPeriod: 9,
              output: "LINE",
            }),
            direction(context, "CROSS_BELOW", "CROSS_ABOVE"),
            indicator(context, {
              kind: "MACD",
              fastPeriod: 12,
              slowPeriod: 26,
              signalPeriod: 9,
              output: "SIGNAL",
            }),
          ),
        ]),
      ),
  }),
  exit({
    id: "rsi-reversal-exit",
    name: "RSI Reversal",
    category: "EXIT",
    description: "RSI threshold 또는 반대 교차로 청산합니다.",
    purpose: "Momentum exhaustion",
    dataRequirements: ["Close"],
    recommendedRegimes: ["ALL"],
    parameters: [
      integer("period", "RSI 기간", 14, 2, 200, "RSI 기간입니다."),
      number("threshold", "Threshold", 70, 0, 100, 1, "사용자 설정 threshold입니다."),
    ],
    keywords: ["RSI exit", "overbought", "reversal"],
    create: (context) =>
      conditionExit(
        "rsi-reversal",
        "RSI reversal",
        group("rsi-reversal-rule", [
          condition(
            "rsi-exit-threshold",
            indicator(context, { kind: "RSI", period: 14 }),
            direction(context, "GT", "LT"),
            constant(context.side === "LONG" ? 70 : 30),
          ),
        ]),
      ),
  }),
  exit({
    id: "vwap-breakdown-exit",
    name: "VWAP Breakdown",
    category: "VWAP",
    description: "가격이 선택 VWAP 반대편으로 교차하면 청산합니다.",
    purpose: "Intraday trend invalidation",
    dataRequirements: ["OHLCV"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      integer("days", "Rolling 일수", 15, 1, 500, "Session/Rolling variant를 명시합니다."),
    ],
    keywords: ["VWAP exit", "breakdown"],
    create: (context) =>
      conditionExit(
        "vwap-breakdown",
        "VWAP breakdown",
        group("vwap-breakdown-rule", [
          condition(
            "vwap-exit-cross",
            price(context),
            direction(context, "CROSS_BELOW", "CROSS_ABOVE"),
            indicator(context, { kind: "VWAP", variant: { kind: "SESSION" }, output: "VALUE" }),
          ),
        ]),
      ),
  }),
  exit({
    id: "kijun-breakdown-exit",
    name: "Kijun Breakdown",
    category: "ICHIMOKU",
    description: "Close가 Ichimoku Kijun 반대편으로 교차합니다.",
    purpose: "Ichimoku trend exit",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [integer("kijunPeriod", "Kijun 기간", 26, 2, 500, "기준선 기간입니다.")],
    keywords: ["Kijun", "Ichimoku exit", "기준선"],
    create: (context) =>
      conditionExit(
        "kijun-breakdown",
        "Kijun breakdown",
        group("kijun-rule", [
          condition(
            "kijun-exit-cross",
            price(context),
            direction(context, "CROSS_BELOW", "CROSS_ABOVE"),
            indicator(context, {
              kind: "ICHIMOKU",
              tenkanPeriod: 9,
              kijunPeriod: 26,
              spanBPeriod: 52,
              displacement: 26,
              output: "KIJUN",
            }),
          ),
        ]),
      ),
  }),
  exit({
    id: "ichimoku-cloud-exit",
    name: "Ichimoku Cloud Exit",
    category: "ICHIMOKU",
    description: "가격의 cloud 진입 또는 cloud 반대편 이탈을 사용합니다.",
    purpose: "Cloud trend invalidation",
    dataRequirements: ["OHLC"],
    recommendedRegimes: ["TRENDING"],
    parameters: [integer("kijunPeriod", "Kijun 기간", 26, 2, 500, "Cloud 구성 기간입니다.")],
    keywords: ["Ichimoku cloud exit", "구름"],
    create: (context) =>
      conditionExit(
        "ichimoku-cloud-exit",
        "Ichimoku cloud exit",
        group("ichimoku-cloud-rule", [
          condition(
            "cloud-exit",
            price(context),
            direction(context, "CROSS_BELOW", "CROSS_ABOVE"),
            indicator(context, {
              kind: "ICHIMOKU",
              tenkanPeriod: 9,
              kijunPeriod: 26,
              spanBPeriod: 52,
              displacement: 26,
              output: context.side === "LONG" ? "CLOUD_TOP_SOURCE" : "CLOUD_BOTTOM_SOURCE",
            }),
          ),
        ]),
      ),
  }),
  exit({
    id: "parabolic-sar-exit",
    name: "Parabolic SAR",
    category: "EXIT",
    description: "가격이 SAR 반대편으로 교차할 때 청산합니다.",
    purpose: "Trailing reversal exit",
    dataRequirements: ["High", "Low"],
    recommendedRegimes: ["TRENDING"],
    parameters: [
      number("step", "Acceleration step", 0.02, 0.001, 1, 0.001, "SAR 가속 단계입니다."),
      number("maximum", "Acceleration max", 0.2, 0.01, 1, 0.01, "SAR 가속 최대입니다."),
    ],
    keywords: ["Parabolic SAR", "PSAR"],
    create: (context) =>
      conditionExit(
        "parabolic-sar",
        "Parabolic SAR",
        group("sar-rule", [
          condition(
            "sar-reversal",
            price(context),
            direction(context, "CROSS_BELOW", "CROSS_ABOVE"),
            indicator(context, {
              kind: "PARABOLIC_SAR",
              accelerationStep: 0.02,
              accelerationMaximum: 0.2,
            }),
          ),
        ]),
      ),
  }),
  exit({
    id: "time-stop",
    name: "Time Stop",
    category: "EXIT",
    description: "N bars/days 또는 특정 시간에 청산합니다.",
    purpose: "Maximum holding time",
    dataRequirements: ["Timestamp"],
    recommendedRegimes: ["ALL"],
    parameters: [integer("bars", "보유 봉", 20, 1, 100_000, "최대 보유 봉 수입니다.")],
    keywords: ["time stop", "bars", "days", "clock"],
    create: () => [
      {
        kind: "TIME",
        id: "time-stop",
        priority: 60,
        mode: "BARS",
        value: 20,
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "end-of-session",
    name: "End Of Session",
    category: "EXIT",
    description: "정규 세션 종료 전 청산해 overnight를 금지합니다.",
    purpose: "Intraday flat policy",
    dataRequirements: ["Exchange session", "Timezone"],
    recommendedRegimes: ["ALL"],
    parameters: [
      {
        key: "clock",
        label: "청산 시각",
        description: "거래소 local time입니다.",
        type: "SELECT",
        defaultValue: "SESSION_END",
        options: ["SESSION_END", "15:20", "15:50"],
      },
    ],
    keywords: ["end of session", "no overnight", "장마감"],
    create: () => [
      {
        kind: "TIME",
        id: "end-of-session",
        priority: 60,
        mode: "SESSION_END",
        quantityPercent: 100,
      },
    ],
  }),
  exit({
    id: "opposite-signal-exit",
    name: "Opposite Signal Exit",
    category: "EXIT",
    description: "Entry rule의 반대 방향 신호에서 청산합니다.",
    purpose: "Signal reversal",
    dataRequirements: ["Entry indicators"],
    recommendedRegimes: ["TRENDING"],
    parameters: [],
    keywords: ["opposite signal", "reversal"],
    create: () => [
      { kind: "OPPOSITE_SIGNAL", id: "opposite-signal", priority: 50, quantityPercent: 100 },
    ],
  }),
];

export const STRATEGY_CATALOG_V3: StrategyCatalogPreset[] = [
  ...ENTRY_PRESETS_V3,
  ...FILTER_PRESETS_V3,
  ...EXIT_PRESETS_V3,
];

export function searchStrategyCatalogV3(
  query: string,
  filters?: { role?: StrategyCatalogRole; category?: StrategyCatalogCategory },
): StrategyCatalogPreset[] {
  const term = query.trim().toLocaleLowerCase("ko-KR");
  return STRATEGY_CATALOG_V3.filter((preset) => {
    if (filters?.role && preset.role !== filters.role) return false;
    if (filters?.category && preset.category !== filters.category) return false;
    if (!term) return true;
    return [preset.id, preset.name, preset.description, preset.purpose, ...preset.keywords]
      .join(" ")
      .toLocaleLowerCase("ko-KR")
      .includes(term);
  });
}

function emptyFilters(): RuleGroup {
  return { type: "GROUP", id: "filters", operator: "AND", children: [] };
}

function baselineEntry(context: PresetContext): RuleGroup {
  return group("baseline-entry", [
    condition(
      "baseline-ema-cross",
      indicator(context, { kind: "EMA", period: 9, source: "close" }),
      direction(context, "CROSS_ABOVE", "CROSS_BELOW"),
      indicator(context, { kind: "EMA", period: 21, source: "close" }),
    ),
  ]);
}

function baselineExits(): ExitRule[] {
  return [
    {
      kind: "ATR_STOP",
      id: "baseline-stop",
      priority: 10,
      period: 14,
      multiplier: 2,
      quantityPercent: 100,
    },
    { kind: "RISK_REWARD", id: "baseline-target", priority: 30, multiple: 2, quantityPercent: 100 },
  ];
}

export function createPresetStrategyV3(
  presetId: string,
  instrumentId: InstrumentId,
  options: { timeframe?: StrategyTimeframe; side?: "LONG" | "SHORT" } = {},
): StrategyDefinitionV3 {
  const preset = STRATEGY_CATALOG_V3.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error(`Unknown Strategy v3 preset: ${presetId}`);
  const context: PresetContext = {
    timeframe: options.timeframe ?? "5m",
    side: options.side ?? "LONG",
  };
  if (!preset.supportedSides.includes(context.side)) {
    throw new Error(`${preset.name} does not support ${context.side}.`);
  }
  const market = instrumentId.slice(0, instrumentId.indexOf(":")) as StrategyDefinitionV3["market"];
  getMarketDefaults(market);
  const selectedExits = preset.role === "EXIT" ? preset.create(context) : baselineExits();
  const needsInitialStop = selectedExits.some(
    (item) =>
      item.kind === "RISK_REWARD" || item.kind === "BREAK_EVEN" || item.kind === "SCALE_OUT",
  );
  const exits =
    needsInitialStop &&
    !selectedExits.some((item) => item.kind === "FIXED_STOP" || item.kind === "ATR_STOP")
      ? [baselineExits()[0], ...selectedExits]
      : selectedExits;

  return StrategyDefinitionV3Schema.parse({
    version: 3,
    name: preset.name,
    market,
    instrumentId,
    timeframe: context.timeframe,
    side: context.side,
    entry: preset.role === "ENTRY" ? preset.create(context) : baselineEntry(context),
    filters: preset.role === "FILTER" ? preset.create(context) : emptyFilters(),
    exits,
    positionSizing: { kind: "EQUITY_PERCENT", value: 100 },
    risk: {
      maximumPositions: 1,
      maximumSymbolAllocationPercent: 100,
      maximumDailyLossPercent: 5,
      maximumStrategyDrawdownPercent: 30,
      maximumPortfolioDrawdownPercent: 30,
      consecutiveLossLimit: 8,
    },
    execution: {
      signalAt: "BAR_CLOSE",
      fillAt: "NEXT_BAR_OPEN",
      order: { type: "MARKET" },
      intrabarPolicy: "CONSERVATIVE",
      commissionBps: 1.5,
      slippageBps: 5,
      spreadBps: 2,
      minimumTick: market === "KOSPI" || market === "KOSDAQ" || market === "KR_ETC" ? 1 : 0.01,
      startingCapital:
        market === "KOSPI" || market === "KOSDAQ" || market === "KR_ETC" ? 10_000_000 : 100_000,
    },
    overlays: [],
  });
}

export function createVwapIchimokuStrategyV3(
  instrumentId: InstrumentId,
  options: { timeframe?: StrategyTimeframe; side?: "LONG" | "SHORT" } = {},
): StrategyDefinitionV3 {
  const strategy = createPresetStrategyV3("rolling-vwap-breakout", instrumentId, options);
  const context: PresetContext = { timeframe: strategy.timeframe, side: strategy.side };
  const kijun = EXIT_PRESETS_V3.find((preset) => preset.id === "kijun-breakdown-exit")!;
  const trailing = EXIT_PRESETS_V3.find((preset) => preset.id === "atr-trailing")!;
  return StrategyDefinitionV3Schema.parse({
    ...strategy,
    name: "VWAP Breakout + Ichimoku Exit",
    exits: [...kijun.create(context), ...trailing.create(context)],
    overlays: [
      {
        id: "rolling-vwap-overlay",
        label: "Rolling 15-Day VWAP",
        operand: indicator(context, {
          kind: "VWAP",
          variant: { kind: "ROLLING_DAYS", days: 15 },
          output: "VALUE",
        }),
      },
      {
        id: "kijun-overlay",
        label: "Ichimoku Kijun",
        operand: indicator(context, {
          kind: "ICHIMOKU",
          tenkanPeriod: 9,
          kijunPeriod: 26,
          spanBPeriod: 52,
          displacement: 26,
          output: "KIJUN",
        }),
      },
    ],
  });
}
