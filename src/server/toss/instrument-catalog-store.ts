import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { MarketSchema, type Market } from "@/src/domain/instruments";
import { TossListedStockSchema, type TossListedStock } from "./schemas";

const MAX_CATALOG_BYTES = 20 * 1024 * 1024;
const MAX_ROWS_PER_MARKET = 20_000;

const MarketCatalogSchema = z
  .object({
    market: MarketSchema,
    fetchedAt: z.iso.datetime({ offset: true }),
    rows: z.array(TossListedStockSchema).max(MAX_ROWS_PER_MARKET),
  })
  .strict();

const InstrumentCatalogEnvelopeSchema = z
  .object({
    version: z.literal(1),
    catalogs: z.array(MarketCatalogSchema).max(MarketSchema.options.length),
  })
  .strict()
  .superRefine((envelope, context) => {
    const markets = envelope.catalogs.map((catalog) => catalog.market);
    if (new Set(markets).size !== markets.length) {
      context.addIssue({
        code: "custom",
        path: ["catalogs"],
        message: "market catalog는 market별로 하나만 저장할 수 있습니다.",
      });
    }
  });

export type InstrumentMarketCatalog = z.infer<typeof MarketCatalogSchema>;

export class InstrumentCatalogStoreError extends Error {
  readonly code: "corrupt_store" | "invalid_document" | "store_too_large";

  constructor(code: InstrumentCatalogStoreError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InstrumentCatalogStoreError";
    this.code = code;
  }
}

export class InstrumentCatalogStore {
  readonly #filePath: string;
  readonly #maximumBytes: number;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: { filePath?: string; maximumBytes?: number } = {}) {
    this.#filePath =
      options.filePath ?? path.join(process.cwd(), ".qos", "data", "instrument-catalog-v1.json");
    this.#maximumBytes = options.maximumBytes ?? MAX_CATALOG_BYTES;
  }

  async #readEnvelope(): Promise<z.infer<typeof InstrumentCatalogEnvelopeSchema>> {
    try {
      const information = await stat(this.#filePath);
      if (information.size > this.#maximumBytes) {
        throw new InstrumentCatalogStoreError(
          "store_too_large",
          "종목 catalog 파일이 허용 크기를 초과했습니다.",
        );
      }
      const parsed = InstrumentCatalogEnvelopeSchema.safeParse(
        JSON.parse(await readFile(this.#filePath, "utf8")),
      );
      if (!parsed.success) {
        throw new InstrumentCatalogStoreError(
          "corrupt_store",
          "종목 catalog 파일을 검증하지 못했습니다.",
        );
      }
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, catalogs: [] };
      }
      if (error instanceof InstrumentCatalogStoreError) throw error;
      throw new InstrumentCatalogStoreError(
        "corrupt_store",
        "종목 catalog 파일을 읽지 못했습니다.",
        { cause: error },
      );
    }
  }

  async #writeEnvelope(envelope: z.infer<typeof InstrumentCatalogEnvelopeSchema>): Promise<void> {
    const parsed = InstrumentCatalogEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new InstrumentCatalogStoreError(
        "invalid_document",
        "저장할 종목 catalog를 검증하지 못했습니다.",
      );
    }
    const serialized = `${JSON.stringify(parsed.data)}\n`;
    if (new TextEncoder().encode(serialized).byteLength > this.#maximumBytes) {
      throw new InstrumentCatalogStoreError(
        "store_too_large",
        "종목 catalog 파일이 허용 크기를 초과했습니다.",
      );
    }
    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
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

  async get(market: Market): Promise<InstrumentMarketCatalog | null> {
    const catalog = (await this.#readEnvelope()).catalogs.find(
      (candidate) => candidate.market === market,
    );
    return catalog ? structuredClone(catalog) : null;
  }

  put(market: Market, fetchedAt: string, rows: TossListedStock[]): Promise<void> {
    const result = this.#writeQueue.then(async () => {
      const catalog = MarketCatalogSchema.safeParse({ market, fetchedAt, rows });
      if (!catalog.success) {
        throw new InstrumentCatalogStoreError(
          "invalid_document",
          "저장할 market catalog를 검증하지 못했습니다.",
        );
      }
      const envelope = await this.#readEnvelope();
      await this.#writeEnvelope({
        version: 1,
        catalogs: [
          ...envelope.catalogs.filter((candidate) => candidate.market !== market),
          catalog.data,
        ].toSorted((left, right) => left.market.localeCompare(right.market)),
      });
    });
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

let defaultStore: InstrumentCatalogStore | null = null;

export function getInstrumentCatalogStore(): InstrumentCatalogStore {
  defaultStore ??= new InstrumentCatalogStore();
  return defaultStore;
}
