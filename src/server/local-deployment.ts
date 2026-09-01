import path from "node:path";
import { z } from "zod";

export const LOCAL_DEPLOYMENT_HOST = "127.0.0.1" as const;
export const DEFAULT_LOCAL_DEPLOYMENT_PORT = 3000;

const LocalDeploymentStateSchema = z
  .object({
    version: z.literal(1),
    pid: z.number().int().positive(),
    port: z.number().int().min(1024).max(65535),
    host: z.literal(LOCAL_DEPLOYMENT_HOST),
    repositoryRoot: z.string().trim().min(1),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    dirty: z.boolean().default(false),
    processStartedAt: z.string().trim().min(1),
    startedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type LocalDeploymentState = z.infer<typeof LocalDeploymentStateSchema>;

export function parseLocalDeploymentPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_LOCAL_DEPLOYMENT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port)) throw new Error("QOS_LOCAL_PORT must be an integer.");
  if (port < 1024 || port > 65535) {
    throw new Error("QOS_LOCAL_PORT must be between 1024 and 65535.");
  }
  return port;
}

export function parseLocalDeploymentState(
  source: string,
  expectedRepositoryRoot: string,
): LocalDeploymentState {
  let candidate: unknown;
  try {
    candidate = JSON.parse(source);
  } catch (error) {
    throw new Error("Local deployment state is not valid JSON.", { cause: error });
  }
  const parsed = LocalDeploymentStateSchema.safeParse(candidate);
  if (!parsed.success) {
    const loopbackIssue = parsed.error.issues.some((issue) => issue.path.includes("host"));
    throw new Error(
      loopbackIssue
        ? "Local deployment state must use the loopback host."
        : "Local deployment state does not match the expected schema.",
    );
  }
  if (path.resolve(parsed.data.repositoryRoot) !== path.resolve(expectedRepositoryRoot)) {
    throw new Error("Local deployment state belongs to another repository.");
  }
  return parsed.data;
}

export function localNextCommand(repositoryRoot: string, port: number): string[] {
  return [
    process.execPath,
    path.join(repositoryRoot, "node_modules", "next", "dist", "bin", "next"),
    "start",
    "-H",
    LOCAL_DEPLOYMENT_HOST,
    "-p",
    String(port),
  ];
}

export function isOwnedRunningLocalProductionProcess(
  processInfo: { command: string; cwd: string; listener: string },
  repositoryRoot: string,
  port: number,
): boolean {
  return (
    /^next-server \(v\d+\.\d+\.\d+\)$/.test(processInfo.command.trim()) &&
    path.resolve(processInfo.cwd) === path.resolve(repositoryRoot) &&
    processInfo.listener.trim() === `${LOCAL_DEPLOYMENT_HOST}:${port}`
  );
}

export function matchesLocalDeploymentState(
  processInfo: { command: string; cwd: string; listener: string; startedAt: string },
  state: Pick<LocalDeploymentState, "port" | "processStartedAt">,
  repositoryRoot: string,
): boolean {
  return (
    processInfo.startedAt === state.processStartedAt &&
    isOwnedRunningLocalProductionProcess(processInfo, repositoryRoot, state.port)
  );
}

const CatalogHealthSchema = z
  .object({
    counts: z
      .object({
        entry: z.literal(42),
        filter: z.literal(8),
        exit: z.literal(20),
        total: z.literal(70),
      })
      .strict(),
  })
  .passthrough();

const CompilerHealthSchema = z
  .object({
    compiler: z.literal("deterministic-dsl"),
    strategy: z
      .object({
        version: z.literal(3),
        entry: z.object({ children: z.array(z.unknown()).length(3) }).passthrough(),
        filters: z.object({ children: z.array(z.unknown()).length(1) }).passthrough(),
        exits: z
          .array(z.object({ kind: z.string() }).passthrough())
          .length(2)
          .refine((exits) => exits.some((exit) => exit.kind === "ATR_STOP"))
          .refine((exits) => exits.some((exit) => exit.kind === "TIME")),
      })
      .passthrough(),
  })
  .passthrough();

export function isHealthyCatalog(value: unknown): boolean {
  return CatalogHealthSchema.safeParse(value).success;
}

export function isHealthyCompilerResult(value: unknown): boolean {
  return CompilerHealthSchema.safeParse(value).success;
}
