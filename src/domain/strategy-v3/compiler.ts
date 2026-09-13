import { z } from "zod";

import type { InstrumentId } from "@/src/domain/instruments";
import {
  ENTRY_PRESETS_V3,
  EXIT_PRESETS_V3,
  FILTER_PRESETS_V3,
  createPresetStrategyV3,
  isPresetTimeframeSupportedV3,
} from "./catalog";
import {
  StrategyDefinitionV3Schema,
  StrategyTimeframeSchema,
  type RuleNode,
  type StrategyDefinitionV3,
  type StrategyTimeframe,
} from "./schema";

export interface CompiledStrategyV3 {
  ok: true;
  compiler: "deterministic-dsl" | "openai";
  strategy: StrategyDefinitionV3;
  warnings: string[];
}

export class StrategyV3CompilerError extends Error {
  constructor(
    public readonly code: "UNSUPPORTED_PROMPT" | "LLM_UNAVAILABLE" | "INVALID_MODEL_OUTPUT",
    message: string,
  ) {
    super(message);
  }
}

const entryPatterns: Array<[RegExp, string]> = [
  [
    /(?:15\s*분|15m).*(?:시가|open).*?(?:session|세션)?.*vwap|(?:시가|open).*(?:session|세션).*vwap/i,
    "session-vwap-open-cross",
  ],
  [/multi[- ]?timeframe|다중.*시간|상위.*타임|daily.*5m|일봉.*5분/i, "multi-timeframe-trend-entry"],
  [/opening range|오프닝.*레인지|시초가.*범위|\bORB\b/i, "opening-range-breakout"],
  [/anchored.*vwap|anchor.*vwap|앵커.*vwap/i, "anchored-vwap-breakout"],
  [/weekly.*vwap|주간.*vwap/i, "weekly-vwap-breakout"],
  [/monthly.*vwap|월간.*vwap/i, "monthly-vwap-breakout"],
  [/vwap.*(?:band|standard deviation|표준편차|시그마|σ)/i, "vwap-deviation-band-reentry"],
  [/vwap.*(?:breakdown|하향 이탈|하향 돌파)/i, "vwap-breakdown-entry"],
  [/rolling.*vwap|\d+\s*일.*vwap|이동.*vwap/i, "rolling-vwap-breakout"],
  [/vwap.*mean|vwap.*평균.*회귀|vwap.*이격|vwap.*z.?score/i, "vwap-mean-reversion"],
  [/vwap.*pullback|vwap.*눌림/i, "vwap-pullback"],
  [/vwap.*reclaim|vwap.*복귀|vwap.*재돌파/i, "vwap-reclaim"],
  [/session.*vwap|세션.*vwap|vwap.*돌파/i, "session-vwap-breakout"],
  [/bollinger.*squeeze|볼린저.*스퀴즈|밴드.*폭.*축소/i, "bollinger-squeeze"],
  [/bollinger.*re.?entry|볼린저.*재진입|볼린저.*평균.*회귀/i, "bollinger-mean-reversion"],
  [/bollinger.*break|볼린저.*돌파/i, "bollinger-breakout"],
  [/keltner|켈트너/i, "keltner-breakout"],
  [/atr.*volatility.*break|atr.*변동성.*돌파/i, "atr-volatility-breakout"],
  [/volume.*break|거래량.*돌파/i, "volume-confirmed-breakout"],
  [/obv/i, "obv-breakout"],
  [/chaikin|cmf|자금.*흐름/i, "cmf-money-flow"],
  [/relative volume|rvol|상대.*거래량/i, "relative-volume-entry"],
  [/support.*resistance|지지.*저항|저항.*돌파/i, "support-resistance-breakout"],
  [/previous high|previous low|전고점|전저점/i, "previous-level-breakout"],
  [
    /market structure|swing.*break|pivot.*break|시장.*구조|스윙.*돌파/i,
    "market-structure-breakout",
  ],
  [/donchian|돈치안/i, "donchian-channel-breakout"],
  [/n.?bar|고점.*돌파|최고가.*돌파/i, "n-bar-breakout"],
  [/ichimoku.*cloud.*break|일목.*구름.*돌파/i, "ichimoku-cloud-breakout"],
  [/kijun.*(?:reclaim|breakdown)|기준선.*(?:복귀|이탈)/i, "ichimoku-kijun-reclaim"],
  [/ichimoku|일목/i, "ichimoku-trend"],
  [/adx.*dmi|dmi.*adx/i, "adx-dmi-trend"],
  [/macd/i, "macd-crossover"],
  [/ema.*pullback|이평.*눌림|이동평균.*눌림/i, "ema-trend-pullback"],
  [
    /price.*(?:above|below).*moving average|가격.*이평선.*(?:위|아래)/i,
    "price-above-moving-average",
  ],
  [
    /moving average.*deviation|ma.*deviation|이평.*이격|이동평균.*이격/i,
    "moving-average-deviation",
  ],
  [/ema|sma|moving average|이평|이동평균|골든크로스/i, "ema-crossover"],
  [/roc|rate of change|변화율/i, "roc-momentum-breakout"],
  [/momentum|모멘텀/i, "momentum-breakout"],
  [/rsi.*mean|rsi.*평균.*회귀.*가격|rsi.*price.*confirm/i, "rsi-mean-reversion-confirmed"],
  [/rsi.*oversold|rsi.*과매도|rsi.*반등/i, "rsi-oversold-rebound"],
  [/rsi/i, "rsi-momentum"],
  [/stochastic|스토캐스틱/i, "stochastic-rebound"],
  [/z.?score|z점수|표준점수/i, "zscore-mean-reversion"],
];

