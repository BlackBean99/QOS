import { z } from "zod";

import { ResearchStrategySchema } from "./advanced-strategy";
import { InstrumentIdSchema, MarketSchema, type InstrumentSummary } from "./instruments";
import { StrategySchema } from "./strategy";
import { StrategyDefinitionV3Schema, StrategyTimeframeSchema } from "./strategy-v3/schema";
import {
  ChartIndicatorSchema,
  IndicatorInstanceSchema,
  type ChartIndicator,
} from "./chart-indicators";

export const MAX_STRATEGY_DOCUMENT_BYTES = 5 * 1024 * 1024 - 64 * 1024;
export const MAX_STRATEGY_IMPORT_REQUEST_BYTES = MAX_STRATEGY_DOCUMENT_BYTES + 64 * 1024;

export { ChartIndicatorSchema, type ChartIndicator };

export const DrawingKindSchema = z.enum([
  "trend_line",
  "straight_line",
  "ray",
  "horizontal_ray",
  "horizontal_segment",
  "horizontal_line",
  "vertical_ray",
  "vertical_segment",
  "vertical_line",
  "parallel_lines",
  "price_channel",
  "price_line",
  "brush",
  "rectangle",
  "fibonacci",
  "pitchfork",
  "fan",
  "annotation",
  "tag",
]);
export type DrawingKind = z.infer<typeof DrawingKindSchema>;

export const DrawingPointSchema = z
  .object({
    timestamp: z.iso.datetime({ offset: true }),
    value: z.number().finite(),
  })
  .strict();

export const SavedDrawingSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    kind: DrawingKindSchema,
    points: z.array(DrawingPointSchema).min(1).max(64),
  })
  .strict()
  .superRefine((drawing, context) => {
    const onePoint = ["horizontal_line", "vertical_line", "price_line", "annotation", "tag"];
    const threePoint = ["pitchfork", "parallel_lines", "price_channel"];
    const minimum = onePoint.includes(drawing.kind) ? 1 : threePoint.includes(drawing.kind) ? 3 : 2;
    if (drawing.points.length < minimum) {
      context.addIssue({
        code: "custom",
        path: ["points"],
        message: `${drawing.kind} drawing에는 ${minimum}개 이상의 점이 필요합니다.`,
      });
    }
  });
export type SavedDrawing = z.infer<typeof SavedDrawingSchema>;

const VisibleRangeSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((range) => Date.parse(range.from) < Date.parse(range.to), {
    message: "차트 시작 시각은 종료 시각보다 빨라야 합니다.",
  });

export const ChartSettingsSchema = z
  .object({
    version: z.literal(1),
    period: z.enum(["1m", "5m", "1d"]),
    theme: z.literal("upbit-light"),
    mainIndicators: z
      .array(z.enum(["MA", "SMA", "EMA", "BOLL", "FRACTAL", "VWAP", "ICHIMOKU"]))
      .max(7),
    subIndicators: z.array(z.enum(["VOL", "RSI", "MACD", "STOCH_RSI"])).max(4),
    indicatorInstances: z.array(IndicatorInstanceSchema).max(120).optional(),
    drawings: z.array(SavedDrawingSchema).max(200),
    visibleRange: VisibleRangeSchema.nullable(),
  })
  .strict()
  .superRefine((chart, context) => {
    if (new Set(chart.mainIndicators).size !== chart.mainIndicators.length) {
      context.addIssue({
        code: "custom",
        path: ["mainIndicators"],
        message: "지표는 중복할 수 없습니다.",
      });
    }
    if (new Set(chart.subIndicators).size !== chart.subIndicators.length) {
      context.addIssue({
        code: "custom",
        path: ["subIndicators"],
        message: "지표는 중복할 수 없습니다.",
      });
    }
    const indicatorIds = chart.indicatorInstances?.map((indicator) => indicator.id) ?? [];
    if (new Set(indicatorIds).size !== indicatorIds.length) {
      context.addIssue({
        code: "custom",
        path: ["indicatorInstances"],
        message: "indicator instance id는 고유해야 합니다.",
      });
    }
    const drawingIds = chart.drawings.map((drawing) => drawing.id);
    if (new Set(drawingIds).size !== drawingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["drawings"],
        message: "drawing id는 고유해야 합니다.",
      });
    }
  });

export type ChartSettings = z.infer<typeof ChartSettingsSchema>;

export const InstrumentSnapshotSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    market: MarketSchema,
    symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,31}$/),
    displayName: z.string().trim().min(1).max(160),
    currency: z.enum(["KRW", "USD"]),
    timezone: z.enum(["Asia/Seoul", "America/New_York"]),
    synthetic: z.boolean(),
    securityType: z.string().trim().min(1).max(60).optional(),
    isinCode: z.string().trim().min(1).max(32).optional(),
  })
  .strict()
  .superRefine((instrument, context) => {
    if (instrument.instrumentId !== `${instrument.market}:${instrument.symbol}`) {
      context.addIssue({
        code: "custom",
        path: ["instrumentId"],
        message: "instrumentId, market과 symbol이 일치해야 합니다.",
      });
    }
    const korean = ["KOSPI", "KOSDAQ", "KR_ETC"].includes(instrument.market);
    if (
      (korean && (instrument.currency !== "KRW" || instrument.timezone !== "Asia/Seoul")) ||
      (!korean && (instrument.currency !== "USD" || instrument.timezone !== "America/New_York"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "시장, 통화와 시간대가 일치해야 합니다.",
      });
    }
  });
export type InstrumentSnapshot = z.infer<typeof InstrumentSnapshotSchema>;

