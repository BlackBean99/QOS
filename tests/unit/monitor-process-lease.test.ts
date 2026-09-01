import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireMonitorProcessLease } from "@/src/monitor/process-lease";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("monitor process lease", () => {
  it("admits one worker, rejects a live owner and releases only its own lease", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-lease-"));
    directories.push(directory);
    const filePath = path.join(directory, "monitor.lock");
    const release = await acquireMonitorProcessLease({
      filePath,
      pid: 1234,
      processExists: (pid) => pid === 1234,
    });

    await expect(
      acquireMonitorProcessLease({
        filePath,
        pid: 5678,
        processExists: (pid) => pid === 1234,
      }),
    ).rejects.toThrow(/already running.*1234/);
    expect(await readFile(filePath, "utf8")).toBe("1234\n");
    await release();
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims a stale worker lease", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-monitor-lease-"));
    directories.push(directory);
    const filePath = path.join(directory, "monitor.lock");
    await writeFile(filePath, "9999\n");

    const release = await acquireMonitorProcessLease({
      filePath,
      pid: 1234,
      processExists: () => false,
    });
    expect(await readFile(filePath, "utf8")).toBe("1234\n");
    await release();
  });
});
