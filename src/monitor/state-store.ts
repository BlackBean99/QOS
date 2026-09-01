import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const DeliverySchema = z
  .object({
    status: z.enum(["sent", "failed"]),
    attempts: z.number().int().min(1).max(3),
    attemptedAt: z.iso.datetime({ offset: true }),
    errorCode: z.string().max(80).nullable(),
  })
  .strict();

const StateSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["stopped", "connecting", "connected", "reconnecting", "error"]),
    heartbeatAt: z.iso.datetime({ offset: true }).nullable(),
    enabledStrategies: z.number().int().nonnegative(),
    lastErrorCode: z.string().max(80).nullable(),
    providerRequests: z.number().int().nonnegative().default(0),
    datasetCacheHits: z.number().int().nonnegative().default(0),
    lastProviderSyncAt: z.iso.datetime({ offset: true }).nullable().default(null),
    lastStrategyRefreshAt: z.iso.datetime({ offset: true }).nullable().default(null),
    deliveries: z.record(z.string().max(300), DeliverySchema),
  })
  .strict();

type MonitorState = z.infer<typeof StateSchema>;
type MonitorStatus = MonitorState["status"];

const EMPTY_STATE: MonitorState = {
  version: 1,
  status: "stopped",
  heartbeatAt: null,
  enabledStrategies: 0,
  lastErrorCode: null,
  providerRequests: 0,
  datasetCacheHits: 0,
  lastProviderSyncAt: null,
  lastStrategyRefreshAt: null,
  deliveries: {},
};

export interface MonitorTelemetry {
  providerRequests: number;
  datasetCacheHits: number;
  lastProviderSyncAt: string | null;
  lastStrategyRefreshAt: string | null;
}

export class MonitorStateStore {
  readonly #filePath: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: { filePath?: string } = {}) {
    this.#filePath =
      options.filePath ?? path.join(process.cwd(), ".qos", "data", "monitor-state.json");
  }

  async #read(): Promise<MonitorState> {
    try {
      return StateSchema.parse(JSON.parse(await readFile(this.#filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_STATE);
      throw new Error("monitor 상태 파일을 읽지 못했습니다.", { cause: error });
    }
  }

  #mutate(operation: (state: MonitorState) => MonitorState): Promise<MonitorState> {
    const result = this.#queue.then(async () => {
      const state = StateSchema.parse(operation(await this.#read()));
      const directory = path.dirname(this.#filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
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
      return state;
    });
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async shouldDeliver(key: string): Promise<boolean> {
    const delivery = (await this.#read()).deliveries[key];
    return !delivery || (delivery.status !== "sent" && delivery.attempts < 3);
  }

  async recordDelivery(
    key: string,
    status: "sent" | "failed",
    errorCode: string | null = null,
  ): Promise<void> {
    await this.#mutate((state) => {
      const existing = state.deliveries[key];
      const deliveries = {
        ...state.deliveries,
        [key]: {
          status,
          attempts: Math.min(3, (existing?.attempts ?? 0) + 1),
          attemptedAt: new Date().toISOString(),
          errorCode: status === "failed" ? errorCode : null,
        },
      };
      const pruned = Object.fromEntries(
        Object.entries(deliveries)
          .toSorted(([, left], [, right]) => right.attemptedAt.localeCompare(left.attemptedAt))
          .slice(0, 1_000),
      );
      return { ...state, deliveries: pruned };
    });
  }

  async heartbeat(
    status: MonitorStatus,
    enabledStrategies: number,
    errorCode: string | null = null,
    telemetry?: MonitorTelemetry,
  ): Promise<void> {
    await this.#mutate((state) => ({
      ...state,
      status,
      heartbeatAt: new Date().toISOString(),
      enabledStrategies,
      lastErrorCode: errorCode,
      ...(telemetry ?? {}),
    }));
  }

  async publicStatus(): Promise<{
    status: MonitorStatus;
    heartbeatAt: string | null;
    enabledStrategies: number;
    deliveredSignals: number;
    failedSignals: number;
    lastErrorCode: string | null;
    providerRequests: number;
    datasetCacheHits: number;
    lastProviderSyncAt: string | null;
    lastStrategyRefreshAt: string | null;
  }> {
    const state = await this.#read();
    const values = Object.values(state.deliveries);
    return {
      status: state.status,
      heartbeatAt: state.heartbeatAt,
      enabledStrategies: state.enabledStrategies,
      deliveredSignals: values.filter((delivery) => delivery.status === "sent").length,
      failedSignals: values.filter((delivery) => delivery.status === "failed").length,
      lastErrorCode: state.lastErrorCode,
      providerRequests: state.providerRequests,
      datasetCacheHits: state.datasetCacheHits,
      lastProviderSyncAt: state.lastProviderSyncAt,
      lastStrategyRefreshAt: state.lastStrategyRefreshAt,
    };
  }
}

let defaultStore: MonitorStateStore | null = null;

export function getMonitorStateStore(): MonitorStateStore {
  defaultStore ??= new MonitorStateStore();
  return defaultStore;
}
