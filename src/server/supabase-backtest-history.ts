import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  BacktestRunListItemSchema,
  BacktestRunSummarySchema,
  NewBacktestRunSchema,
  StoredBacktestRunSchema,
  type BacktestHistoryRepository,
  type BacktestRunListItem,
  type NewBacktestRun,
  type StoredBacktestRun,
} from "@/src/domain/strategy-history";
import { StrategyTimeframeSchema } from "@/src/domain/strategy-v3/schema";
import { StrategyStoreError } from "./strategy-store";
import { SupabaseRestClient, type SupabaseRestOptions } from "./supabase-rest";

const SummaryRowSchema = z
  .object({
    id: z.uuid(),
    strategy_id: z.uuid().nullable(),
    strategy_name: z.string(),
    strategy_revision: z.number().int().positive(),
    strategy_version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    instrument_id: z.string(),
    market: z.string(),
    timeframe: StrategyTimeframeSchema,
    engine_version: z.string(),
    summary: BacktestRunSummarySchema,
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

const FullRowSchema = SummaryRowSchema.extend({
  strategy_snapshot: z.record(z.string(), z.unknown()),
  instrument_snapshot: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
}).strict();

const DeletedRowSchema = z.object({ id: z.uuid() }).strict();

interface SupabaseBacktestHistoryOptions extends SupabaseRestOptions {
  now?: () => Date;
  createId?: () => string;
}

function fromSummaryRow(row: z.infer<typeof SummaryRowSchema>): BacktestRunListItem {
  return BacktestRunListItemSchema.parse({
    id: row.id,
    strategyId: row.strategy_id,
    strategyName: row.strategy_name,
    strategyRevision: row.strategy_revision,
    strategyVersion: row.strategy_version,
    instrumentId: row.instrument_id,
    market: row.market,
    timeframe: row.timeframe,
    engineVersion: row.engine_version,
    summary: row.summary,
    createdAt: row.created_at,
  });
}

function fromFullRow(row: z.infer<typeof FullRowSchema>): StoredBacktestRun {
  return StoredBacktestRunSchema.parse({
    ...fromSummaryRow(row),
    strategySnapshot: row.strategy_snapshot,
    instrumentSnapshot: row.instrument_snapshot,
    result: row.result,
  });
}

function toRow(run: StoredBacktestRun) {
  return {
    id: run.id,
    strategy_id: run.strategyId,
    strategy_name: run.strategyName,
    strategy_revision: run.strategyRevision,
    strategy_version: run.strategyVersion,
    instrument_id: run.instrumentId,
    market: run.market,
    timeframe: run.timeframe,
    engine_version: run.engineVersion,
    strategy_snapshot: run.strategySnapshot,
    instrument_snapshot: run.instrumentSnapshot,
    summary: run.summary,
    result: run.result,
    created_at: run.createdAt,
  };
}

export class SupabaseBacktestHistoryStore implements BacktestHistoryRepository {
  readonly #client: SupabaseRestClient;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: SupabaseBacktestHistoryOptions) {
    this.#client = new SupabaseRestClient(options);
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  #fullRows(value: unknown): StoredBacktestRun[] {
    const parsed = z.array(FullRowSchema).safeParse(value);
    if (!parsed.success) {
      throw new StrategyStoreError("invalid_response", "Supabase backtest rows failed validation.");
    }
    try {
      return parsed.data.map(fromFullRow);
    } catch (error) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase backtest data failed validation.",
        {
          cause: error,
        },
      );
    }
  }

  async create(input: NewBacktestRun): Promise<StoredBacktestRun> {
    const parsed = NewBacktestRunSchema.safeParse(input);
    if (!parsed.success) {
      throw new StrategyStoreError("invalid_document", "Backtest run failed validation.");
    }
    const run = StoredBacktestRunSchema.parse({
      id: this.#createId(),
      ...parsed.data,
      createdAt: this.#now().toISOString(),
    });
    const rows = this.#fullRows(
      await this.#client.request("qos_backtest_runs?select=*", {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(toRow(run)),
      }),
    );
    if (rows.length !== 1) {
      throw new StrategyStoreError("invalid_response", "Supabase did not return the backtest run.");
    }
    return rows[0];
  }

  async #list(strategyId: string | null, limit: number): Promise<BacktestRunListItem[]> {
    const select = [
      "id",
      "strategy_id",
      "strategy_name",
      "strategy_revision",
      "strategy_version",
      "instrument_id",
      "market",
      "timeframe",
      "engine_version",
      "summary",
      "created_at",
    ].join(",");
    const query = new URLSearchParams({
      select,
      order: "created_at.desc",
      limit: String(Math.min(50, Math.max(1, limit))),
    });
    if (strategyId) query.set("strategy_id", `eq.${strategyId}`);
    const value = await this.#client.request(`qos_backtest_runs?${query}`, { method: "GET" }, true);
    const parsed = z.array(SummaryRowSchema).safeParse(value);
    if (!parsed.success) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase backtest summaries failed validation.",
      );
    }
    try {
      return parsed.data.map(fromSummaryRow);
    } catch (error) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase backtest summary failed validation.",
        {
          cause: error,
        },
      );
    }
  }

  list(strategyId: string, limit: number): Promise<BacktestRunListItem[]> {
    return this.#list(strategyId, limit);
  }

  listAll(limit: number): Promise<BacktestRunListItem[]> {
    return this.#list(null, limit);
  }

  async get(id: string): Promise<StoredBacktestRun | null> {
    const query = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
    const rows = this.#fullRows(
      await this.#client.request(`qos_backtest_runs?${query}`, { method: "GET" }, true),
    );
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const query = new URLSearchParams({ select: "id", id: `eq.${id}` });
    const parsed = z.array(DeletedRowSchema).safeParse(
      await this.#client.request(`qos_backtest_runs?${query}`, {
        method: "DELETE",
        headers: { prefer: "return=representation" },
      }),
    );
    if (!parsed.success) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase backtest delete failed validation.",
      );
    }
    return parsed.data.length === 1;
  }

  async detachStrategy(): Promise<number> {
    // The qos_backtest_runs FK performs ON DELETE SET NULL in the same database transaction.
    return 0;
  }

  async detachMissingStrategies(): Promise<number> {
    // Supabase enforces the relationship with ON DELETE SET NULL. There cannot be a linked row
    // whose strategy is absent, so a client-side scan would only add redundant network requests.
    return 0;
  }
}
