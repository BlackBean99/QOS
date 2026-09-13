import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { MAX_STORED_STRATEGIES, StoredStrategySchema } from "@/src/domain/stored-strategy";

const SnapshotSchema = z
  .object({
    version: z.literal(1),
    savedAt: z.iso.datetime({ offset: true }),
    strategies: z.array(StoredStrategySchema).max(MAX_STORED_STRATEGIES),
  })
  .strict();

export class MonitorStrategySnapshotStore {
  readonly #filePath: string;

  constructor(options: { filePath?: string } = {}) {
    this.#filePath =
      options.filePath ?? path.join(process.cwd(), ".qos", "data", "monitor-strategies-v1.json");
  }

  async read(): Promise<{
    savedAt: string;
    strategies: z.infer<typeof StoredStrategySchema>[];
  } | null> {
    try {
      const snapshot = SnapshotSchema.parse(JSON.parse(await readFile(this.#filePath, "utf8")));
      return { savedAt: snapshot.savedAt, strategies: snapshot.strategies };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("monitor 전략 snapshot을 읽지 못했습니다.", { cause: error });
    }
  }

  async write(
    strategies: z.infer<typeof StoredStrategySchema>[],
    savedAt = new Date(),
  ): Promise<void> {
    const snapshot = SnapshotSchema.parse({
      version: 1,
      savedAt: savedAt.toISOString(),
      strategies,
    });
    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
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
        // The exact temporary path may already have been renamed or never created.
      }
      throw error;
    }
  }
}

let defaultStore: MonitorStrategySnapshotStore | null = null;

export function getMonitorStrategySnapshotStore(): MonitorStrategySnapshotStore {
  defaultStore ??= new MonitorStrategySnapshotStore();
  return defaultStore;
}
