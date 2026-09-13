import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { InstrumentSnapshotSchema, type InstrumentSnapshot } from "@/src/domain/stored-strategy";

const DeliverySchema = z
  .object({
    status: z.enum(["sent", "failed"]),
    attempts: z.number().int().min(1).max(3),
    attemptedAt: z.iso.datetime({ offset: true }),
    errorCode: z.string().max(80).nullable(),
  })
  .strict();

const PaperPositionSchema = z
  .object({
    strategyId: z.uuid(),
    instrumentId: z.string().trim().min(1).max(80),
    hedgeInstrumentId: z.string().trim().min(1).max(80).nullable(),
    heldInstrument: InstrumentSnapshotSchema.nullable().default(null),
    leg: z.enum(["WAITING", "LONG_PRIMARY", "LONG_HEDGE"]),
    signalAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((position, context) => {
    const heldId = position.heldInstrument?.instrumentId;
    const expectedHeldId =
      position.leg === "LONG_PRIMARY"
        ? position.instrumentId
        : position.leg === "LONG_HEDGE"
          ? position.hedgeInstrumentId
          : null;
    if (heldId && heldId !== expectedHeldId) {
      context.addIssue({
        code: "custom",
        path: ["heldInstrument"],
        message: "paper leg와 실제 보유 종목 snapshot이 일치해야 합니다.",
      });
    }
  });

const StateSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["stopped", "connecting", "connected", "reconnecting", "error"]),
    heartbeatAt: z.iso.datetime({ offset: true }).nullable(),
    enabledStrategies: z.number().int().nonnegative(),
    lastErrorCode: z.string().max(80).nullable(),
    providerRequests: z.number().int().nonnegative().default(0),
    datasetCacheHits: z.number().int().nonnegative().default(0),
    trackedTargets: z.number().int().nonnegative().default(0),
    lastProviderSyncAt: z.iso.datetime({ offset: true }).nullable().default(null),
    lastStrategyRefreshAt: z.iso.datetime({ offset: true }).nullable().default(null),
    strategySource: z.enum(["PRIMARY", "SNAPSHOT"]).default("PRIMARY"),
    strategySnapshotAt: z.iso.datetime({ offset: true }).nullable().default(null),
    deliveries: z.record(z.string().max(300), DeliverySchema),
    positions: z.record(z.string().max(240), PaperPositionSchema).default({}),
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
  trackedTargets: 0,
  lastProviderSyncAt: null,
  lastStrategyRefreshAt: null,
  strategySource: "PRIMARY",
  strategySnapshotAt: null,
  deliveries: {},
  positions: {},
};

export interface MonitorTelemetry {
  providerRequests: number;
  datasetCacheHits: number;
  trackedTargets: number;
  lastProviderSyncAt: string | null;
  lastStrategyRefreshAt: string | null;
  strategySource?: "PRIMARY" | "SNAPSHOT";
  strategySnapshotAt?: string | null;
}

export interface PaperPositionUpdate {
  positionKey: string;
  strategyId: string;
  instrumentId: string;
  hedgeInstrumentId: string | null;
  heldInstrument: InstrumentSnapshot | null;
  leg: "WAITING" | "LONG_PRIMARY" | "LONG_HEDGE";
  signalAt: string;
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
      await chmod(directory, 0o700);
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

  async position(key: string): Promise<z.infer<typeof PaperPositionSchema> | null> {
    return (await this.#read()).positions[key] ?? null;
  }

  async recordTransition(key: string, update: PaperPositionUpdate): Promise<void> {
    await this.#mutate((state) => {
      const now = new Date().toISOString();
      const deliveries = {
        ...state.deliveries,
        [key]: {
          status: "sent" as const,
          attempts: Math.min(3, (state.deliveries[key]?.attempts ?? 0) + 1),
          attemptedAt: now,
          errorCode: null,
        },
      };
      return {
        ...state,
        deliveries: Object.fromEntries(
          Object.entries(deliveries)
            .toSorted(([, left], [, right]) => right.attemptedAt.localeCompare(left.attemptedAt))
            .slice(0, 1_000),
        ),
        positions: Object.fromEntries(
          Object.entries({
            ...state.positions,
            [update.positionKey]: {
              strategyId: update.strategyId,
              instrumentId: update.instrumentId,
              hedgeInstrumentId: update.hedgeInstrumentId,
              heldInstrument: update.heldInstrument,
              leg: update.leg,
              signalAt: update.signalAt,
              updatedAt: now,
            },
          })
            .toSorted(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, 1_000),
        ),
      };
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
    trackedTargets: number;
    lastProviderSyncAt: string | null;
    lastStrategyRefreshAt: string | null;
    strategySource: "PRIMARY" | "SNAPSHOT";
    strategySnapshotAt: string | null;
    positions: Array<z.infer<typeof PaperPositionSchema>>;
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
      trackedTargets: state.trackedTargets,
      lastProviderSyncAt: state.lastProviderSyncAt,
      lastStrategyRefreshAt: state.lastStrategyRefreshAt,
      strategySource: state.strategySource,
      strategySnapshotAt: state.strategySnapshotAt,
      positions: Object.values(state.positions).toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    };
  }
}

let defaultStore: MonitorStateStore | null = null;

export function getMonitorStateStore(): MonitorStateStore {
  defaultStore ??= new MonitorStateStore();
  return defaultStore;
}
