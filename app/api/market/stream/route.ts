import { z } from "zod";

import { InstrumentIdSchema, MarketSchema } from "@/src/domain/instruments";
import { apiError, requestId, tossErrorResponse } from "@/src/server/http";
import { getTossClient } from "@/src/server/toss/client";
import { TossRealtimeConnection } from "@/src/server/toss/realtime";

export const runtime = "nodejs";

const QuerySchema = z.object({ instrumentId: InstrumentIdSchema }).strict();

function event(name: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request): Promise<Response> {
  const id = requestId();
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    instrumentId: url.searchParams.get("instrumentId") ?? "",
  });
  if (!parsed.success)
    return apiError(400, "invalid_request", "실시간 종목 id를 확인해 주세요.", id);
  const separator = parsed.data.instrumentId.indexOf(":");
  const market = MarketSchema.parse(parsed.data.instrumentId.slice(0, separator));
  const symbol = parsed.data.instrumentId.slice(separator + 1);

  try {
    const client = getTossClient();
    let connection: TossRealtimeConnection | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const enqueue = (name: string, payload: unknown) => {
          if (!closed) controller.enqueue(event(name, payload));
        };
        connection = new TossRealtimeConnection({
          client,
          instruments: [{ market, symbol }],
          reconnect: true,
          onTrade: (trade) => enqueue("trade", trade),
          onStatus: (status) => enqueue("status", { status }),
          onError: () => enqueue("status", { status: "error" }),
        });
        keepalive = setInterval(() => {
          if (!closed) controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
        }, 20_000);
        const close = () => {
          if (closed) return;
          closed = true;
          if (keepalive) clearInterval(keepalive);
          connection?.stop();
          try {
            controller.close();
          } catch {
            // The browser may already have closed the stream.
          }
        };
        request.signal.addEventListener("abort", close, { once: true });
        void connection.start();
      },
      cancel() {
        if (keepalive) clearInterval(keepalive);
        connection?.stop();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return tossErrorResponse(error, id);
  }
}
