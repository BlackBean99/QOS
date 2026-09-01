import { StrategyStore, StrategyStoreError, type StrategyRepository } from "./strategy-store";
import { SupabaseStrategyStore } from "./supabase-strategy-store";
import type { BacktestHistoryRepository } from "@/src/domain/strategy-history";
import { BacktestHistoryStore } from "./backtest-history-store";
import { SupabaseBacktestHistoryStore } from "./supabase-backtest-history";

type Environment = Record<string, string | undefined>;

class UnavailableStrategyRepository implements StrategyRepository {
  constructor(readonly error: StrategyStoreError) {}
  #reject<T>(): Promise<T> {
    return Promise.reject(this.error);
  }
  list() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["list"]>>>();
  }
  listIds() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["listIds"]>>>();
  }
  get() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["get"]>>>();
  }
  create() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["create"]>>>();
  }
  update() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["update"]>>>();
  }
  delete() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["delete"]>>>();
  }
  exportAll() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["exportAll"]>>>();
  }
  import() {
    return this.#reject<Awaited<ReturnType<StrategyRepository["import"]>>>();
  }
}

class UnavailableBacktestHistoryRepository implements BacktestHistoryRepository {
  constructor(readonly error: StrategyStoreError) {}
  #reject<T>(): Promise<T> {
    return Promise.reject(this.error);
  }
  create() {
    return this.#reject<Awaited<ReturnType<BacktestHistoryRepository["create"]>>>();
  }
  list() {
    return this.#reject<Awaited<ReturnType<BacktestHistoryRepository["list"]>>>();
  }
  listAll() {
    return this.#reject<Awaited<ReturnType<BacktestHistoryRepository["listAll"]>>>();
  }
  get() {
    return this.#reject<Awaited<ReturnType<BacktestHistoryRepository["get"]>>>();
  }
  delete() {
    return this.#reject<Awaited<ReturnType<BacktestHistoryRepository["delete"]>>>();
  }
  detachStrategy() {
    return this.#reject<Awaited<ReturnType<BacktestHistoryRepository["detachStrategy"]>>>();
  }
  detachMissingStrategies() {
    return this.#reject<
      Awaited<ReturnType<BacktestHistoryRepository["detachMissingStrategies"]>>
    >();
  }
}

export function createStrategyRepository(
  environment: Environment = process.env,
): StrategyRepository {
  const url = environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url && !key) return new StrategyStore();
  if (!url || !key) {
    throw new StrategyStoreError("missing_config", "Supabase server configuration is incomplete.");
  }
  return new SupabaseStrategyStore({ url, key });
}

export function createBacktestHistoryRepository(
  environment: Environment = process.env,
): BacktestHistoryRepository {
  const url = environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url && !key) return new BacktestHistoryStore();
  if (!url || !key) {
    throw new StrategyStoreError("missing_config", "Supabase server configuration is incomplete.");
  }
  return new SupabaseBacktestHistoryStore({ url, key });
}

export function createSafeStrategyRepository(
  environment: Environment = process.env,
): StrategyRepository {
  try {
    return createStrategyRepository(environment);
  } catch (error) {
    if (error instanceof StrategyStoreError) return new UnavailableStrategyRepository(error);
    throw error;
  }
}

export function createSafeBacktestHistoryRepository(
  environment: Environment = process.env,
): BacktestHistoryRepository {
  try {
    return createBacktestHistoryRepository(environment);
  } catch (error) {
    if (error instanceof StrategyStoreError) return new UnavailableBacktestHistoryRepository(error);
    throw error;
  }
}

let defaultRepository: StrategyRepository | null = null;
let defaultHistoryRepository: BacktestHistoryRepository | null = null;

export function getStrategyRepository(): StrategyRepository {
  defaultRepository ??= createSafeStrategyRepository();
  return defaultRepository;
}

export function getBacktestHistoryRepository(): BacktestHistoryRepository {
  defaultHistoryRepository ??= createSafeBacktestHistoryRepository();
  return defaultHistoryRepository;
}
