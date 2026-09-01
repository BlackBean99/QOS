import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import {
  LOCAL_DEPLOYMENT_HOST,
  isHealthyCatalog,
  isHealthyCompilerResult,
  isHealthyMonitorStatus,
  isOwnedRunningLocalMonitorProcess,
  isOwnedRunningLocalProductionProcess,
  localMonitorCommand,
  localNextCommand,
  matchesLocalMonitorDeploymentState,
  matchesLocalDeploymentState,
  parseLocalDeploymentPort,
  parseLocalDeploymentState,
  type LocalDeploymentState,
} from "../src/server/local-deployment";

const execFile = promisify(execFileCallback);
const repositoryRoot = process.cwd();
const runtimeDirectory = path.join(repositoryRoot, ".qos", "runtime");
const statePath = path.join(runtimeDirectory, "local-production.json");
const lockPath = path.join(runtimeDirectory, "local-deploy.lock");
const logPath = path.join(runtimeDirectory, "local-production.log");
const command = process.argv[2];

interface RunningProcessInfo {
  command: string;
  cwd: string;
  listener: string;
  startedAt: string;
}

interface RunningMonitorInfo {
  command: string;
  cwd: string;
  startedAt: string;
}

interface RunningServerIdentity {
  command: string;
  cwd: string;
  startedAt: string;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown local deployment error.";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function readLocalState(): Promise<LocalDeploymentState | null> {
  try {
    return parseLocalDeploymentState(await readFile(statePath, "utf8"), repositoryRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function ensureRuntimeDirectory(): Promise<void> {
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
}

async function writeLocalState(state: LocalDeploymentState): Promise<void> {
  await ensureRuntimeDirectory();
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  await appendFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, statePath);
  await chmod(statePath, 0o600);
}

async function removeState(): Promise<void> {
  try {
    await unlink(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function processOutput(executable: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFile(executable, args, { encoding: "utf8" });
    return result.stdout.trim();
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 1 || code === "ESRCH") return null;
    throw error;
  }
}

async function inspectProcess(pid: number, port: number): Promise<RunningProcessInfo | null> {
  if (!(await processExists(pid))) return null;
  const [processCommand, startedAt, cwdOutput, listenerOutput] = await Promise.all([
    processOutput("/bin/ps", ["-p", String(pid), "-o", "command="]),
    processOutput("/bin/ps", ["-p", String(pid), "-o", "lstart="]),
    processOutput("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
    processOutput("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-p",
      String(pid),
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fn",
    ]),
  ]);
  const cwd = cwdOutput
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  const listener = listenerOutput
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  if (!processCommand || !startedAt || !cwd || !listener) return null;
  return { command: processCommand, startedAt, cwd, listener };
}

async function inspectServerIdentity(pid: number): Promise<RunningServerIdentity | null> {
  if (!(await processExists(pid))) return null;
  const [processCommand, startedAt, cwdOutput] = await Promise.all([
    processOutput("/bin/ps", ["-p", String(pid), "-o", "command="]),
    processOutput("/bin/ps", ["-p", String(pid), "-o", "lstart="]),
    processOutput("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
  ]);
  const cwd = cwdOutput
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  if (!processCommand || !startedAt || !cwd) return null;
  return { command: processCommand, startedAt, cwd };
}

function matchesServerIdentity(
  processInfo: RunningServerIdentity,
  state: LocalDeploymentState,
): boolean {
  return (
    processInfo.startedAt === state.processStartedAt &&
    /^next-server \(v\d+\.\d+\.\d+\)$/.test(processInfo.command.trim()) &&
    path.resolve(processInfo.cwd) === path.resolve(repositoryRoot)
  );
}

async function inspectMonitorProcess(pid: number): Promise<RunningMonitorInfo | null> {
  if (!(await processExists(pid))) return null;
  const [processCommand, startedAt, cwdOutput] = await Promise.all([
    processOutput("/bin/ps", ["-p", String(pid), "-o", "command="]),
    processOutput("/bin/ps", ["-p", String(pid), "-o", "lstart="]),
    processOutput("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
  ]);
  const cwd = cwdOutput
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  if (!processCommand || !startedAt || !cwd) return null;
  return { command: processCommand, startedAt, cwd };
}

function assertOwnedProcess(
  state: LocalDeploymentState,
  processInfo: RunningProcessInfo | null,
): asserts processInfo is RunningProcessInfo {
  if (!processInfo) throw new Error("Managed local production process is not running.");
  if (!matchesLocalDeploymentState(processInfo, state, repositoryRoot)) {
    throw new Error("Refusing to manage a PID that is not the owned QOS loopback server.");
  }
}

function assertOwnedMonitorProcess(
  state: Extract<LocalDeploymentState, { version: 2 }>,
  processInfo: RunningMonitorInfo | null,
): asserts processInfo is RunningMonitorInfo {
  if (!processInfo) throw new Error("Managed local monitor process is not running.");
  if (!matchesLocalMonitorDeploymentState(processInfo, state, repositoryRoot)) {
    throw new Error("Refusing to manage a PID that is not the owned QOS monitor worker.");
  }
}

async function waitForExit(pid: number, timeoutMilliseconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!(await processExists(pid))) return true;
    await wait(100);
  }
  return !(await processExists(pid));
}

async function stopManagedServer(): Promise<"stopped" | "already-stopped" | "stale-state"> {
  const state = await readLocalState();
  if (!state) return "already-stopped";
  const processInfo = await inspectProcess(state.pid, state.port);
  const serverIdentity = processInfo ?? (await inspectServerIdentity(state.pid));
  const monitorInfo = state.version === 2 ? await inspectMonitorProcess(state.monitorPid) : null;
  if (serverIdentity && !matchesServerIdentity(serverIdentity, state)) {
    throw new Error(
      "Managed process is still running, but its ownership could not be verified. Refusing to manage it.",
    );
  }
  if (state.version === 2 && !monitorInfo && (await processExists(state.monitorPid))) {
    throw new Error(
      "Managed monitor is still running, but its ownership could not be verified. Refusing to manage it.",
    );
  }
  if (!serverIdentity && !monitorInfo) {
    await removeState();
    return "stale-state";
  }
  if (processInfo) assertOwnedProcess(state, processInfo);
  if (state.version === 2 && monitorInfo) assertOwnedMonitorProcess(state, monitorInfo);

  if (state.version === 2 && monitorInfo) {
    process.kill(state.monitorPid, "SIGTERM");
    if (!(await waitForExit(state.monitorPid, 5_000))) {
      const stillRunning = await inspectMonitorProcess(state.monitorPid);
      assertOwnedMonitorProcess(state, stillRunning);
      process.kill(state.monitorPid, "SIGKILL");
      if (!(await waitForExit(state.monitorPid, 2_000))) {
        throw new Error("Owned local monitor process did not stop.");
      }
    }
  }
  if (serverIdentity) {
    process.kill(state.pid, "SIGTERM");
    if (!(await waitForExit(state.pid, 5_000))) {
      const stillRunning = await inspectServerIdentity(state.pid);
      if (!stillRunning || !matchesServerIdentity(stillRunning, state)) {
        throw new Error("Owned local production process identity changed while stopping.");
      }
      process.kill(state.pid, "SIGKILL");
      if (!(await waitForExit(state.pid, 2_000))) {
        throw new Error("Owned local production process did not stop.");
      }
    }
  }
  await removeState();
  return "stopped";
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => reject(error));
    server.listen(port, LOCAL_DEPLOYMENT_HOST, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is occupied by an unmanaged process. Stop it explicitly or set QOS_LOCAL_PORT.`,
      );
    }
    throw error;
  });
}

async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} health check returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} health check did not return JSON.`, { cause: error });
  }
}

async function checkHealth(port: number): Promise<void> {
  const baseUrl = `http://${LOCAL_DEPLOYMENT_HOST}:${port}`;
  const home = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
  if (!home.ok) throw new Error(`Home health check returned HTTP ${home.status}.`);
  await home.arrayBuffer();
  const catalog = await readJson(
    await fetch(`${baseUrl}/api/strategy-engine/catalog`, {
      signal: AbortSignal.timeout(2_000),
    }),
    "Catalog",
  );
  if (!isHealthyCatalog(catalog)) throw new Error("Catalog health contract failed.");
  const compiled = await readJson(
    await fetch(`${baseUrl}/api/strategy-engine/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instrumentId: "NASDAQ:NVDA",
        prompt:
          "EMA crossover 그리고 RSI oversold rebound 그리고 Bollinger breakout, ADX 25 이상 필터, ATR stop과 time stop",
      }),
      signal: AbortSignal.timeout(2_000),
    }),
    "Compiler",
  );
  if (!isHealthyCompilerResult(compiled)) throw new Error("Compiler health contract failed.");
}

async function waitForHealth(port: number, pid: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError = "server did not respond";
  while (Date.now() < deadline) {
    if (!(await processExists(pid)))
      throw new Error("Local production process exited during startup.");
    try {
      await checkHealth(port);
      return;
    } catch (error) {
      lastError = safeMessage(error);
      await wait(300);
    }
  }
  throw new Error(`Local production health timed out: ${lastError}`);
}

async function waitForMonitorHealth(port: number, pid: number, launchedAt: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError = "monitor heartbeat did not respond";
  while (Date.now() < deadline) {
    if (!(await processExists(pid)))
      throw new Error("Local monitor process exited during startup.");
    try {
      const response = await fetch(`http://${LOCAL_DEPLOYMENT_HOST}:${port}/api/monitor/status`, {
        signal: AbortSignal.timeout(2_000),
      });
      const body = await readJson(response, "Monitor");
      if (isHealthyMonitorStatus(body, launchedAt)) {
        return;
      }
      lastError = "monitor status is unhealthy or its heartbeat is stale";
    } catch (error) {
      lastError = safeMessage(error);
    }
    await wait(250);
  }
  throw new Error(`Local monitor health timed out: ${lastError}`);
}

