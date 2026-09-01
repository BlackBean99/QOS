import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  NewStoredStrategySchema,
  MAX_STRATEGY_DOCUMENT_BYTES,
  MAX_STORED_STRATEGIES,
  StoredStrategyEnvelopeSchema,
  StrategyExportSchema,
  UpdateStoredStrategySchema,
  type NewStoredStrategy,
  type StoredStrategy,
  type StrategyExport,
  type UpdateStoredStrategy,
} from "@/src/domain/stored-strategy";

const MAX_STORE_BYTES = MAX_STRATEGY_DOCUMENT_BYTES;

export type StrategyStoreErrorCode =
  | "invalid_document"
  | "corrupt_store"
  | "invalid_response"
  | "missing_config"
  | "schema_missing"
  | "unavailable"
  | "rate_limited"
  | "not_found"
  | "revision_conflict"
  | "id_conflict"
  | "store_too_large";

export class StrategyStoreError extends Error {
  readonly code: StrategyStoreErrorCode;

  constructor(code: StrategyStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrategyStoreError";
    this.code = code;
  }
}

interface StrategyStoreOptions {
  filePath?: string;
  now?: () => Date;
  createId?: () => string;
  maximumBytes?: number;
}

export interface StrategyRepository {
  list(): Promise<StoredStrategy[]>;
  listIds(): Promise<string[]>;
  get(id: string): Promise<StoredStrategy | null>;
  create(input: NewStoredStrategy): Promise<StoredStrategy>;
  update(id: string, input: UpdateStoredStrategy): Promise<StoredStrategy>;
  delete(id: string, expectedRevision: number): Promise<boolean>;
  exportAll(): Promise<StrategyExport>;
  import(
    document: unknown,
    mode?: "reject" | "replace" | "clone",
  ): Promise<{ imported: number; ids: string[] }>;
}

const EMPTY_STORE = { version: 1 as const, strategies: [] as StoredStrategy[] };

