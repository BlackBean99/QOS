import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { MonitorRunner } = await import("../src/monitor/runner");
const { acquireMonitorProcessLease } = await import("../src/monitor/process-lease");

const releaseLease = await acquireMonitorProcessLease();
const runner = new MonitorRunner();
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await runner.stop();
    process.exitCode = 0;
  } finally {
    await releaseLease();
  }
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  await runner.start();
} catch (error) {
  await releaseLease();
  throw error;
}
