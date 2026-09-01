import { describe, expect, it } from "vitest";

import {
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
} from "@/src/server/local-deployment";

const repositoryRoot = "/Users/example/QOS";

describe("local deployment safety contract", () => {
  it("uses a bounded unprivileged loopback port", () => {
    expect(parseLocalDeploymentPort(undefined)).toBe(3000);
    expect(parseLocalDeploymentPort("4310")).toBe(4310);
    expect(() => parseLocalDeploymentPort("1023")).toThrow(/1024/);
    expect(() => parseLocalDeploymentPort("65536")).toThrow(/65535/);
    expect(() => parseLocalDeploymentPort("3000.5")).toThrow(/integer/);
  });

  it("constructs the repository-local Next command with an explicit loopback listener", () => {
    expect(localNextCommand(repositoryRoot, 3000)).toEqual([
      process.execPath,
      `${repositoryRoot}/node_modules/next/dist/bin/next`,
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      "3000",
    ]);
    expect(localMonitorCommand(repositoryRoot)).toEqual([
      process.execPath,
      `${repositoryRoot}/node_modules/tsx/dist/cli.mjs`,
      `${repositoryRoot}/scripts/live-monitor.ts`,
    ]);
  });

  it("recognizes only the repository-local long-running monitor command", () => {
    const processInfo = {
      command: `${process.execPath} ${repositoryRoot}/node_modules/tsx/dist/cli.mjs ${repositoryRoot}/scripts/live-monitor.ts`,
      cwd: repositoryRoot,
      startedAt: "Tue Sep  1 14:00:01 2026",
    };
    expect(isOwnedRunningLocalMonitorProcess(processInfo, repositoryRoot)).toBe(true);
    expect(
      isOwnedRunningLocalMonitorProcess(
        { ...processInfo, cwd: "/Users/example/AnotherApp" },
        repositoryRoot,
      ),
    ).toBe(false);
    expect(
      matchesLocalMonitorDeploymentState(
        processInfo,
        { monitorProcessStartedAt: processInfo.startedAt },
        repositoryRoot,
      ),
    ).toBe(true);
  });

  it("recognizes a renamed next-server process only with matching cwd and loopback listener", () => {
    const processInfo = {
      command: "next-server (v16.3.2)",
      cwd: repositoryRoot,
      listener: "127.0.0.1:3000",
      startedAt: "Tue Sep  1 14:00:00 2026",
    };
    expect(isOwnedRunningLocalProductionProcess(processInfo, repositoryRoot, 3000)).toBe(true);
    expect(
      isOwnedRunningLocalProductionProcess(
        { command: "next-server (v16.3.2)", cwd: repositoryRoot, listener: "*:3000" },
        repositoryRoot,
        3000,
      ),
    ).toBe(false);
    expect(
      isOwnedRunningLocalProductionProcess(
        {
          command: "next-server (v16.3.2)",
          cwd: "/Users/example/AnotherApp",
          listener: "127.0.0.1:3000",
        },
        repositoryRoot,
        3000,
      ),
    ).toBe(false);
    expect(
      matchesLocalDeploymentState(
        processInfo,
        { port: 3000, processStartedAt: processInfo.startedAt },
        repositoryRoot,
      ),
    ).toBe(true);
    expect(
      matchesLocalDeploymentState(
        processInfo,
        { port: 3000, processStartedAt: "Tue Sep  1 14:00:01 2026" },
        repositoryRoot,
      ),
    ).toBe(false);
  });

  it("rejects stale or cross-repository deployment state", () => {
    const valid = JSON.stringify({
      version: 1,
      pid: 1234,
      port: 3000,
      host: "127.0.0.1",
      repositoryRoot,
      commit: "f390fa0425c9528c29eb299b15d452a9467571bd",
      processStartedAt: "Tue Sep  1 14:00:00 2026",
      startedAt: "2026-09-01T03:00:00.000Z",
    });

    expect(parseLocalDeploymentState(valid, repositoryRoot)).toMatchObject({
      pid: 1234,
      host: "127.0.0.1",
      port: 3000,
    });
    expect(() => parseLocalDeploymentState(valid, "/Users/example/AnotherApp")).toThrow(
      /repository/,
    );
    expect(() =>
      parseLocalDeploymentState(valid.replace("127.0.0.1", "0.0.0.0"), repositoryRoot),
    ).toThrow(/loopback/);
  });

  it("parses the managed server and monitor state while retaining v1 rollback compatibility", () => {
    const state = parseLocalDeploymentState(
      JSON.stringify({
        version: 2,
        pid: 1234,
        monitorPid: 1235,
        port: 3000,
        host: "127.0.0.1",
        repositoryRoot,
        commit: "f390fa0425c9528c29eb299b15d452a9467571bd",
        dirty: false,
        processStartedAt: "Tue Sep  1 14:00:00 2026",
        monitorProcessStartedAt: "Tue Sep  1 14:00:01 2026",
        startedAt: "2026-09-01T03:00:00.000Z",
      }),
      repositoryRoot,
    );

    expect(state).toMatchObject({ version: 2, pid: 1234, monitorPid: 1235 });
  });

  it("requires the complete catalog and a multi-entry compiler result for health", () => {
    expect(isHealthyCatalog({ counts: { entry: 42, filter: 8, exit: 20, total: 70 } })).toBe(true);
    expect(isHealthyCatalog({ counts: { entry: 2, filter: 8, exit: 20, total: 30 } })).toBe(false);

    expect(
      isHealthyCompilerResult({
        compiler: "deterministic-dsl",
        strategy: {
          version: 3,
          entry: { children: [{}, {}, {}] },
          filters: { children: [{}] },
          exits: [{ kind: "ATR_STOP" }, { kind: "TIME" }],
        },
      }),
    ).toBe(true);
    expect(
      isHealthyCompilerResult({
        compiler: "deterministic-dsl",
        strategy: { version: 3, entry: { children: [{}] }, filters: { children: [] }, exits: [] },
      }),
    ).toBe(false);

    const heartbeatAt = "2026-09-01T03:00:00.000Z";
    const monitor = {
      status: "connected",
      heartbeatAt,
      enabledStrategies: 1,
      lastErrorCode: null,
      providerRequests: 2,
      datasetCacheHits: 3,
    };
    expect(isHealthyMonitorStatus(monitor, Date.parse(heartbeatAt))).toBe(true);
    expect(isHealthyMonitorStatus({ ...monitor, status: "error" }, Date.parse(heartbeatAt))).toBe(
      false,
    );
    expect(isHealthyMonitorStatus(monitor, Date.parse(heartbeatAt) + 1)).toBe(false);
  });
});
