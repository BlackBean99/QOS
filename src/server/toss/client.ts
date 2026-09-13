import { z } from "zod";

import type { Market } from "@/src/domain/instruments";
import {
  CandleIntervalSchema,
  TossCandleSchema,
  TossListedStockSchema,
  TossStockInfoSchema,
  TossTokenResponseSchema,
  type CandleInterval,
  type MarketCandle,
  type TossListedStock,
  type TossStockInfo,
} from "./schemas";

const DEFAULT_BASE_URL = "https://openapi.tossinvest.com";
const MAX_RETRY_DELAY_MS = 1_000;

export type TossProviderErrorCode =
  | "missing_config"
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response";

export class TossProviderError extends Error {
  readonly code: TossProviderErrorCode;
  readonly status?: number;

  constructor(
    code: TossProviderErrorCode,
    message: string,
    status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TossProviderError";
    this.code = code;
    this.status = status;
  }
}

interface TossClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

const ListedStocksEnvelopeSchema = z
  .object({ result: z.array(TossListedStockSchema) })
  .passthrough();
const StockInfoEnvelopeSchema = z.object({ result: z.array(TossStockInfoSchema) }).passthrough();
const CandlePageEnvelopeSchema = z
  .object({
    result: z
      .object({
        candles: z.array(TossCandleSchema),
        nextBefore: z.string().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerCode(status: number): TossProviderErrorCode {
  if (status === 400) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

function safeMessage(code: TossProviderErrorCode): string {
  const messages: Record<TossProviderErrorCode, string> = {
    missing_config: "TOSS OpenAPI 서버 설정이 필요합니다.",
    unauthorized: "TOSS OpenAPI 인증에 실패했습니다.",
    forbidden: "TOSS OpenAPI 허용 IP 또는 권한을 확인해 주세요.",
    invalid_request: "TOSS OpenAPI 요청값이 올바르지 않습니다.",
    not_found: "TOSS OpenAPI에서 종목 데이터를 찾지 못했습니다.",
    rate_limited: "TOSS OpenAPI 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
    timeout: "TOSS OpenAPI 응답 시간이 초과되었습니다.",
    unavailable: "TOSS OpenAPI를 일시적으로 사용할 수 없습니다.",
    invalid_response: "TOSS OpenAPI 응답 형식을 확인할 수 없습니다.",
  };
  return messages[code];
}

export class TossClient {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;
  #token: CachedToken | null = null;
  #tokenPromise: Promise<string> | null = null;

  constructor(options: TossClientOptions) {
    if (!options.clientId.trim() || !options.clientSecret.trim()) {
      throw new TossProviderError("missing_config", safeMessage("missing_config"));
    }
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async #fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      throw new TossProviderError(
        isAbort ? "timeout" : "unavailable",
        safeMessage(isAbort ? "timeout" : "unavailable"),
        undefined,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async #issueToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
    });
    const response = await this.#fetchWithTimeout(`${this.#baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      const code = providerCode(response.status);
      throw new TossProviderError(code, safeMessage(code), response.status);
    }
    const parsed = TossTokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new TossProviderError("invalid_response", safeMessage("invalid_response"));
    }
    this.#token = {
      value: parsed.data.access_token,
      expiresAt: this.#now() + parsed.data.expires_in * 1_000,
    };
    return this.#token.value;
  }

  async getAccessToken(): Promise<string> {
    if (this.#token && this.#token.expiresAt - this.#now() > 30_000) return this.#token.value;
    if (!this.#tokenPromise) {
      this.#tokenPromise = this.#issueToken().finally(() => {
        this.#tokenPromise = null;
      });
    }
    return this.#tokenPromise;
  }

  invalidateToken(): void {
    this.#token = null;
  }

  async #get(path: string, options: { maxAttempts?: number } = {}): Promise<unknown> {
    const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
    let lastError: TossProviderError | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const token = await this.getAccessToken();
        const response = await this.#fetchWithTimeout(`${this.#baseUrl}${path}`, {
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
          cache: "no-store",
        });
        if (response.ok) return await response.json();

        const code = providerCode(response.status);
        const error = new TossProviderError(code, safeMessage(code), response.status);
        if (response.status === 401 && attempt === 0 && maxAttempts > 1) {
          this.invalidateToken();
          lastError = error;
          continue;
        }
        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts - 1) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
          const delay = Number.isFinite(retryAfter)
            ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAfter * 1_000))
            : Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt);
          await this.#sleep(delay);
          lastError = error;
          continue;
        }
        throw error;
      } catch (error) {
        const normalized =
          error instanceof TossProviderError
            ? error
            : new TossProviderError("unavailable", safeMessage("unavailable"), undefined, {
                cause: error,
              });
        if (
          (normalized.code === "timeout" || normalized.code === "unavailable") &&
          attempt < maxAttempts - 1
        ) {
          await this.#sleep(Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt));
          lastError = normalized;
          continue;
        }
        throw normalized;
      }
    }
    throw lastError ?? new TossProviderError("unavailable", safeMessage("unavailable"));
  }

  async listStocks(market: Market): Promise<TossListedStock[]> {
    const query = new URLSearchParams({
      market,
      status: "ACTIVE",
    });
    const parsed = ListedStocksEnvelopeSchema.safeParse(
      await this.#get(`/api/v1/stocks/all?${query.toString()}`, { maxAttempts: 1 }),
    );
    if (!parsed.success) {
      throw new TossProviderError("invalid_response", safeMessage("invalid_response"));
    }
    return parsed.data.result;
  }

  async getStocks(symbols: string[]): Promise<TossStockInfo[]> {
    if (symbols.length < 1 || symbols.length > 200) {
      throw new TossProviderError("invalid_request", safeMessage("invalid_request"));
    }
    const query = new URLSearchParams({ symbols: symbols.join(",") });
    const parsed = StockInfoEnvelopeSchema.safeParse(
      await this.#get(`/api/v1/stocks?${query.toString()}`),
    );
    if (!parsed.success) {
      throw new TossProviderError("invalid_response", safeMessage("invalid_response"));
    }
    return parsed.data.result;
  }

  async getCandles(input: {
    symbol: string;
    interval: CandleInterval;
    count?: number;
    before?: string;
    adjusted?: boolean;
  }): Promise<{ candles: MarketCandle[]; nextBefore: string | null }> {
    const interval = CandleIntervalSchema.parse(input.interval);
    const count = Math.max(1, Math.min(200, input.count ?? 100));
    const query = new URLSearchParams({
      symbol: input.symbol,
      interval,
      count: String(count),
      adjusted: String(input.adjusted ?? true),
    });
    if (input.before) query.set("before", input.before);
    const parsed = CandlePageEnvelopeSchema.safeParse(
      await this.#get(`/api/v1/candles?${query.toString()}`),
    );
    if (!parsed.success) {
      throw new TossProviderError("invalid_response", safeMessage("invalid_response"));
    }
    const candles = parsed.data.result.candles
      .map((candle) => ({
        timestamp: candle.timestamp,
        open: Number(candle.openPrice),
        high: Number(candle.highPrice),
        low: Number(candle.lowPrice),
        close: Number(candle.closePrice),
        volume: Number(candle.volume),
        currency: candle.currency,
      }))
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    return { candles, nextBefore: parsed.data.result.nextBefore };
  }
}

let defaultClient: TossClient | null = null;

export function getTossClient(): TossClient {
  defaultClient ??= new TossClient({
    clientId: process.env.TOSS_CLIENT_ID ?? "",
    clientSecret: process.env.TOSS_CLIENT_SECRET ?? "",
  });
  return defaultClient;
}
