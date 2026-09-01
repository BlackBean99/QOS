import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { StrategyDefinitionV3Schema } from "@/src/domain/strategy-v3/schema";

const examples = [
  "strategy-v3-ema-adx-2r.json",
  "strategy-v3-mtf-session-vwap-rvol.json",
  "strategy-v3-rolling-vwap-ichimoku.json",
];

describe("documented Strategy v3 examples", () => {
  it.each(examples)("keeps %s executable under the strict schema", (name) => {
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), "docs/examples", name), "utf8"),
    );
    expect(StrategyDefinitionV3Schema.safeParse(document).success).toBe(true);
  });
});
