import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { InstrumentCatalogStore } from "@/src/server/toss/instrument-catalog-store";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("InstrumentCatalogStore", () => {
  it("atomically persists validated market rows with private permissions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-instrument-catalog-store-"));
    directories.push(directory);
    const filePath = path.join(directory, "nested", "catalog.json");
    const store = new InstrumentCatalogStore({ filePath });
    const fetchedAt = "2026-09-01T00:00:00.000Z";

    await store.put("KOSPI", fetchedAt, [
      {
        symbol: "069500",
        name: "KODEX 200",
        securityType: "ETF",
        isCommonShare: true,
        isinCode: "KR7069500007",
      },
    ]);

    await expect(store.get("KOSPI")).resolves.toEqual({
      market: "KOSPI",
      fetchedAt,
      rows: [
        {
          symbol: "069500",
          name: "KODEX 200",
          securityType: "ETF",
          isCommonShare: true,
          isinCode: "KR7069500007",
        },
      ],
    });
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
  });

  it("preserves existing markets across serialized writes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "qos-instrument-catalog-store-"));
    directories.push(directory);
    const store = new InstrumentCatalogStore({ filePath: path.join(directory, "catalog.json") });
    const row = {
      symbol: "AAPL",
      name: "애플",
      securityType: "STOCK",
      isCommonShare: true,
      isinCode: "US0378331005",
    };

    await Promise.all([
      store.put("NASDAQ", "2026-09-01T00:00:00.000Z", [row]),
      store.put("NYSE", "2026-09-01T00:00:01.000Z", [{ ...row, symbol: "IBM" }]),
    ]);

    await expect(store.get("NASDAQ")).resolves.toMatchObject({ rows: [{ symbol: "AAPL" }] });
    await expect(store.get("NYSE")).resolves.toMatchObject({ rows: [{ symbol: "IBM" }] });
  });
});
