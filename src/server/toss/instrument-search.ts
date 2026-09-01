import { getMarketDefaults, type InstrumentSummary, type Market } from "@/src/domain/instruments";
import type { TossClient } from "./client";
import type { TossListedStock } from "./schemas";

const KOREAN_MARKETS = ["KOSPI", "KOSDAQ", "KR_ETC"] as const satisfies readonly Market[];
const US_MARKETS = ["NYSE", "NASDAQ", "AMEX", "US_ETC"] as const satisfies readonly Market[];
const ALL_MARKETS = [...KOREAN_MARKETS, ...US_MARKETS] as const;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<TossListedStock[]>;
}

interface SearchOptions {
  region?: "KR" | "US";
  markets?: Market[];
  limit?: number;
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

export class TossInstrumentSearch {
  readonly #client: TossClient;
  readonly #now: () => number;
  readonly #cache = new Map<Market, CacheEntry>();

  constructor(client: TossClient, options: { now?: () => number } = {}) {
    this.#client = client;
    this.#now = options.now ?? Date.now;
  }

  #marketRows(market: Market): Promise<TossListedStock[]> {
    const cached = this.#cache.get(market);
    if (cached && cached.expiresAt > this.#now()) return cached.promise;
    const promise = this.#client.listStocks(market).catch((error) => {
      this.#cache.delete(market);
      throw error;
    });
    this.#cache.set(market, { expiresAt: this.#now() + CACHE_TTL_MS, promise });
    return promise;
  }

  async search(query: string, options: SearchOptions = {}): Promise<InstrumentSummary[]> {
    const normalizedQuery = normalize(query.trim());
    if (!normalizedQuery) return [];
    const markets =
      options.markets ??
      (options.region === "KR"
        ? [...KOREAN_MARKETS]
        : options.region === "US"
          ? [...US_MARKETS]
          : [...ALL_MARKETS]);
    const rows = await Promise.all(
      markets.map(async (market) => ({ market, rows: await this.#marketRows(market) })),
    );

    return rows
      .flatMap(({ market, rows: marketRows }) =>
        marketRows
          .filter((stock) =>
            [stock.symbol, stock.name].some((value) => normalize(value).includes(normalizedQuery)),
          )
          .map((stock) => ({ market, stock })),
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
  }
}

let defaultSearch: TossInstrumentSearch | null = null;

export function getTossInstrumentSearch(client: TossClient): TossInstrumentSearch {
  defaultSearch ??= new TossInstrumentSearch(client);
  return defaultSearch;
}
