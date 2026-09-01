import {
  ENTRY_PRESETS_V3,
  EXIT_PRESETS_V3,
  FILTER_PRESETS_V3,
  STRATEGY_CATALOG_V3,
} from "@/src/domain/strategy-v3/catalog";
import { jsonNoStore } from "@/src/server/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const presets = STRATEGY_CATALOG_V3.map((preset) => {
    const metadata: Partial<typeof preset> = { ...preset };
    Reflect.deleteProperty(metadata, "create");
    return metadata;
  });
  return jsonNoStore({
    version: 3,
    presets,
    counts: {
      entry: ENTRY_PRESETS_V3.length,
      filter: FILTER_PRESETS_V3.length,
      exit: EXIT_PRESETS_V3.length,
      total: presets.length,
    },
    ruleLimits: { leaves: 64, depth: 8, exits: 40 },
  });
}
