import { interpretStrategy } from "@/src/domain/interpret";
import { InstrumentIdSchema } from "@/src/domain/instruments";
import { InstrumentSnapshotSchema } from "@/src/domain/stored-strategy";
import { z } from "zod";

export const runtime = "nodejs";

const RequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2_000),
    instrumentId: InstrumentIdSchema,
    instrument: InstrumentSnapshotSchema.optional(),
  })
  .strict();

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { ok: false, issues: [{ field: "prompt", message: "유효한 JSON 요청이 필요합니다." }] },
      400,
    );
  }

  const requestResult = RequestSchema.safeParse(body);
  if (!requestResult.success) {
    const instrumentIssue = requestResult.error.issues.some((issue) =>
      issue.path.includes("instrumentId"),
    );
    return json(
      {
        ok: false,
        issues: [
          instrumentIssue
            ? { field: "instrument", message: "TOSS 종목을 검색해 선택해 주세요." }
            : { field: "prompt", message: "전략 설명은 1~2,000자여야 합니다." },
        ],
      },
      422,
    );
  }

  const result = interpretStrategy(
    requestResult.data.prompt,
    requestResult.data.instrumentId,
    requestResult.data.instrument,
  );
  return json(result, result.ok ? 200 : 422);
}
