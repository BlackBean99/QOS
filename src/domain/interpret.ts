import {
  getInstrumentDefinition,
  MarketSchema,
  type InstrumentId,
  type InstrumentSummary,
} from "./instruments";
import type { InterpretationIssue, InterpretationResult, Market, Strategy } from "./strategy";
import { StrategySchema } from "./strategy";

const MARKET_PATTERNS: Record<Market, RegExp> = {
  KOSPI: /(?:KOSPI|코스피)/i,
  KOSDAQ: /(?:KOSDAQ|코스닥)/i,
  KR_ETC: /(?:KR_ETC|국내\s*기타)/i,
  NYSE: /(?:NYSE|뉴욕증권거래소)/i,
  NASDAQ: /(?:NASDAQ|나스닥)/i,
  AMEX: /(?:AMEX|아멕스)/i,
  US_ETC: /(?:US_ETC|미국\s*기타)/i,
};

const INTRADAY_PATTERN = /(?:\d+\s*(?:분봉?|분|시간봉?|시간)|\b\d+\s*(?:m|h)\b|intraday)/i;
const UNSAFE_PATTERN = /(?:python|javascript|shell|코드\s*실행|eval\s*\()/i;

interface SupportedTemplate {
  market: Market;
  price: Strategy["entry"]["price"];
  volume: Strategy["entry"]["volume"];
  exit: Strategy["exit"];
}

const TEMPLATE_PATTERNS: Array<{
  kind: Strategy["entry"]["price"]["kind"];
  pattern: RegExp;
}> = [
  {
    kind: "rolling_high_breakout",
    pattern:
      /^(?<market>KOSPI|코스피|NASDAQ|나스닥)(?:에서)?\s*(?<period>\d{1,2})일\s*(?:고점|신고가)(?:을)?\s*(?:상향\s*)?돌파하고\s*거래량(?:이)?\s*(?:(?<volumePeriod>\d{1,2})일\s*)?평균(?:의|보다)?\s*(?<ratio>\d+(?:\.\d+)?)배\s*이상(?:이면)?\s*매수\s*,?\s*(?:(?<stop>\d+(?:\.\d+)?)%\s*(?:trailing\s*stop|트레일링\s*스탑)|고점\s*대비\s*(?<plainStop>\d+(?:\.\d+)?)%\s*하락하면\s*매도)\s*\.?$/i,
  },
  {
    kind: "sma_cross_above",
    pattern:
      /^(?<market>KOSPI|코스피|NASDAQ|나스닥)(?:에서)?\s*(?<period>\d{1,2})일\s*(?:이동평균|SMA)(?:을)?\s*(?:상향\s*)?돌파하고\s*거래량(?:이)?\s*(?:(?<volumePeriod>\d{1,2})일\s*)?평균(?:의|보다)?\s*(?<ratio>\d+(?:\.\d+)?)배\s*이상(?:이면)?\s*매수\s*,?\s*(?:(?<stop>\d+(?:\.\d+)?)%\s*(?:trailing\s*stop|트레일링\s*스탑)|고점\s*대비\s*(?<plainStop>\d+(?:\.\d+)?)%\s*하락하면\s*매도)\s*\.?$/i,
  },
  {
    kind: "rolling_high_breakout",
    pattern:
      /^(?<market>KOSPI|NASDAQ)\s+(?<period>\d{1,2})-(?:day|session)\s+(?:high|rolling high)\s+breakout\s*,\s*volume\s+(?<ratio>\d+(?:\.\d+)?)x\s+(?:average|avg)\s*,\s*(?<stop>\d+(?:\.\d+)?)%\s+trailing\s+stop\s*\.?$/i,
  },
  {
    kind: "sma_cross_above",
    pattern:
      /^(?<market>KOSPI|NASDAQ)\s+(?<period>\d{1,2})-(?:day|session)\s+SMA\s+cross\s+above\s*,\s*volume\s+(?<ratio>\d+(?:\.\d+)?)x\s+(?:average|avg)\s*,\s*(?<stop>\d+(?:\.\d+)?)%\s+trailing\s+stop\s*\.?$/i,
  },
];

function normalizeMarket(value: string): Market {
  return /KOSPI|코스피/i.test(value) ? "KOSPI" : "NASDAQ";
}

function parseSupportedTemplate(prompt: string): SupportedTemplate | null {
  for (const template of TEMPLATE_PATTERNS) {
    const groups = prompt.match(template.pattern)?.groups;
    if (!groups) continue;

    const period = Number(groups.period);
    return {
      market: normalizeMarket(groups.market),
      price: { kind: template.kind, period },
      volume: {
        kind: "volume_ratio_above",
        period: Number(groups.volumePeriod ?? groups.period),
        ratio: Number(groups.ratio),
      },
      exit: { kind: "trailing_stop", percent: Number(groups.stop ?? groups.plainStop) },
    };
  }

  return null;
}

export function interpretStrategy(
  rawPrompt: string,
  instrumentId: InstrumentId,
  selectedInstrument?: Pick<InstrumentSummary, "instrumentId" | "market" | "symbol">,
): InterpretationResult {
  const prompt = rawPrompt.trim();
  const issues: InterpretationIssue[] = [];

  if (prompt.length < 12) {
    issues.push({ field: "prompt", message: "전략 설명을 12자 이상 입력해 주세요." });
  }

  const markets = (Object.entries(MARKET_PATTERNS) as [Market, RegExp][])
    .filter(([, pattern]) => pattern.test(prompt))
    .map(([market]) => market);

  if (markets.length !== 1) {
    issues.push({
      field: "market",
      message:
        markets.length === 0
          ? "지원 시장 KOSPI 또는 NASDAQ을 하나 지정해 주세요."
          : "교차 시장 backtest는 아직 지원하지 않습니다. 시장을 하나만 선택해 주세요.",
    });
  }

  if (INTRADAY_PATTERN.test(prompt)) {
    issues.push({
      field: "timeframe",
      message: "첫 버전은 일봉(1d) 전략만 지원합니다. 분봉·시간봉은 실행하지 않습니다.",
    });
  }

  if (UNSAFE_PATTERN.test(prompt)) {
    issues.push({
      field: "entry",
      message: "사용자 코드나 생성 코드는 실행할 수 없습니다. 지원된 조건으로 표현해 주세요.",
    });
  }

  const template = parseSupportedTemplate(prompt);
  if (!template) {
    issues.push({
      field: "entry",
      message: "시장·진입·거래량·고점 기준 청산 조건을 하나의 전략으로 확정하지 못했습니다.",
    });
  }

  let instrument = selectedInstrument;
  if (!instrument) {
    try {
      instrument = getInstrumentDefinition(instrumentId);
    } catch {
      const separator = instrumentId.indexOf(":");
      instrument = {
        instrumentId,
        market: MarketSchema.parse(instrumentId.slice(0, separator)),
        symbol: instrumentId.slice(separator + 1),
      };
    }
  }
  if (template && instrument.market !== template.market) {
    issues.push({
      field: "instrument",
      message: `${instrument.symbol} 종목은 ${instrument.market} 소속입니다. 문장의 시장과 일치시켜 주세요.`,
    });
  }

  if (issues.length > 0 || markets.length !== 1 || !template) {
    return { ok: false, issues };
  }

  const { market, price, volume, exit } = template;
  const ruleLabel = price.kind === "rolling_high_breakout" ? "Breakout" : "SMA Cross";
  const candidate = {
    version: 1 as const,
    name: `${instrument.symbol} ${ruleLabel} ${price.period}`,
    market,
    instrumentId,
    timeframe: "1d" as const,
    entry: { price, volume },
    exit,
    assumptions: {
      signalAt: "session_close" as const,
      fillAt: "next_session_open" as const,
      positionSizing: "all_in_single_asset" as const,
    },
  };
  const parsed = StrategySchema.safeParse(candidate);

  if (!parsed.success) {
    const validationIssues: InterpretationIssue[] = parsed.error.issues.map((issue) => ({
      field: issue.path.includes("exit")
        ? "exit"
        : issue.path.includes("instrumentId")
          ? "instrument"
          : issue.path.includes("volume")
            ? "volume"
            : "entry",
      message: `지원 범위를 벗어난 값입니다: ${issue.message}`,
    }));
    return { ok: false, issues: validationIssues };
  }

  return {
    ok: true,
    strategy: parsed.data,
    warnings: [
      "외부 LLM이 아닌 제한된 규칙 해석 결과입니다. 실행 전에 구조화된 조건을 확인하세요.",
      "결과는 synthetic fixture로 계산되며 실제 시장 성과나 투자 조언이 아닙니다.",
    ],
  };
}
