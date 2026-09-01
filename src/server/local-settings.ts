import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const TelegramConnectionSchema = z
  .object({
    chatId: z.string().regex(/^-?\d+$/),
    displayName: z.string().trim().min(1).max(160),
    username: z.string().trim().min(1).max(80),
    connectedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const LocalSettingsSchema = z
  .object({
    version: z.literal(1),
    telegram: TelegramConnectionSchema.nullable(),
  })
  .strict();

export type TelegramConnection = z.infer<typeof TelegramConnectionSchema>;
export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

export class LocalSettingsStore {
  readonly #filePath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: { filePath?: string } = {}) {
    this.#filePath = options.filePath ?? path.join(process.cwd(), ".qos", "data", "settings.json");
  }

  async get(): Promise<LocalSettings> {
    try {
      return LocalSettingsSchema.parse(JSON.parse(await readFile(this.#filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, telegram: null };
      throw new Error("로컬 알림 설정 파일을 읽지 못했습니다.", { cause: error });
    }
  }

  setTelegram(connection: TelegramConnection | null): Promise<LocalSettings> {
    const operation = this.#writeQueue.then(async () => {
      const settings = LocalSettingsSchema.parse({ version: 1, telegram: connection });
      const directory = path.dirname(this.#filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
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
      return settings;
    });
    this.#writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

let defaultStore: LocalSettingsStore | null = null;

export function getLocalSettingsStore(): LocalSettingsStore {
  defaultStore ??= new LocalSettingsStore();
  return defaultStore;
}
