import { z } from "zod";

import { ResearchStrategySchema } from "./advanced-strategy";
import { InstrumentSnapshotSchema } from "./stored-strategy";
import { StrategySchema } from "./strategy";
import { StrategyDefinitionV3Schema, StrategyTimeframeSchema } from "./strategy-v3/schema";

export const BacktestRunSummarySchema = z
  .object({
    kind: z.enum(["strategy_v1", "research_v2", "strategy_v3"]),
    totalReturnPercent: z.number().finite(),
    maxDrawdownPercent: z.number().finite(),
    sharpeRatio: z.number().finite(),
    trades: z.number().int().nonnegative(),
    periodStart: z.string().min(1).max(40),
    periodEnd: z.string().min(1).max(40),
    runCount: z.number().int().positive().optional(),
    baselineLabel: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export type BacktestRunSummary = z.infer<typeof BacktestRunSummarySchema>;

const StrategySnapshotSchema = z.union([
  StrategySchema,
  ResearchStrategySchema,
  StrategyDefinitionV3Schema,
]);
const JsonObjectSchema = z.record(z.string(), z.unknown());

export const NewBacktestRunSchema = z
  .object({
    strategyId: z.uuid(),
    strategyName: z.string().trim().min(1).max(100),
    strategyRevision: z.number().int().positive(),
    strategyVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    instrumentId: z.string().trim().min(1).max(80),
    market: z.string().trim().min(1).max(30),
    timeframe: StrategyTimeframeSchema,
    engineVersion: z.string().trim().min(1).max(40),
    strategySnapshot: StrategySnapshotSchema,
    instrumentSnapshot: InstrumentSnapshotSchema,
    summary: BacktestRunSummarySchema,
    result: JsonObjectSchema,
  })
  .strict();
export type NewBacktestRun = z.infer<typeof NewBacktestRunSchema>;

export const StoredBacktestRunSchema = z
  .object({
    id: z.uuid(),
    strategyId: z.uuid().nullable(),
    strategyName: z.string().trim().min(1).max(100),
    strategyRevision: z.number().int().positive(),
    strategyVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    instrumentId: z.string().trim().min(1).max(80),
    market: z.string().trim().min(1).max(30),
    timeframe: StrategyTimeframeSchema,
    engineVersion: z.string().trim().min(1).max(40),
    strategySnapshot: StrategySnapshotSchema,
    instrumentSnapshot: InstrumentSnapshotSchema,
    summary: BacktestRunSummarySchema,
    result: JsonObjectSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type StoredBacktestRun = z.infer<typeof StoredBacktestRunSchema>;

export const BacktestRunListItemSchema = StoredBacktestRunSchema.omit({
  strategySnapshot: true,
  instrumentSnapshot: true,
  result: true,
});
export type BacktestRunListItem = z.infer<typeof BacktestRunListItemSchema>;

export function toBacktestRunListItem(run: StoredBacktestRun): BacktestRunListItem {
  return BacktestRunListItemSchema.parse({
    id: run.id,
    strategyId: run.strategyId,
    strategyName: run.strategyName,
    strategyRevision: run.strategyRevision,
    strategyVersion: run.strategyVersion,
    instrumentId: run.instrumentId,
    market: run.market,
    timeframe: run.timeframe,
    engineVersion: run.engineVersion,
    summary: run.summary,
    createdAt: run.createdAt,
  });
}

export interface BacktestHistoryRepository {
  create(input: NewBacktestRun): Promise<StoredBacktestRun>;
  list(strategyId: string, limit: number): Promise<BacktestRunListItem[]>;
  listAll(limit: number, existingStrategyIds?: readonly string[]): Promise<BacktestRunListItem[]>;
  get(id: string): Promise<StoredBacktestRun | null>;
  delete(id: string): Promise<boolean>;
  detachStrategy(strategyId: string): Promise<number>;
  detachMissingStrategies(existingStrategyIds: readonly string[]): Promise<number>;
}
