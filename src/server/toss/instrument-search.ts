import { getMarketDefaults, type InstrumentSummary, type Market } from "@/src/domain/instruments";
import { logServerEvent } from "@/src/server/logging";
import type { TossClient } from "./client";
import {
  getInstrumentCatalogStore,
  type InstrumentCatalogStore,
  type InstrumentMarketCatalog,
} from "./instrument-catalog-store";
import type { TossListedStock } from "./schemas";

const KOREAN_MARKETS = ["KOSPI", "KOSDAQ", "KR_ETC"] as const satisfies readonly Market[];
const US_MARKETS = ["NYSE", "NASDAQ", "AMEX", "US_ETC"] as const satisfies readonly Market[];
const ALL_MARKETS = [...KOREAN_MARKETS, ...US_MARKETS] as const;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const STALE_TTL_MS = 7 * 24 * 60 * 60_000;
const STOCK_ALL_INTERVAL_MS = 1_100;

export interface SearchOptions {
  region?: "KR" | "US";
  markets?: Market[];
  limit?: number;
  refresh?: boolean;
}

export interface InstrumentSearchResult {
  instruments: InstrumentSummary[];
  cache: {
    status: "HIT" | "REFRESHED" | "STALE";
    origin: "MEMORY" | "DISK" | "PROVIDER" | "MIXED" | null;
    fetchedAt: string | null;
    expiresAt: string | null;
    markets: number;
  };
}

interface MarketRows {
  catalog: InstrumentMarketCatalog;
  source: "HIT" | "REFRESHED" | "STALE";
  origin: "MEMORY" | "DISK" | "PROVIDER";
}

interface CachedMarketCatalog {
  catalog: InstrumentMarketCatalog;
  origin: "MEMORY" | "DISK";
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._:-]+/g, "");
}