async function spawnLogged(commandLine: string[]): Promise<number> {
  const log = await open(logPath, "a", 0o600);
  const [executable, ...args] = commandLine;
  const child = spawn(executable, args, {
    cwd: repositoryRoot,
    detached: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", log.fd, log.fd],
  });
  const pid = child.pid;
  if (!pid) {
    await log.close();
    throw new Error("Failed to obtain a local process id.");
  }
  child.unref();
  await log.close();
  return pid;
}

async function gitMetadata(): Promise<{ commit: string; dirty: boolean }> {
  const commit = (
    await execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  const dirty = (
    await execFile("git", ["status", "--porcelain"], { cwd: repositoryRoot })
  ).stdout.trim();
  return { commit, dirty: dirty.length > 0 };
}

async function deploy(): Promise<void> {
  const port = parseLocalDeploymentPort(process.env.QOS_LOCAL_PORT);
  const buildIdPath = path.join(repositoryRoot, ".next", "BUILD_ID");
  if (!(await fileExists(buildIdPath))) {
    throw new Error("Production build is missing. Run npm run build before local deployment.");
  }
  const previous = await stopManagedServer();
  await assertPortAvailable(port);
  await ensureRuntimeDirectory();
  await appendFile(logPath, `\n[${new Date().toISOString()}] local production deploy\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(logPath, 0o600);
  const pid = await spawnLogged(localNextCommand(repositoryRoot, port));
  let monitorPid: number | null = null;
  try {
    await waitForHealth(port, pid);
    const processInfo = await inspectProcess(pid, port);
    if (!processInfo || !isOwnedRunningLocalProductionProcess(processInfo, repositoryRoot, port)) {
      throw new Error("Started process did not match the QOS loopback ownership contract.");
    }
    const monitorLaunchedAt = Date.now();
    monitorPid = await spawnLogged(localMonitorCommand(repositoryRoot));
    await waitForMonitorHealth(port, monitorPid, monitorLaunchedAt);
    const monitorInfo = await inspectMonitorProcess(monitorPid);
    if (!monitorInfo || !isOwnedRunningLocalMonitorProcess(monitorInfo, repositoryRoot)) {
      throw new Error("Started process did not match the QOS monitor ownership contract.");
    }
    const source = await gitMetadata();
    const state: LocalDeploymentState = {
      version: 2,
      pid,
      monitorPid,
      port,
      host: LOCAL_DEPLOYMENT_HOST,
      repositoryRoot,
      commit: source.commit,
      dirty: source.dirty,
      processStartedAt: processInfo.startedAt,
      monitorProcessStartedAt: monitorInfo.startedAt,
      startedAt: new Date().toISOString(),
    };
    await writeLocalState(state);
    console.log(
      JSON.stringify(
        {
          status: "running",
          previous,
          url: `http://${LOCAL_DEPLOYMENT_HOST}:${port}`,
          pid,
          monitorPid,
          commit: source.commit,
          dirty: source.dirty,
          log: logPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (monitorPid && (await processExists(monitorPid))) {
      process.kill(monitorPid, "SIGTERM");
      if (!(await waitForExit(monitorPid, 2_000))) {
        const monitorInfo = await inspectMonitorProcess(monitorPid);
        if (monitorInfo && isOwnedRunningLocalMonitorProcess(monitorInfo, repositoryRoot)) {
          process.kill(monitorPid, "SIGKILL");
          await waitForExit(monitorPid, 2_000);
        }
      }
    }
    if (await processExists(pid)) {
      process.kill(pid, "SIGTERM");
      if (!(await waitForExit(pid, 2_000))) {
        process.kill(pid, "SIGKILL");
        await waitForExit(pid, 2_000);
      }
    }
    throw error;
  }
}

async function status(): Promise<void> {
  const state = await readLocalState();
  if (!state) {
    console.log(JSON.stringify({ status: "stopped" }, null, 2));
    return;
  }
  const processInfo = await inspectProcess(state.pid, state.port);
  assertOwnedProcess(state, processInfo);
  await checkHealth(state.port);
  let monitorPid: number | null = null;
  if (state.version === 2) {
    const monitorInfo = await inspectMonitorProcess(state.monitorPid);
    assertOwnedMonitorProcess(state, monitorInfo);
    await waitForMonitorHealth(state.port, state.monitorPid, Date.now() - 120_000);
    monitorPid = state.monitorPid;
  }
  console.log(
    JSON.stringify(
      {
        status: "healthy",
        url: `http://${state.host}:${state.port}`,
        pid: state.pid,
        monitorPid,
        commit: state.commit,
        dirty: state.dirty,
        startedAt: state.startedAt,
        log: logPath,
      },
      null,
      2,
    ),
  );
}

async function acquireLock(): Promise<() => Promise<void>> {
  await ensureRuntimeDirectory();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(`${process.pid}\n`, "utf8");
      await lock.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockPid = Number((await readFile(lockPath, "utf8")).trim());
      if (Number.isInteger(lockPid) && lockPid > 0 && (await processExists(lockPid))) {
        throw new Error(`Another local deployment command is running with PID ${lockPid}.`);
      }
      await unlink(lockPath);
    }
  }
  throw new Error("Could not acquire the local deployment lock.");
}

async function main(): Promise<void> {
  if (!command || !["deploy", "status", "stop"].includes(command)) {
    throw new Error("Usage: tsx scripts/local-deploy.ts <deploy|status|stop>");
  }
  if (command === "status") {
    await status();
    return;
  }
  const releaseLock = await acquireLock();
  try {
    if (command === "deploy") await deploy();
    else console.log(JSON.stringify({ status: await stopManagedServer() }, null, 2));
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  console.error(`Local deployment failed: ${safeMessage(error)}`);
  process.exitCode = 1;
});
