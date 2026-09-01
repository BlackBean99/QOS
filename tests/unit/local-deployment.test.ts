import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isHealthyCatalog,
  isHealthyCompilerResult,
  isOwnedLocalProductionCommand,
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

  it("recognizes only this repository's loopback next production command", () => {
    const nextBinary = path.join(repositoryRoot, "node_modules", "next", "dist", "bin", "next");
    const command = `${process.execPath} ${nextBinary} start -H 127.0.0.1 -p 3000`;

    expect(isOwnedLocalProductionCommand(command, repositoryRoot, 3000)).toBe(true);
    expect(
      isOwnedLocalProductionCommand(command.replace(" start ", " dev "), repositoryRoot, 3000),
    ).toBe(false);
    expect(
      isOwnedLocalProductionCommand(command.replace("127.0.0.1", "0.0.0.0"), repositoryRoot, 3000),
    ).toBe(false);
    expect(isOwnedLocalProductionCommand(command, "/Users/example/AnotherApp", 3000)).toBe(false);
    expect(isOwnedLocalProductionCommand(command, repositoryRoot, 3001)).toBe(false);
  });

  it("rejects stale or cross-repository deployment state", () => {
    const valid = JSON.stringify({
      version: 1,
      pid: 1234,
      port: 3000,
      host: "127.0.0.1",
      repositoryRoot,
      commit: "f390fa0425c9528c29eb299b15d452a9467571bd",
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
  });
});
