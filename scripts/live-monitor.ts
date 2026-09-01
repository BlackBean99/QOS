import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { MonitorRunner } = await import("../src/monitor/runner");

const runner = new MonitorRunner();
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await runner.stop();
  process.exitCode = 0;
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

await runner.start();
