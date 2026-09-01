import { z } from "zod";

import {
  ResearchStrategySchema,
  createReferenceResearchStrategy,
  type ResearchStrategy,
} from "./advanced-strategy";
import { getInstrumentDefinition, type InstrumentId, type InstrumentSummary } from "./instruments";

type SelectedInstrument = Pick<InstrumentSummary, "instrumentId" | "market" | "symbol">;

export type StrategyCompiler = "openai" | "reference-template";

export interface CompiledResearchStrategy {
  ok: true;
  compiler: StrategyCompiler;
  strategy: ResearchStrategy;
  warnings: string[];
}

export class StrategyCompilerError extends Error {
  constructor(
    public readonly code:
      "LLM_NOT_CONFIGURED" | "LLM_UNAVAILABLE" | "INVALID_MODEL_OUTPUT" | "UNSUPPORTED_REFERENCE",
    message: string,
  ) {
    super(message);
  }
}

const OpenAIResponseSchema = z
  .object({
    output: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function looksLikeReferenceStrategy(prompt: string): boolean {
  const normalized = prompt.toLocaleLowerCase("ko-KR");
  return (
    normalized.includes("vwap") &&
    (normalized.includes("5분") || normalized.includes("5-minute")) &&
    ["atr", "chandelier", "일목", "ichimoku", "trailing", "트레일링"].filter((word) =>
      normalized.includes(word),
    ).length >= 2
  );
}

function extractOutputText(payload: unknown): string {
  const response = OpenAIResponseSchema.parse(payload);
  for (const item of response.output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new StrategyCompilerError("INVALID_MODEL_OUTPUT", "LLM 응답에 전략 JSON이 없습니다.");
}

export function retryDelayMilliseconds(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 1_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(Math.max(retryAt - Date.now(), 0), 1_000);
  }
  return Math.min(250 * 2 ** attempt, 1_000);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestOpenAI(
  prompt: string,
  instrumentId: InstrumentId,
  selectedInstrument?: SelectedInstrument,
): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new StrategyCompilerError(
      "LLM_NOT_CONFIGURED",
      "OPENAI_API_KEY가 없어 자유 문장 LLM 변환을 사용할 수 없습니다.",
    );
  }
  const instrument = selectedInstrument ?? getInstrumentDefinition(instrumentId);
  const requestBody = {
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    store: false,
    max_output_tokens: 2_000,
    instructions: [
      "Convert the user hypothesis into only the supplied Strategy v2 schema.",
      "Never emit code, formulas outside the allowlist, tools, URLs, or prose.",
      `The selected instrument is fixed: ${instrument.instrumentId}, market ${instrument.market}.`,
      "Allowed entry: 5-minute cross above rolling session VWAP.",
      "Allowed exits: Ichimoku Kijun cross, VWAP confirmation bars, ATR trailing, Chandelier, EMA cross, fixed trailing.",
      "If the user omits a parameter, use the reference defaults 15-session VWAP, ATR 14, Chandelier 22x3 with initial 1.5 ATR, EMA 9/21 and fixed trailing 2%.",
    ].join(" "),
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    text: {
      format: {
        type: "json_schema",
        name: "research_strategy_v2",
        strict: true,
        schema: z.toJSONSchema(ResearchStrategySchema),
      },
    },
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await wait(retryDelayMilliseconds(response, attempt));
        continue;
      }
      throw new StrategyCompilerError("LLM_UNAVAILABLE", "LLM 변환 요청을 완료하지 못했습니다.");
    } catch (error) {
      if (error instanceof StrategyCompilerError) throw error;
      if (attempt === 1) {
        throw new StrategyCompilerError("LLM_UNAVAILABLE", "LLM 연결 시간이 초과되었습니다.");
      }
      await wait(retryDelayMilliseconds(null, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new StrategyCompilerError("LLM_UNAVAILABLE", "LLM 변환 요청을 완료하지 못했습니다.");
}

export async function compileResearchStrategy(
  prompt: string,
  instrumentId: InstrumentId,
  selectedInstrument?: SelectedInstrument,
): Promise<CompiledResearchStrategy> {
  if (!process.env.OPENAI_API_KEY) {
    if (!looksLikeReferenceStrategy(prompt)) {
      throw new StrategyCompilerError(
        "LLM_NOT_CONFIGURED",
        "LLM 키를 설정하거나 5분봉 VWAP와 두 개 이상의 청산 기준을 포함한 예시를 사용해 주세요.",
      );
    }
    return {
      ok: true,
      compiler: "reference-template",
      strategy: createReferenceResearchStrategy(instrumentId, selectedInstrument),
      warnings: [
        "OPENAI_API_KEY가 없어 이 문장은 검증된 reference template로 변환했습니다.",
        "자유 문장 LLM 변환이 아니며 실행 전 JSON을 확인해야 합니다.",
      ],
    };
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(
      extractOutputText(await requestOpenAI(prompt, instrumentId, selectedInstrument)),
    );
  } catch (error) {
    if (error instanceof StrategyCompilerError) throw error;
    throw new StrategyCompilerError("INVALID_MODEL_OUTPUT", "LLM 전략 JSON을 해석할 수 없습니다.");
  }
  const parsed = ResearchStrategySchema.safeParse(candidate);
  if (!parsed.success || parsed.data.instrumentId !== instrumentId) {
    throw new StrategyCompilerError(
      "INVALID_MODEL_OUTPUT",
      "LLM 결과가 실행 가능한 Strategy v2 계약을 통과하지 못했습니다.",
    );
  }
  return {
    ok: true,
    compiler: "openai",
    strategy: parsed.data,
    warnings: [
      "LLM 출력은 untrusted candidate로 처리되어 strict Strategy v2 validation을 통과했습니다.",
      "의미와 파라미터를 확인한 뒤에만 백테스트하세요.",
    ],
  };
}