const filterPatterns: Array<[RegExp, string]> = [
  [/adx[^,.\n]{0,16}(?:>|이상|필터)|adx filter/i, "adx-trend-filter"],
  [/상위.*타임|higher.*timeframe|daily.*ema|일봉.*ema/i, "higher-timeframe-trend"],
  [/relative volume|상대.*거래량|거래량.*\d+(?:\.\d+)?\s*배/i, "relative-volume-filter"],
  [/volume filter|평균.*거래량|거래량.*평균/i, "volume-filter"],
  [/atrp|atr.*filter|atr.*필터/i, "atr-volatility-filter"],
  [/band width|밴드.*폭/i, "bollinger-width-filter"],
  [/market regime|시장.*국면|추세장|횡보장/i, "market-regime-filter"],
  [/ema.*trend|이평.*추세/i, "ema-trend-filter"],
];

const exitPatterns: Array<[RegExp, string]> = [
  [
    /(?:15\s*분|15m).*(?:시가|open).*vwap.*(?:아래|하향|이탈|매도|sell)/i,
    "session-vwap-open-breakdown-exit",
  ],
  [/multi.*scale|다단계.*분할|여러.*분할/i, "multi-level-scale-out"],
  [/partial|scale.?out|절반.*매도|일부.*매도|분할.*매도/i, "partial-take-profit"],
  [/break.?even|본전.*손절/i, "break-even-stop"],
  [/chandelier|샹들리에/i, "chandelier-exit"],
  [/atr.*trail|atr.*트레일/i, "atr-trailing"],
  [/atr.*stop|atr.*손절/i, "atr-stop"],
  [/fixed.*stop|고정.*손절|손절.*%/i, "fixed-stop-loss"],
  [/risk.?reward|\d+(?:\.\d+)?\s*r|손익비/i, "risk-reward-exit"],
  [/fixed.*take|고정.*익절|익절.*%/i, "fixed-take-profit"],
  [/percentage.*trail|percent.*trail|고점.*대비/i, "percentage-trailing"],
  [/kijun|기준선/i, "kijun-breakdown-exit"],
  [/ichimoku.*cloud|일목.*구름/i, "ichimoku-cloud-exit"],
  [/vwap.*(?:exit|breakdown|하향)|vwap.*청산/i, "vwap-breakdown-exit"],
  [/macd.*(?:exit|reverse|청산|반전)/i, "macd-reversal-exit"],
  [/rsi.*(?:exit|reverse|청산|반전)/i, "rsi-reversal-exit"],
  [/ema.*(?:exit|breakdown|청산|하향)/i, "ema-breakdown-exit"],
  [/parabolic|파라볼릭|\bsar\b/i, "parabolic-sar-exit"],
  [/end.*session|session.*end|장.*마감|오버나이트.*금지/i, "end-of-session"],
  [/time.*stop|시간.*청산|\d+\s*봉.*청산/i, "time-stop"],
  [/opposite.*signal|반대.*신호/i, "opposite-signal-exit"],
];

