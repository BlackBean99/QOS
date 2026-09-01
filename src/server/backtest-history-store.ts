import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  NewBacktestRunSchema,
  StoredBacktestRunSchema,
  toBacktestRunListItem,
  type BacktestHistoryRepository,
  type BacktestRunListItem,
  type NewBacktestRun,
  type StoredBacktestRun,
} from "@/src/domain/strategy-history";
import { StrategyStoreError } from "./strategy-store";

const MAX_HISTORY_BYTES = 50 * 1024 * 1024;
const BacktestHistoryEnvelopeSchema = z
  .object({ version: z.literal(1), runs: z.array(StoredBacktestRunSchema).max(2_000) })
  .strict();

interface BacktestHistoryStoreOptions {
  filePath?: string;
  now?: () => Date;
  createId?: () => string;
  maximumBytes?: number;
}

export class BacktestHistoryStore implements BacktestHistoryRepository {
  readonly #filePath: string;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #maximumBytes: number;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: BacktestHistoryStoreOptions = {}) {
    this.#filePath =
      options.filePath ?? path.join(process.cwd(), ".qos", "data", "backtest-runs.json");
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
    this.#maximumBytes = options.maximumBytes ?? MAX_HISTORY_BYTES;
  }

  async #read(): Promise<{ version: 1; runs: StoredBacktestRun[] }> {
    try {
      const info = await stat(this.#filePath);
      if (info.size > this.#maximumBytes) {
        throw new StrategyStoreError("store_too_large", "Backtest history file is too large.");
      }
      const parsed = BacktestHistoryEnvelopeSchema.safeParse(
        JSON.parse(await readFile(this.#filePath, "utf8")) as unknown,
      );
      if (!parsed.success) {
        throw new StrategyStoreError("corrupt_store", "Backtest history file failed validation.");
      }
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, runs: [] };
      if (error instanceof StrategyStoreError) throw error;
      throw new StrategyStoreError("corrupt_store", "Backtest history file could not be read.", {
        cause: error,
      });
    }
  }

  async #write(envelope: { version: 1; runs: StoredBacktestRun[] }): Promise<void> {
    const parsed = BacktestHistoryEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new StrategyStoreError("invalid_document", "Backtest history failed validation.");
    }
    const serialized = `${JSON.stringify(parsed.data)}\n`;
    if (new TextEncoder().encode(serialized).byteLength > this.#maximumBytes) {
      throw new StrategyStoreError("store_too_large", "Backtest history file is too large.");
    }
    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#filePath}.${this.#createId()}.tmp`;
    try {
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      try {
        await copyFile(this.#filePath, `${this.#filePath}.bak`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(temporary, this.#filePath);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // The temporary file may already have been renamed.
      }
      throw error;
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation, operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  create(input: NewBacktestRun): Promise<StoredBacktestRun> {
    return this.#serialize(async () => {
      const parsed = NewBacktestRunSchema.safeParse(input);
      if (!parsed.success) {
        throw new StrategyStoreError("invalid_document", "Backtest run failed validation.");
      }
      const envelope = await this.#read();
      const run = StoredBacktestRunSchema.parse({
        id: this.#createId(),
        ...parsed.data,
        createdAt: this.#now().toISOString(),
      });
      await this.#write({ version: 1, runs: [...envelope.runs, run] });
      return structuredClone(run);
    });
  }

  async list(strategyId: string, limit: number): Promise<BacktestRunListItem[]> {
    const envelope = await this.#read();
    return envelope.runs
      .filter((run) => run.strategyId === strategyId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map(toBacktestRunListItem);
  }

  async #listAll(
    limit: number,
    existingStrategyIds?: readonly string[],
  ): Promise<BacktestRunListItem[]> {
    const envelope = await this.#read();
    let runs = envelope.runs;
    if (existingStrategyIds) {
      const existing = new Set(existingStrategyIds);
      const hasOrphans = runs.some(
        (run) => run.strategyId !== null && !existing.has(run.strategyId),
      );
      if (hasOrphans) {
        runs = runs.map((run) =>
          run.strategyId !== null && !existing.has(run.strategyId)
            ? { ...run, strategyId: null }
            : run,
        );
        await this.#write({ version: 1, runs });
      }
    }
    return runs
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map(toBacktestRunListItem);
  }

  listAll(limit: number, existingStrategyIds?: readonly string[]): Promise<BacktestRunListItem[]> {
    if (existingStrategyIds) {
      return this.#serialize(() => this.#listAll(limit, existingStrategyIds));
    }
    return this.#listAll(limit);
  }

  async get(id: string): Promise<StoredBacktestRun | null> {
    const run = (await this.#read()).runs.find((candidate) => candidate.id === id);
    return run ? structuredClone(run) : null;
  }

  delete(id: string): Promise<boolean> {
    return this.#serialize(async () => {
      const envelope = await this.#read();
      if (!envelope.runs.some((run) => run.id === id)) return false;
      await this.#write({
        version: 1,
        runs: envelope.runs.filter((run) => run.id !== id),
      });
      return true;
    });
  }

  detachStrategy(strategyId: string): Promise<number> {
    return this.#serialize(async () => {
      const envelope = await this.#read();
      const detached = envelope.runs.filter((run) => run.strategyId === strategyId).length;
      if (detached === 0) return 0;
      await this.#write({
        version: 1,
        runs: envelope.runs.map((run) =>
          run.strategyId === strategyId ? { ...run, strategyId: null } : run,
        ),
      });
      return detached;
    });
  }

  detachMissingStrategies(existingStrategyIds: readonly string[]): Promise<number> {
    return this.#serialize(async () => {
      const existing = new Set(existingStrategyIds);
      const envelope = await this.#read();
      const detached = envelope.runs.filter(
        (run) => run.strategyId !== null && !existing.has(run.strategyId),
      ).length;
      if (detached === 0) return 0;
      await this.#write({
        version: 1,
        runs: envelope.runs.map((run) =>
          run.strategyId !== null && !existing.has(run.strategyId)
            ? { ...run, strategyId: null }
            : run,
        ),
      });
      return detached;
    });
  }
}
