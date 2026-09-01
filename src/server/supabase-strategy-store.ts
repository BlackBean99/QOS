import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  NewStoredStrategySchema,
  MAX_STORED_STRATEGIES,
  StoredStrategySchema,
  StrategyExportSchema,
  UpdateStoredStrategySchema,
  type NewStoredStrategy,
  type StoredStrategy,
  type StrategyExport,
  type UpdateStoredStrategy,
} from "@/src/domain/stored-strategy";
import { StrategyStoreError, type StrategyRepository } from "./strategy-store";
import { SupabaseRestClient, type SupabaseRestOptions } from "./supabase-rest";

const StrategyRowSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    name: z.string(),
    description: z.string(),
    instrument_id: z.string(),
    market: z.string(),
    timeframe: z.string(),
    document: NewStoredStrategySchema,
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

const DeletedRowSchema = z.object({ id: z.uuid() }).strict();

interface SupabaseStrategyStoreOptions extends SupabaseRestOptions {
  now?: () => Date;
  createId?: () => string;
}

function fromRow(row: z.infer<typeof StrategyRowSchema>): StoredStrategy {
  return StoredStrategySchema.parse({
    id: row.id,
    revision: row.revision,
    ...row.document,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRow(document: StoredStrategy) {
  const { id, revision, createdAt, updatedAt, ...body } = document;
  return {
    id,
    revision,
    name: document.name,
    description: document.description,
    instrument_id: document.instrument.instrumentId,
    market: document.instrument.market,
    timeframe: document.strategy.timeframe,
    document: body,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export class SupabaseStrategyStore implements StrategyRepository {
  readonly #client: SupabaseRestClient;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: SupabaseStrategyStoreOptions) {
    this.#client = new SupabaseRestClient(options);
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  #rows(value: unknown): StoredStrategy[] {
    const parsed = z.array(StrategyRowSchema).safeParse(value);
    if (!parsed.success) {
      throw new StrategyStoreError("invalid_response", "Supabase strategy rows failed validation.");
    }
    try {
      return parsed.data.map(fromRow);
    } catch (error) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase strategy document failed validation.",
        {
          cause: error,
        },
      );
    }
  }

  async list(): Promise<StoredStrategy[]> {
    const query = new URLSearchParams({
      select: "*",
      order: "updated_at.desc,id.asc",
      limit: "500",
    });
    const strategies = this.#rows(
      await this.#client.request(`qos_strategies?${query}`, { method: "GET" }, true),
    );
    if (strategies.length === 500) {
      const overflow = new URLSearchParams({
        select: "*",
        order: "updated_at.desc,id.asc",
        limit: "1",
        offset: "500",
      });
      const extra = this.#rows(
        await this.#client.request(`qos_strategies?${overflow}`, { method: "GET" }, true),
      );
      if (extra.length > 0) {
        throw new StrategyStoreError("store_too_large", "Supabase strategy store is too large.");
      }
    }
    return strategies;
  }

  async listIds(): Promise<string[]> {
    const query = new URLSearchParams({
      select: "id",
      order: "updated_at.desc,id.asc",
      limit: "501",
    });
    const parsed = z
      .array(z.object({ id: z.uuid() }).strict())
      .safeParse(await this.#client.request(`qos_strategies?${query}`, { method: "GET" }, true));
    if (!parsed.success) {
      throw new StrategyStoreError("invalid_response", "Supabase strategy ids failed validation.");
    }
    if (parsed.data.length > MAX_STORED_STRATEGIES) {
      throw new StrategyStoreError("store_too_large", "Supabase strategy store is too large.");
    }
    return parsed.data.map((row) => row.id);
  }

  async get(id: string): Promise<StoredStrategy | null> {
    const query = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
    const rows = this.#rows(
      await this.#client.request(`qos_strategies?${query}`, { method: "GET" }, true),
    );
    return rows[0] ?? null;
  }

  async create(input: NewStoredStrategy): Promise<StoredStrategy> {
    const document = NewStoredStrategySchema.safeParse(input);
    if (!document.success) {
      throw new StrategyStoreError("invalid_document", "New strategy failed validation.");
    }
    const timestamp = this.#now().toISOString();
    const created = StoredStrategySchema.parse({
      id: this.#createId(),
      revision: 1,
      ...document.data,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const rows = this.#rows(
      await this.#client.request("qos_strategies?select=*", {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(toRow(created)),
      }),
    );
    if (rows.length !== 1) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase did not return the created strategy.",
      );
    }
    return rows[0];
  }

  async update(id: string, input: UpdateStoredStrategy): Promise<StoredStrategy> {
    const document = UpdateStoredStrategySchema.safeParse(input);
    if (!document.success) {
      throw new StrategyStoreError("invalid_document", "Updated strategy failed validation.");
    }
    const { expectedRevision, ...replacement } = document.data;
    const updatedAt = this.#now().toISOString();
    const query = new URLSearchParams({
      select: "*",
      id: `eq.${id}`,
      revision: `eq.${expectedRevision}`,
    });
    const rows = this.#rows(
      await this.#client.request(`qos_strategies?${query}`, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          revision: expectedRevision + 1,
          name: replacement.name,
          description: replacement.description,
          instrument_id: replacement.instrument.instrumentId,
          market: replacement.instrument.market,
          timeframe: replacement.strategy.timeframe,
          document: replacement,
          updated_at: updatedAt,
        }),
      }),
    );
    if (rows.length === 1) return rows[0];
    throw new StrategyStoreError("revision_conflict", "Stored strategy revision changed.");
  }

  async delete(id: string, expectedRevision: number): Promise<boolean> {
    const query = new URLSearchParams({
      select: "id",
      id: `eq.${id}`,
      revision: `eq.${expectedRevision}`,
    });
    const value = await this.#client.request(`qos_strategies?${query}`, {
      method: "DELETE",
      headers: { prefer: "return=representation" },
    });
    const removed = z.array(DeletedRowSchema).safeParse(value);
    if (!removed.success) {
      throw new StrategyStoreError(
        "invalid_response",
        "Supabase delete response failed validation.",
      );
    }
    if (removed.data.length === 1) return true;
    const current = await this.get(id);
    if (!current) return false;
    throw new StrategyStoreError("revision_conflict", "Stored strategy revision changed.");
  }

  async exportAll(): Promise<StrategyExport> {
    return StrategyExportSchema.parse({
      version: 1,
      exportedAt: this.#now().toISOString(),
      strategies: await this.list(),
    });
  }

  async import(
    value: unknown,
    mode: "reject" | "replace" | "clone" = "reject",
  ): Promise<{ imported: number; ids: string[] }> {
    if (mode === "replace") {
      throw new StrategyStoreError(
        "invalid_document",
        "Remote replace import is disabled; use revision-checked updates.",
      );
    }
    const parsed = StrategyExportSchema.safeParse(value);
    if (!parsed.success) {
      throw new StrategyStoreError(
        "invalid_document",
        "Imported strategy document failed validation.",
      );
    }
    const existing = new Map((await this.list()).map((strategy) => [strategy.id, strategy]));
    const timestamp = this.#now().toISOString();
    const incoming = parsed.data.strategies.map((strategy) => {
      const collision = existing.get(strategy.id);
      if (mode === "clone") {
        return {
          ...strategy,
          id: this.#createId(),
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }
      if (collision && mode === "reject") {
        throw new StrategyStoreError("id_conflict", "Stored strategy id already exists.");
      }
      return strategy;
    });
    if (incoming.length === 0) return { imported: 0, ids: [] };
    const query = new URLSearchParams({ select: "*" });
    const rows = this.#rows(
      await this.#client.request(`qos_strategies?${query}`, {
        method: "POST",
        headers: {
          prefer: "return=representation",
        },
        body: JSON.stringify(incoming.map(toRow)),
      }),
    );
    if (rows.length !== incoming.length) {
      throw new StrategyStoreError("invalid_response", "Supabase import count did not match.");
    }
    return { imported: rows.length, ids: rows.map((strategy) => strategy.id) };
  }
}