const EntryPresetIdSchema = z.enum(
  ENTRY_PRESETS_V3.map((preset) => preset.id) as [string, ...string[]],
);
const FilterPresetIdSchema = z.enum(
  FILTER_PRESETS_V3.map((preset) => preset.id) as [string, ...string[]],
);
const ExitPresetIdSchema = z.enum(
  EXIT_PRESETS_V3.map((preset) => preset.id) as [string, ...string[]],
);

const StrategyV3IntentSchema = z
  .object({
    name: z.string().trim().min(3).max(120).nullable(),
    entryPresetIds: z.array(EntryPresetIdSchema).min(1).max(32),
    entryOperator: z.enum(["AND", "OR"]),
    filterPresetIds: z.array(FilterPresetIdSchema).max(32),
    filterOperator: z.enum(["AND", "OR"]),
    exitPresetIds: z.array(ExitPresetIdSchema).min(1).max(40),
    timeframe: StrategyTimeframeSchema.nullable(),
    side: z.enum(["LONG", "SHORT"]).nullable(),
  })
  .strict()
  .superRefine((intent, context) => {
    for (const [path, values] of [
      ["entryPresetIds", intent.entryPresetIds],
      ["filterPresetIds", intent.filterPresetIds],
      ["exitPresetIds", intent.exitPresetIds],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} cannot contain duplicate presets.`,
        });
      }
    }
  });

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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function uniqueMatches(prompt: string, patterns: Array<[RegExp, string]>): string[] {
  return [...new Set(patterns.filter(([pattern]) => pattern.test(prompt)).map(([, id]) => id))];
}

function pruneOverlappingEntryMatches(
  matches: string[],
  filterIds: string[],
  exitIds: string[],
): string[] {
  const selected = new Set(matches);
  const preferSpecific = (specific: string, general: string) => {
    if (selected.has(specific)) selected.delete(general);
  };
  preferSpecific("multi-timeframe-trend-entry", "ema-crossover");
  preferSpecific("ema-trend-pullback", "ema-crossover");
  preferSpecific("price-above-moving-average", "ema-crossover");
  preferSpecific("moving-average-deviation", "ema-crossover");
  for (const specificVwap of [
    "session-vwap-open-cross",
    "rolling-vwap-breakout",
    "anchored-vwap-breakout",
    "weekly-vwap-breakout",
    "monthly-vwap-breakout",
  ]) {
    preferSpecific(specificVwap, "session-vwap-breakout");
  }
  preferSpecific("ichimoku-cloud-breakout", "ichimoku-trend");
  preferSpecific("ichimoku-kijun-reclaim", "ichimoku-trend");
  preferSpecific("rsi-mean-reversion-confirmed", "rsi-momentum");
  preferSpecific("rsi-oversold-rebound", "rsi-momentum");

  const exitEntryConflicts: Record<string, string[]> = {
    "kijun-breakdown-exit": ["ichimoku-kijun-reclaim", "ichimoku-trend"],
    "ichimoku-cloud-exit": ["ichimoku-cloud-breakout", "ichimoku-trend"],
    "vwap-breakdown-exit": ["vwap-breakdown-entry"],
    "macd-reversal-exit": ["macd-crossover"],
    "rsi-reversal-exit": ["rsi-momentum", "rsi-oversold-rebound"],
    "ema-breakdown-exit": ["ema-crossover", "price-above-moving-average"],
  };
  if (selected.size > 1) {
    const filterEntryConflicts: Record<string, string[]> = {
      "relative-volume-filter": ["relative-volume-entry"],
      "ema-trend-filter": ["ema-crossover", "price-above-moving-average"],
    };
    for (const filterId of filterIds) {
      for (const entryId of filterEntryConflicts[filterId] ?? []) selected.delete(entryId);
    }
    for (const exitId of exitIds) {
      for (const entryId of exitEntryConflicts[exitId] ?? []) selected.delete(entryId);
    }
  }
  return matches.filter((id) => selected.has(id));
}

function replaceNode(node: RuleNode, transform: (node: RuleNode) => RuleNode): RuleNode {
  const replaced = transform(node);
  return replaced.type === "GROUP"
    ? { ...replaced, children: replaced.children.map((child) => replaceNode(child, transform)) }
    : replaced;
}

function tuneFromPrompt(strategy: StrategyDefinitionV3, prompt: string): StrategyDefinitionV3 {
  const rollingDays = Number(prompt.match(/(\d{1,3})\s*일(?:봉)?\s*(?:rolling\s*)?vwap/i)?.[1]);
  const adxThreshold = Number(prompt.match(/adx\s*(?:>|>=|이상)?\s*(\d{1,3}(?:\.\d+)?)/i)?.[1]);
  const relativeVolume = Number(
    prompt.match(
      /(?:relative volume|상대.*거래량|거래량)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:x|배)/i,
    )?.[1],
  );
  const tune = (node: RuleNode): RuleNode => {
    if (node.type !== "CONDITION") return node;
    const tuneOperand = (operand: typeof node.left) => {
      if (
        operand.type === "INDICATOR" &&
        operand.kind === "VWAP" &&
        Number.isFinite(rollingDays) &&
        rollingDays > 0
      ) {
        return { ...operand, variant: { kind: "ROLLING_DAYS" as const, days: rollingDays } };
      }
      return operand;
    };
    let next = {
      ...node,
      left: tuneOperand(node.left),
      ...(node.right ? { right: tuneOperand(node.right) } : {}),
    };
    if (
      next.left.type === "INDICATOR" &&
      next.left.kind === "ADX" &&
      next.left.output === "ADX" &&
      Number.isFinite(adxThreshold)
    ) {
      next = { ...next, right: { type: "CONSTANT", value: adxThreshold } };
    }
    if (
      next.left.type === "INDICATOR" &&
      next.left.kind === "RELATIVE_VOLUME" &&
      Number.isFinite(relativeVolume)
    ) {
      next = { ...next, right: { type: "CONSTANT", value: relativeVolume } };
    }
    return next;
  };
  return {
    ...strategy,
    entry: replaceNode(strategy.entry, tune) as StrategyDefinitionV3["entry"],
    filters: replaceNode(strategy.filters, tune) as StrategyDefinitionV3["filters"],
  };
}

function composeStrategyV3(
  selection: z.infer<typeof StrategyV3IntentSchema>,
  prompt: string,
  instrumentId: InstrumentId,
  options: { timeframe?: StrategyTimeframe; side?: "LONG" | "SHORT" },
): StrategyDefinitionV3 {
  const timeframe = options.timeframe ?? selection.timeframe ?? undefined;
  const side = options.side ?? selection.side ?? undefined;
  const selectedPresets = [
    ...selection.entryPresetIds.map((id) => ENTRY_PRESETS_V3.find((preset) => preset.id === id)!),
    ...selection.filterPresetIds.map((id) => FILTER_PRESETS_V3.find((preset) => preset.id === id)),
    ...selection.exitPresetIds.map((id) => EXIT_PRESETS_V3.find((preset) => preset.id === id)),
  ].filter((preset) => preset !== undefined);
  if (timeframe) {
    const incompatible = selectedPresets.find(
      (preset) => !isPresetTimeframeSupportedV3(preset, timeframe),
    );
    if (incompatible) {
      throw new StrategyV3CompilerError(
        "INVALID_MODEL_OUTPUT",
        `${incompatible.name}은 ${timeframe}에서 사용할 수 없습니다. 지원 봉: ${incompatible.supportedTimeframes.join(", ")}`,
      );
    }
  }
  const strategy = createPresetStrategyV3(selection.entryPresetIds[0], instrumentId, {
    ...(timeframe ? { timeframe } : {}),
    ...(side ? { side } : {}),
  });
  const context = { timeframe: strategy.timeframe, side: strategy.side };
  const entries = selection.entryPresetIds.map((id) =>
    ENTRY_PRESETS_V3.find((preset) => preset.id === id)!.create(context),
  );
  const filters = selection.filterPresetIds.map((id) =>
    FILTER_PRESETS_V3.find((preset) => preset.id === id)!.create(context),
  );
  const exits = selection.exitPresetIds.flatMap((id) =>
    EXIT_PRESETS_V3.find((preset) => preset.id === id)!.create(context),
  );
  const needsInitialStop = exits.some(
    (exit) =>
      exit.kind === "RISK_REWARD" || exit.kind === "BREAK_EVEN" || exit.kind === "SCALE_OUT",
  );
  if (
    needsInitialStop &&
    !exits.some((exit) => exit.kind === "FIXED_STOP" || exit.kind === "ATR_STOP")
  ) {
    exits.unshift({
      kind: "ATR_STOP",
      id: "compiled-initial-stop",
      priority: 10,
      period: 14,
      multiplier: 2,
      quantityPercent: 100,
    });
  }
  return StrategyDefinitionV3Schema.parse(
    tuneFromPrompt(
      {
        ...strategy,
        name: selection.name ?? `${strategy.name} · compiled`,
        entry:
          entries.length === 1
            ? entries[0]
            : {
                type: "GROUP",
                id: "compiled-entry-chain",
                operator: selection.entryOperator,
                children: entries,
              },
        filters: {
          type: "GROUP",
          id: "compiled-filter-chain",
          operator: selection.filterOperator,
          children: filters,
        },
        exits,
      },
      prompt,
    ),
  );
}

export function compileStrategyV3Deterministically(
  prompt: string,
  instrumentId: InstrumentId,
  options: { timeframe?: StrategyTimeframe; side?: "LONG" | "SHORT" } = {},
): CompiledStrategyV3 {
  const filterIds = uniqueMatches(prompt, filterPatterns);
  const exitIds = uniqueMatches(prompt, exitPatterns);
  const entryIds = pruneOverlappingEntryMatches(
    uniqueMatches(prompt, entryPatterns),
    filterIds,
    exitIds,
  );
  if (
    entryIds.includes("session-vwap-open-cross") &&
    !exitIds.includes("session-vwap-open-breakdown-exit")
  ) {
    exitIds.unshift("session-vwap-open-breakdown-exit");
  }
  if (!entryIds.length)
    throw new StrategyV3CompilerError(
      "UNSUPPORTED_PROMPT",
      "진입 전략을 식별하지 못했습니다. 라이브러리의 전략 이름이나 지표를 포함해 주세요.",
    );
  const base = createPresetStrategyV3(entryIds[0], instrumentId, options);
  const strategy = composeStrategyV3(
    {
      name: `${base.name} · compiled`,
      entryPresetIds: entryIds,
      entryOperator: /(?:\bor\b|또는)/i.test(prompt) ? "OR" : "AND",
      filterPresetIds: filterIds,
      filterOperator: "AND",
      exitPresetIds: exitIds.length ? exitIds : ["atr-stop", "risk-reward-exit"],
      timeframe: options.timeframe ?? null,
      side: options.side ?? null,
    },
    prompt,
    instrumentId,
    options,
  );
  return {
    ok: true,
    compiler: "deterministic-dsl",
    strategy: StrategyDefinitionV3Schema.parse(strategy),
    warnings: [
      "자연어는 실행 코드가 아니라 strict Strategy v3 DSL로 변환되었습니다.",
      "모든 rule, timeframe, 비용과 청산 우선순위를 실행 전에 확인하세요.",
    ],
  };
}

function extractOutputText(payload: unknown): string {
  const response = OpenAIResponseSchema.parse(payload);
  for (const item of response.output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new StrategyV3CompilerError("INVALID_MODEL_OUTPUT", "LLM 응답에 전략 의도가 없습니다.");
}

async function requestOpenAIIntent(prompt: string, instrumentId: InstrumentId): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new StrategyV3CompilerError(
      "LLM_UNAVAILABLE",
      "OPENAI_API_KEY가 없어 자유 문장 보완 변환을 사용할 수 없습니다.",
    );
  }
  const requestBody = {
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    store: false,
    max_output_tokens: 2_000,
    instructions: [
      "Map the user's trading idea only to the supplied allowlisted Strategy v3 preset ids.",
      "Never emit code, tools, URLs, formulas, prose, or a different instrument.",
      `The selected instrument is fixed as ${instrumentId}.`,
      `Entry ids: ${ENTRY_PRESETS_V3.map((preset) => preset.id).join(", ")}.`,
      `Filter ids: ${FILTER_PRESETS_V3.map((preset) => preset.id).join(", ")}.`,
      `Exit ids: ${EXIT_PRESETS_V3.map((preset) => preset.id).join(", ")}.`,
      "Choose every independently requested entry, filter and exit. Use AND unless the user explicitly asks for OR.",
    ].join(" "),
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    text: {
      format: {
        type: "json_schema",
        name: "strategy_v3_intent",
        strict: true,
        schema: z.toJSONSchema(StrategyV3IntentSchema),
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
        await wait(250);
        continue;
      }
      throw new StrategyV3CompilerError("LLM_UNAVAILABLE", "LLM 변환 요청을 완료하지 못했습니다.");
    } catch (error) {
      if (error instanceof StrategyV3CompilerError) throw error;
      if (attempt === 1) {
        throw new StrategyV3CompilerError("LLM_UNAVAILABLE", "LLM 연결 시간이 초과되었습니다.");
      }
      await wait(250);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new StrategyV3CompilerError("LLM_UNAVAILABLE", "LLM 변환 요청을 완료하지 못했습니다.");
}

export async function compileStrategyV3(
  prompt: string,
  instrumentId: InstrumentId,
  options: { timeframe?: StrategyTimeframe; side?: "LONG" | "SHORT" } = {},
): Promise<CompiledStrategyV3> {
  try {
    return compileStrategyV3Deterministically(prompt, instrumentId, options);
  } catch (error) {
    if (!(error instanceof StrategyV3CompilerError) || error.code !== "UNSUPPORTED_PROMPT") {
      throw error;
    }
    if (!process.env.OPENAI_API_KEY) throw error;
  }

  let intent: z.infer<typeof StrategyV3IntentSchema>;
  try {
    intent = StrategyV3IntentSchema.parse(
      JSON.parse(extractOutputText(await requestOpenAIIntent(prompt, instrumentId))),
    );
  } catch (error) {
    if (error instanceof StrategyV3CompilerError) throw error;
    throw new StrategyV3CompilerError(
      "INVALID_MODEL_OUTPUT",
      "LLM 결과가 실행 가능한 Strategy v3 의도 계약을 통과하지 못했습니다.",
    );
  }
  return {
    ok: true,
    compiler: "openai",
    strategy: composeStrategyV3(intent, prompt, instrumentId, options),
    warnings: [
      "LLM 출력은 allowlisted preset intent로 제한되고 strict Strategy v3 DSL 검증을 통과했습니다.",
      "생성된 Rule Chain과 비용·체결 가정을 확인한 뒤 백테스트하세요.",
    ],
  };
}

export const STRATEGY_V3_COMPILER_VOCABULARY = {
  entries: ENTRY_PRESETS_V3.map((preset) => preset.id),
  filters: FILTER_PRESETS_V3.map((preset) => preset.id),
  exits: EXIT_PRESETS_V3.map((preset) => preset.id),
};
