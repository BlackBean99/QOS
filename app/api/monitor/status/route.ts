import { jsonNoStore, requestId } from "@/src/server/http";
import { getMonitorStateStore, type MonitorStateStore } from "@/src/monitor/state-store";

export const runtime = "nodejs";

export function createGetMonitorStatus(store: MonitorStateStore) {
  return async function get(): Promise<Response> {
    return jsonNoStore({ ...(await store.publicStatus()), requestId: requestId() });
  };
}

export const GET = createGetMonitorStatus(getMonitorStateStore());