export class StrategyStore implements StrategyRepository {
  readonly #filePath: string;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #maximumBytes: number;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: StrategyStoreOptions = {}) {
    this.#filePath =
      options.filePath ?? path.join(process.cwd(), ".qos", "data", "strategies.json");
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
    this.#maximumBytes = options.maximumBytes ?? MAX_STORE_BYTES;
  }

  async #readEnvelope(): Promise<{ version: 1; strategies: StoredStrategy[] }> {
    try {
      const info = await stat(this.#filePath);
      if (info.size > this.#maximumBytes) {
        throw new StrategyStoreError(
          "store_too_large",
          "전략 저장 파일이 허용 크기를 초과했습니다.",
        );
      }
      const text = await readFile(this.#filePath, "utf8");
      const parsedJson: unknown = JSON.parse(text);
      const parsed = StoredStrategyEnvelopeSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new StrategyStoreError("corrupt_store", "전략 저장 파일을 검증하지 못했습니다.");
      }
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { ...EMPTY_STORE, strategies: [] };
      if (error instanceof StrategyStoreError) throw error;
      throw new StrategyStoreError("corrupt_store", "전략 저장 파일을 읽지 못했습니다.", {
        cause: error,
      });
    }
  }

  async #writeEnvelope(envelope: { version: 1; strategies: StoredStrategy[] }): Promise<void> {
    const parsed = StoredStrategyEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new StrategyStoreError("invalid_document", "저장할 전략 문서를 검증하지 못했습니다.");
    }
    // Keep the local representation aligned with the compact portable export budget. Pretty
    // printing can more than double drawing-heavy documents and make a valid self-export
    // impossible to import into the local fallback.
    const serialized = `${JSON.stringify(parsed.data)}\n`;
    if (new TextEncoder().encode(serialized).byteLength > this.#maximumBytes) {
      throw new StrategyStoreError("store_too_large", "전략 저장 파일이 허용 크기를 초과했습니다.");
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
        await chmod(`${this.#filePath}.bak`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(temporary, this.#filePath);
      await chmod(this.#filePath, 0o600);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // The exact temporary file may already have been renamed or never created.
      }
      throw error;
    }
  }

  #serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation, operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async list(): Promise<StoredStrategy[]> {
    const envelope = await this.#readEnvelope();
    return envelope.strategies
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((strategy) => structuredClone(strategy));
  }

  async listIds(): Promise<string[]> {
    const envelope = await this.#readEnvelope();
    return envelope.strategies.map((strategy) => strategy.id);
  }

  async get(id: string): Promise<StoredStrategy | null> {
    const envelope = await this.#readEnvelope();
    const found = envelope.strategies.find((strategy) => strategy.id === id);
    return found ? structuredClone(found) : null;
  }

  create(input: NewStoredStrategy): Promise<StoredStrategy> {
    return this.#serializeWrite(async () => {
      const parsed = NewStoredStrategySchema.safeParse(input);
      if (!parsed.success) {
        throw new StrategyStoreError("invalid_document", "새 전략 문서를 검증하지 못했습니다.");
      }
      const envelope = await this.#readEnvelope();
      if (envelope.strategies.length >= MAX_STORED_STRATEGIES) {
        throw new StrategyStoreError("store_too_large", "전략 저장 개수 한도를 초과했습니다.");
      }
      const timestamp = this.#now().toISOString();
      const created = {
        id: this.#createId(),
        revision: 1,
        ...parsed.data,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies StoredStrategy;
      await this.#writeEnvelope({ ...envelope, strategies: [...envelope.strategies, created] });
      return structuredClone(created);
    });
  }

  update(id: string, input: UpdateStoredStrategy): Promise<StoredStrategy> {
    return this.#serializeWrite(async () => {
      const parsed = UpdateStoredStrategySchema.safeParse(input);
      if (!parsed.success) {
        throw new StrategyStoreError("invalid_document", "수정할 전략 문서를 검증하지 못했습니다.");
      }
      const envelope = await this.#readEnvelope();
      const index = envelope.strategies.findIndex((strategy) => strategy.id === id);
      if (index < 0) throw new StrategyStoreError("not_found", "저장 전략을 찾지 못했습니다.");
      const current = envelope.strategies[index];
      if (current.revision !== parsed.data.expectedRevision) {
        throw new StrategyStoreError("revision_conflict", "다른 변경이 먼저 저장되었습니다.");
      }
      const replacement = {
        name: parsed.data.name,
        description: parsed.data.description,
        instrument: parsed.data.instrument,
        strategy: parsed.data.strategy,
        chart: parsed.data.chart,
        monitor: parsed.data.monitor,
      };
      const updated = {
        ...current,
        ...replacement,
        revision: current.revision + 1,
        updatedAt: this.#now().toISOString(),
      } satisfies StoredStrategy;
      const strategies = [...envelope.strategies];
      strategies[index] = updated;
      await this.#writeEnvelope({ ...envelope, strategies });
      return structuredClone(updated);
    });
  }

  delete(id: string, expectedRevision: number): Promise<boolean> {
    return this.#serializeWrite(async () => {
      const envelope = await this.#readEnvelope();
      const current = envelope.strategies.find((strategy) => strategy.id === id);
      if (!current) return false;
      if (current.revision !== expectedRevision) {
        throw new StrategyStoreError("revision_conflict", "다른 변경이 먼저 저장되었습니다.");
      }
      await this.#writeEnvelope({
        ...envelope,
        strategies: envelope.strategies.filter((strategy) => strategy.id !== id),
      });
      return true;
    });
  }

  async exportAll(): Promise<StrategyExport> {
    const envelope = await this.#readEnvelope();
    return StrategyExportSchema.parse({
      ...envelope,
      exportedAt: this.#now().toISOString(),
    });
  }

  import(
    document: unknown,
    mode: "reject" | "replace" | "clone" = "reject",
  ): Promise<{ imported: number; ids: string[] }> {
    return this.#serializeWrite(async () => {
      const parsed = StrategyExportSchema.safeParse(document);
      if (!parsed.success) {
        throw new StrategyStoreError("invalid_document", "가져올 JSON 문서를 검증하지 못했습니다.");
      }
      const envelope = await this.#readEnvelope();
      const existing = new Map(envelope.strategies.map((strategy) => [strategy.id, strategy]));
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
          throw new StrategyStoreError("id_conflict", "같은 id의 저장 전략이 이미 존재합니다.");
        }
        if (collision && mode === "replace") {
          return {
            ...strategy,
            revision: collision.revision + 1,
            createdAt: collision.createdAt,
            updatedAt: timestamp,
          };
        }
        return strategy;
      });
      const incomingIds = new Set(incoming.map((strategy) => strategy.id));
      const strategies = [
        ...envelope.strategies.filter((strategy) => !incomingIds.has(strategy.id)),
        ...incoming,
      ];
      if (strategies.length > MAX_STORED_STRATEGIES) {
        throw new StrategyStoreError("store_too_large", "전략 저장 개수 한도를 초과했습니다.");
      }
      await this.#writeEnvelope({ version: 1, strategies });
      return { imported: incoming.length, ids: incoming.map((strategy) => strategy.id) };
    });
  }
}