function rank(stock: TossListedStock, query: string): number {
  const symbol = normalize(stock.symbol);
  const name = normalize(stock.name);
  if (symbol === query) return 0;
  if (name === query) return 1;
  if (symbol.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  return 4;
}

function providerAllowsStale(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["unauthorized", "forbidden", "rate_limited", "timeout", "unavailable"].includes(
    String(error.code),
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TossInstrumentSearch {
  readonly #client: TossClient;
  readonly #now: () => number;
  readonly #store: InstrumentCatalogStore;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #minimumRefreshIntervalMs: number;
  readonly #catalogs = new Map<Market, InstrumentMarketCatalog>();
  readonly #refreshing = new Map<Market, Promise<InstrumentMarketCatalog>>();
  readonly #resolving = new Map<string, Promise<MarketRows>>();
  #providerQueue: Promise<void> = Promise.resolve();
  #lastProviderStartedAt = Number.NEGATIVE_INFINITY;

  constructor(
    client: TossClient,
    options: {
      now?: () => number;
      catalogStore?: InstrumentCatalogStore;
      sleep?: (milliseconds: number) => Promise<void>;
      minimumRefreshIntervalMs?: number;
    } = {},
  ) {
    this.#client = client;
    this.#now = options.now ?? Date.now;
    this.#store = options.catalogStore ?? getInstrumentCatalogStore();
    this.#sleep = options.sleep ?? sleep;
    this.#minimumRefreshIntervalMs = options.minimumRefreshIntervalMs ?? STOCK_ALL_INTERVAL_MS;
  }

  #age(catalog: InstrumentMarketCatalog): number {
    return this.#now() - Date.parse(catalog.fetchedAt);
  }

  #isFresh(catalog: InstrumentMarketCatalog): boolean {
    const age = this.#age(catalog);
    return age >= 0 && age < CACHE_TTL_MS;
  }

  #isWithinStaleWindow(catalog: InstrumentMarketCatalog): boolean {
    const age = this.#age(catalog);
    return age >= 0 && age <= STALE_TTL_MS;
  }

  #providerRows(market: Market): Promise<TossListedStock[]> {
    const result = this.#providerQueue.then(async () => {
      const remaining =
        this.#minimumRefreshIntervalMs - (this.#now() - this.#lastProviderStartedAt);
      if (remaining > 0) await this.#sleep(remaining);
      this.#lastProviderStartedAt = this.#now();
      return this.#client.listStocks(market);
    });
    this.#providerQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #refresh(market: Market): Promise<InstrumentMarketCatalog> {
    const existing = this.#refreshing.get(market);
    if (existing) return existing;
    const startedAt = performance.now();
    const refresh = (async () => {
      const rows = await this.#providerRows(market);
      const catalog = {
        market,
        fetchedAt: new Date(this.#now()).toISOString(),
        rows,
      } satisfies InstrumentMarketCatalog;
      await this.#store.put(market, catalog.fetchedAt, rows);
      this.#catalogs.set(market, catalog);
      logServerEvent("info", "instrument_catalog_refresh", {
        market,
        rows: rows.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return catalog;
    })().finally(() => this.#refreshing.delete(market));
    this.#refreshing.set(market, refresh);
    return refresh;
  }

  async #cachedCatalog(market: Market): Promise<CachedMarketCatalog | null> {
    const memory = this.#catalogs.get(market);
    if (memory) return { catalog: memory, origin: "MEMORY" };
    try {
      const stored = await this.#store.get(market);
      if (stored) this.#catalogs.set(market, stored);
      return stored ? { catalog: stored, origin: "DISK" } : null;
    } catch (error) {
      logServerEvent("warn", "instrument_catalog_read_failed", {
        market,
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code).slice(0, 80)
            : "unknown_error",
      });
      return null;
    }
  }

  async #resolveMarketRows(market: Market, forceRefresh: boolean): Promise<MarketRows> {
    const cached = await this.#cachedCatalog(market);
    if (!forceRefresh && cached && this.#isFresh(cached.catalog)) {
      return { catalog: cached.catalog, source: "HIT", origin: cached.origin };
    }
    try {
      return { catalog: await this.#refresh(market), source: "REFRESHED", origin: "PROVIDER" };
    } catch (error) {
      if (cached && this.#isWithinStaleWindow(cached.catalog) && providerAllowsStale(error)) {
        logServerEvent("warn", "instrument_catalog_stale", {
          market,
          fetchedAt: cached.catalog.fetchedAt,
          providerCode: String((error as { code: unknown }).code).slice(0, 80),
        });
        return { catalog: cached.catalog, source: "STALE", origin: cached.origin };
      }
      throw error;
    }
  }

  #marketRows(market: Market, forceRefresh: boolean): Promise<MarketRows> {
    const key = `${market}:${forceRefresh ? "REFRESH" : "CACHE"}`;
    const existing = this.#resolving.get(key);
    if (existing) return existing;
    const resolving = this.#resolveMarketRows(market, forceRefresh).finally(() =>
      this.#resolving.delete(key),
    );
    this.#resolving.set(key, resolving);
    return resolving;
  }

  async searchWithMetadata(
    query: string,
    options: SearchOptions = {},
  ): Promise<InstrumentSearchResult> {
    const normalizedQuery = normalize(query.trim());
    if (!normalizedQuery) {
      return {
        instruments: [],
        cache: { status: "HIT", origin: null, fetchedAt: null, expiresAt: null, markets: 0 },
      };
    }
    const markets =
      options.markets ??
      (options.region === "KR"
        ? [...KOREAN_MARKETS]
        : options.region === "US"
          ? [...US_MARKETS]
          : [...ALL_MARKETS]);
    const catalogs = await Promise.all(
      markets.map((market) => this.#marketRows(market, options.refresh ?? false)),
    );
    const fetchedTimes = catalogs.map(({ catalog }) => Date.parse(catalog.fetchedAt));
    const oldestFetchedAt = Math.min(...fetchedTimes);
    const status = catalogs.some((catalog) => catalog.source === "STALE")
      ? "STALE"
      : catalogs.some((catalog) => catalog.source === "REFRESHED")
        ? "REFRESHED"
        : "HIT";
    const origins = new Set(catalogs.map((catalog) => catalog.origin));
    const origin = origins.size === 1 ? catalogs[0].origin : "MIXED";

    const instruments = catalogs
      .flatMap(({ catalog }) =>
        catalog.rows
          .filter((stock) =>
            [stock.symbol, stock.name].some((value) => normalize(value).includes(normalizedQuery)),
          )
          .map((stock) => ({ market: catalog.market, stock })),
      )
      .sort((left, right) => {
        const score = rank(left.stock, normalizedQuery) - rank(right.stock, normalizedQuery);
        return score || left.stock.symbol.localeCompare(right.stock.symbol);
      })
      .slice(0, Math.max(1, Math.min(50, options.limit ?? 20)))
      .map(({ market, stock }) => ({
        instrumentId: `${market}:${stock.symbol.toUpperCase()}`,
        market,
        symbol: stock.symbol.toUpperCase(),
        displayName: stock.name,
        ...getMarketDefaults(market),
        synthetic: false,
        aliases: [],
        securityType: stock.securityType,
        isinCode: stock.isinCode,
      }));

    return {
      instruments,
      cache: {
        status,
        origin,
        fetchedAt: new Date(oldestFetchedAt).toISOString(),
        expiresAt: new Date(oldestFetchedAt + CACHE_TTL_MS).toISOString(),
        markets: markets.length,
      },
    };
  }

  async search(query: string, options: SearchOptions = {}): Promise<InstrumentSummary[]> {
    return (await this.searchWithMetadata(query, options)).instruments;
  }
}

let defaultSearch: TossInstrumentSearch | null = null;

export function getTossInstrumentSearch(client: TossClient): TossInstrumentSearch {
  defaultSearch ??= new TossInstrumentSearch(client);
  return defaultSearch;
}