export function createInstrumentSnapshot(instrument: InstrumentSummary): InstrumentSnapshot {
  return InstrumentSnapshotSchema.parse({
    instrumentId: instrument.instrumentId,
    market: instrument.market,
    symbol: instrument.symbol,
    displayName: instrument.displayName,
    currency: instrument.currency,
    timezone: instrument.timezone,
    synthetic: instrument.synthetic,
    securityType: instrument.securityType,
    isinCode: instrument.isinCode,
  });
}

export const MonitorTargetControlSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    enabled: z.boolean(),
    hedgeInstrument: InstrumentSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((control, context) => {
    if (control.hedgeInstrument?.instrumentId === control.instrumentId) {
      context.addIssue({
        code: "custom",
        path: ["hedgeInstrument"],
        message: "헷지 종목은 원본 감시 종목과 달라야 합니다.",
      });
    }
  });
export type MonitorTargetControl = z.infer<typeof MonitorTargetControlSchema>;

export const MonitorSettingsSchema = z
  .object({
    enabled: z.boolean(),
    interval: StrategyTimeframeSchema,
    targets: z.array(InstrumentSnapshotSchema).max(50).optional(),
    targetControls: z.array(MonitorTargetControlSchema).max(50).optional(),
  })
  .strict()
  .superRefine((monitor, context) => {
    const identifiers = monitor.targets?.map((target) => target.instrumentId) ?? [];
    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "감시 대상 종목은 중복할 수 없습니다.",
      });
    }
    const controlIds = monitor.targetControls?.map((control) => control.instrumentId) ?? [];
    if (new Set(controlIds).size !== controlIds.length) {
      context.addIssue({
        code: "custom",
        path: ["targetControls"],
        message: "감시 대상 제어는 종목별로 하나만 저장할 수 있습니다.",
      });
    }
    if (monitor.targets) {
      const targetIds = new Set(identifiers);
      monitor.targetControls?.forEach((control, index) => {
        if (!targetIds.has(control.instrumentId)) {
          context.addIssue({
            code: "custom",
            path: ["targetControls", index, "instrumentId"],
            message: "감시 대상 제어는 저장된 감시 대상 종목만 참조할 수 있습니다.",
          });
        }
      });
    }
  });

const ExecutableStrategySchema = z.union([
  StrategySchema,
  ResearchStrategySchema,
  StrategyDefinitionV3Schema,
]);

const NewStoredStrategyShape = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  instrument: InstrumentSnapshotSchema,
  strategy: ExecutableStrategySchema,
  chart: ChartSettingsSchema,
  monitor: MonitorSettingsSchema,
};

function validateStrategyDocument(
  document: {
    instrument: z.infer<typeof InstrumentSnapshotSchema>;
    strategy: z.infer<typeof ExecutableStrategySchema>;
    monitor: z.infer<typeof MonitorSettingsSchema>;
  },
  context: z.RefinementCtx,
): void {
  if (
    document.instrument.instrumentId !== document.strategy.instrumentId ||
    document.instrument.market !== document.strategy.market
  ) {
    context.addIssue({
      code: "custom",
      path: ["instrument"],
      message: "저장 종목 snapshot과 전략 종목이 일치해야 합니다.",
    });
  }
  if (document.monitor.interval !== document.strategy.timeframe) {
    context.addIssue({
      code: "custom",
      path: ["monitor", "interval"],
      message: "감시 주기는 전략 주기와 일치해야 합니다.",
    });
  }
  const targets =
    document.monitor.targets && document.monitor.targets.length > 0
      ? document.monitor.targets
      : [document.instrument];
  const targetIds = new Set(targets.map((target) => target.instrumentId));
  document.monitor.targetControls?.forEach((control, index) => {
    if (!targetIds.has(control.instrumentId)) {
      context.addIssue({
        code: "custom",
        path: ["monitor", "targetControls", index, "instrumentId"],
        message: "감시 대상 제어는 실제 감시 대상 종목만 참조할 수 있습니다.",
      });
    }
  });
}

export const NewStoredStrategySchema = z
  .object(NewStoredStrategyShape)
  .strict()
  .superRefine((document, context) => {
    validateStrategyDocument(document, context);
  });

export type NewStoredStrategy = z.infer<typeof NewStoredStrategySchema>;

export const StoredStrategySchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    ...NewStoredStrategyShape,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((document, context) => {
    validateStrategyDocument(document, context);
    if (Date.parse(document.createdAt) > Date.parse(document.updatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt은 createdAt보다 빠를 수 없습니다.",
      });
    }
  });

export type StoredStrategy = z.infer<typeof StoredStrategySchema>;

export const UpdateStoredStrategySchema = z
  .object({ expectedRevision: z.number().int().positive(), ...NewStoredStrategyShape })
  .strict()
  .superRefine((document, context) => {
    validateStrategyDocument(document, context);
  });
export type UpdateStoredStrategy = z.infer<typeof UpdateStoredStrategySchema>;

export const MAX_STORED_STRATEGIES = 500;

export const StoredStrategyEnvelopeSchema = z
  .object({
    version: z.literal(1),
    strategies: z.array(StoredStrategySchema).max(MAX_STORED_STRATEGIES),
  })
  .strict()
  .superRefine((envelope, context) => {
    const ids = envelope.strategies.map((strategy) => strategy.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["strategies"],
        message: "전략 id는 고유해야 합니다.",
      });
    }
  });

export const StrategyExportSchema = StoredStrategyEnvelopeSchema.extend({
  exportedAt: z.iso.datetime({ offset: true }),
}).strict();
export type StrategyExport = z.infer<typeof StrategyExportSchema>;
