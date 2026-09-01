import { chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

interface MonitorLeaseOptions {
  filePath?: string;
  pid?: number;
  processExists?: (pid: number) => boolean;
}

function defaultProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export async function acquireMonitorProcessLease(
  options: MonitorLeaseOptions = {},
): Promise<() => Promise<void>> {
  const filePath =
    options.filePath ?? path.join(process.cwd(), ".qos", "runtime", "live-monitor.lock");
  const pid = options.pid ?? process.pid;
  const processExists = options.processExists ?? defaultProcessExists;
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filePath, "wx", 0o600);
      await handle.writeFile(`${pid}\n`, "utf8");
      await handle.close();
      return async () => {
        try {
          const owner = Number((await readFile(filePath, "utf8")).trim());
          if (owner === pid) await unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number((await readFile(filePath, "utf8")).trim());
      if (Number.isInteger(owner) && owner > 0 && processExists(owner)) {
        throw new Error(`QOS monitor is already running with PID ${owner}.`);
      }
      await unlink(filePath);
    }
  }
  throw new Error("Could not acquire the QOS monitor process lease.");
}
