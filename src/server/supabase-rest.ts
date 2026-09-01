import { StrategyStoreError, type StrategyStoreErrorCode } from "./strategy-store";

export interface SupabaseRestOptions {
  url: string;
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header !== null && header.trim() !== "") {
    const retryAfter = Number(header);
    if (Number.isFinite(retryAfter)) {
      return Math.min(1_000, Math.max(0, retryAfter * 1_000));
    }
  }
  return Math.min(1_000, 150 * 2 ** attempt);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SupabaseRestClient {
  readonly #origin: string;
  readonly #key: string;
  readonly #legacyAuthorization: boolean;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: SupabaseRestOptions) {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new StrategyStoreError("missing_config", "Supabase URL configuration is invalid.");
    }
    if (
      url.protocol !== "https:" ||
      !options.key.trim() ||
      options.key.startsWith("sb_publishable_")
    ) {
      throw new StrategyStoreError(
        "missing_config",
        "Supabase server configuration is incomplete.",
      );
    }
    this.#origin = url.origin;
    this.#key = options.key;
    this.#legacyAuthorization = !options.key.startsWith("sb_secret_");
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async #error(response: Response): Promise<never> {
    let providerCode = "";
    try {
      const value = (await response.json()) as { code?: unknown };
      providerCode = typeof value.code === "string" ? value.code : "";
    } catch {
      // Provider bodies are intentionally not reflected to callers.
    }
    let code: StrategyStoreErrorCode = "unavailable";
    if (providerCode === "PGRST205" || providerCode === "42P01") code = "schema_missing";
    else if (providerCode === "P0001") code = "store_too_large";
    else if (providerCode === "23505" || response.status === 409) code = "id_conflict";
    else if (response.status === 429) code = "rate_limited";
    throw new StrategyStoreError(code, "Supabase persistence request failed.");
  }

  async request(path: string, init: RequestInit, retryReads = false): Promise<unknown> {
    const attempts = retryReads ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#origin}/rest/v1/${path}`, {
          ...init,
          headers: {
            accept: "application/json",
            apikey: this.#key,
            ...(this.#legacyAuthorization ? { authorization: `Bearer ${this.#key}` } : {}),
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...init.headers,
          },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        if (attempt + 1 < attempts) {
          await wait(150 * 2 ** attempt);
          continue;
        }
        throw new StrategyStoreError("unavailable", "Supabase persistence unavailable.", {
          cause: error,
        });
      }
      if (response.ok) {
        if (response.status === 204) return null;
        try {
          return (await response.json()) as unknown;
        } catch (error) {
          throw new StrategyStoreError("invalid_response", "Supabase returned invalid JSON.", {
            cause: error,
          });
        }
      }
      if (
        attempt + 1 < attempts &&
        (response.status === 429 || (response.status >= 500 && response.status <= 599))
      ) {
        await wait(retryDelay(response, attempt));
        continue;
      }
      return this.#error(response);
    }
    throw new StrategyStoreError("unavailable", "Supabase persistence unavailable.");
  }
}
