import type { KLineData } from "klinecharts";
import { z } from "zod";

export const ChartIndicatorSchema = z.enum([
  "AVP",
  "AO",
  "BIAS",
  "BOLL",
  "BRAR",
  "BBI",
  "CCI",
  "CR",
  "DMA",
  "DMI",
  "EMV",
  "EMA",
  "MTM",
  "MA",
  "MACD",
  "OBV",
  "PVT",
  "PSY",
  "ROC",
  "RSI",
  "SMA",
  "KDJ",
  "SAR",
  "TRIX",
  "VOL",
  "VR",
  "WR",
  "FRACTAL",
  "VWAP",
  "ICHIMOKU",
  "STOCH_RSI",
  "ATR",
  "ADX",
  "AROON",
  "DONCHIAN",
  "KELTNER",
  "MFI",
  "SUPER_TREND",
  "HMA",
  "DEMA",
  "TEMA",
  "WMA",
  "VWMA",
  "CMF",
  "CHAIKIN_OSC",
  "KST",
  "ULTIMATE_OSC",
  "STDDEV",
  "ENVELOPE",
  "RVI",
  "SMI",
  "TSI",
  "MOMENTUM",
  "DPO",
  "FORCE_INDEX",
  "HIST_VOL",
  "BOLL_PERCENT_B",
  "BOLL_WIDTH",
  "ACC_DIST",
  "AROON_OSC",
  "APO",
  "AVG_PRICE",
  "BOP",
  "CMO",
  "CHAIKIN_VOL",
  "FISHER",
  "KAMA",
  "KVO",
  "LINREG",
  "LINREG_SLOPE",
  "MASS_INDEX",
  "MEDIAN_PRICE",
  "NATR",
  "NVI",
  "PPO",
  "PVI",
  "QSTICK",
  "STOCHASTIC",
  "TRUE_RANGE",
  "TRIMA",
  "TYPICAL_PRICE",
  "VHF",
  "VIDYA",
  "VOLUME_OSC",
  "WAD",
  "WEIGHTED_CLOSE",
  "WILDERS",
  "ZLEMA",
  "ALMA",
  "CHANDELIER_EXIT",
  "PFE",
  "RMI",
  "GMMA",
  "MCGINLEY",
  "VORTEX",
  "NET_VOLUME",
  "WEEK_52_HIGH",
  "PIVOT_POINTS",
  "ZIGZAG",
  "PRICE_CHANNEL",
  "ACCELERATOR_OSC",
  "RANK_CORRELATION",
  "STANDARD_ERROR",
  "STANDARD_ERROR_BANDS",
  "CONNORS_RSI",
]);
export type ChartIndicator = z.infer<typeof ChartIndicatorSchema>;

export const IndicatorSourceSchema = z.enum([
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
]);
export type IndicatorSource = z.infer<typeof IndicatorSourceSchema>;

const IndicatorInstanceBaseSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
    name: ChartIndicatorSchema,
    calcParams: z.array(z.number().finite().positive().max(100_000)).max(12),
    source: IndicatorSourceSchema,
    timeframe: z.enum(["chart", "1d"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    lineWidth: z.number().int().min(1).max(4),
  })
  .strict();
export const IndicatorInstanceSchema =
  IndicatorInstanceBaseSchema.superRefine(validateIndicatorInstance);
export type IndicatorInstance = z.infer<typeof IndicatorInstanceSchema>;

export interface IndicatorParamRule {
  label: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}

export interface IndicatorCatalogItem {
  name: ChartIndicator;
  label: string;
  description: string;
  placement: "main" | "sub";
  defaultParams: number[];
  paramLabels: string[];
  supportsSource: boolean;
  supportsDailyTimeframe: boolean;
}

const priceSources = new Set<ChartIndicator>([
  "BIAS",
  "BOLL",
  "BBI",
  "DMA",
  "EMA",
  "MTM",
  "MA",
  "MACD",
  "OBV",
  "PVT",
  "PSY",
  "ROC",
  "RSI",
  "SMA",
  "TRIX",
  "VWAP",
  "HMA",
  "DEMA",
  "TEMA",
  "WMA",
  "VWMA",
  "STDDEV",
  "ENVELOPE",
  "BOLL_PERCENT_B",
  "BOLL_WIDTH",
  "APO",
  "CMO",
  "KAMA",
  "LINREG",
  "LINREG_SLOPE",
  "NVI",
  "PPO",
  "PVI",
  "TRIMA",
  "VHF",
  "VIDYA",
  "VOLUME_OSC",
  "WILDERS",
  "ZLEMA",
  "ALMA",
  "PFE",
  "RMI",
  "GMMA",
  "MCGINLEY",
  "RANK_CORRELATION",
  "STANDARD_ERROR",
  "STANDARD_ERROR_BANDS",
  "CONNORS_RSI",
]);

const catalogSeed: Array<[ChartIndicator, string, "main" | "sub", number[], string[], string]> = [
  ["AVP", "평균가", "main", [], [], "누적 거래대금 기반 평균 가격"],
  ["BOLL", "볼린저 밴드", "main", [20, 2], ["기간", "표준편차"], "변동성 가격 밴드"],
  [
    "BBI",
    "다중 이동평균",
    "main",
    [3, 6, 12, 24],
    ["단기 1", "단기 2", "중기", "장기"],
    "네 이동평균의 결합선",
  ],
  [
    "EMA",
    "지수 이동평균",
    "main",
    [6, 12, 20],
    ["빠른 기간", "중간 기간", "느린 기간"],
    "최근 가격에 가중한 평균",
  ],
  [
    "MA",
    "이동평균",
    "main",
    [5, 10, 30, 60],
    ["기간 1", "기간 2", "기간 3", "기간 4"],
    "단순 이동평균선",
  ],
  ["SMA", "평활 이동평균", "main", [12, 2], ["기간", "가중치"], "재귀 평활 이동평균"],
  [
    "SAR",
    "파라볼릭 SAR",
    "main",
    [2, 2, 20],
    ["초기 가속", "증가폭", "최대 가속"],
    "추세 전환 가격점",
  ],
  ["FRACTAL", "윌리엄스 프랙탈", "main", [2], ["좌우 봉"], "국소 고점과 저점"],
  ["VWAP", "VWAP", "main", [15], ["세션 기간"], "가격과 거래량의 가중 평균"],
  [
    "ICHIMOKU",
    "일목균형표",
    "main",
    [9, 26, 52, 26],
    ["전환선", "기준선", "선행 B", "선행 이동"],
    "전환선·기준선·선행스팬",
  ],
  ["AO", "Awesome Oscillator", "sub", [5, 34], ["빠른 기간", "느린 기간"], "중간가격 모멘텀"],
  ["BIAS", "이격도", "sub", [6, 12, 24], ["기간 1", "기간 2", "기간 3"], "평균 대비 가격 괴리"],
  ["BRAR", "BR/AR", "sub", [26], ["기간"], "매수·매도 강도"],
  ["CCI", "CCI", "sub", [20], ["기간"], "상품채널지수"],
  [
    "CR",
    "CR",
    "sub",
    [26, 10, 20, 40, 60],
    ["CR", "MA 1", "MA 2", "MA 3", "MA 4"],
    "중간가 기준 매수 강도",
  ],
  ["DMA", "DMA", "sub", [10, 50, 10], ["빠른 기간", "느린 기간", "평활 기간"], "두 평균의 차이"],
  ["DMI", "DMI", "sub", [14, 6], ["기간", "평활 기간"], "방향성 운동지수"],
  ["EMV", "EMV", "sub", [14, 9], ["기간", "평활 기간"], "가격 이동 용이성"],
  ["MTM", "Momentum", "sub", [12, 6], ["기간", "평활 기간"], "가격 모멘텀"],
  ["MACD", "MACD", "sub", [12, 26, 9], ["빠른 기간", "느린 기간", "신호 기간"], "추세 모멘텀"],
  ["OBV", "OBV", "sub", [30], ["평활 기간"], "거래량 누적 흐름"],
  ["PVT", "PVT", "sub", [], [], "가격·거래량 추세"],
  ["PSY", "심리도", "sub", [12, 6], ["기간", "평활 기간"], "상승 봉 비율"],
  ["ROC", "ROC", "sub", [12, 6], ["기간", "평활 기간"], "가격 변화율"],
  ["RSI", "RSI", "sub", [6, 12, 24], ["기간 1", "기간 2", "기간 3"], "상대강도지수"],
  ["KDJ", "Stochastic", "sub", [9, 3, 3], ["기간", "K 평활", "D 평활"], "스토캐스틱 K·D·J"],
  ["TRIX", "TRIX", "sub", [12, 9], ["기간", "신호 기간"], "삼중 지수평균 변화율"],
  ["VOL", "거래량", "sub", [5, 10, 20], ["평균 1", "평균 2", "평균 3"], "거래량과 이동평균"],
  ["VR", "VR", "sub", [26, 6], ["기간", "평활 기간"], "상승·하락 거래량 비율"],
  [
    "WR",
    "Williams %R",
    "sub",
    [6, 10, 14],
    ["기간 1", "기간 2", "기간 3"],
    "고저 범위 내 종가 위치",
  ],
  [
    "STOCH_RSI",
    "Stochastic RSI",
    "sub",
    [14, 14, 3, 3],
    ["RSI 기간", "Stoch 기간", "K 평활", "D 평활"],
    "RSI의 스토캐스틱",
  ],
  ["ATR", "평균 진폭", "sub", [14], ["기간"], "Average True Range"],
  ["ADX", "평균 방향성 지수", "sub", [14], ["기간"], "추세 강도"],
  ["AROON", "아룬", "sub", [14], ["기간"], "고점·저점 경과 기간"],
  ["DONCHIAN", "돈치안 채널", "main", [20], ["기간"], "기간 최고·최저 가격 채널"],
  ["KELTNER", "켈트너 채널", "main", [20, 2], ["기간", "ATR 배수"], "EMA와 ATR 기반 가격 채널"],
  ["MFI", "머니 플로우 인덱스", "sub", [14], ["기간"], "가격과 거래량의 자금 흐름"],
  ["SUPER_TREND", "슈퍼트렌드", "main", [10, 3], ["ATR 기간", "배수"], "ATR 기반 추세 추적선"],
  ["HMA", "헐 이동평균", "main", [20], ["기간"], "지연을 줄인 가중 이동평균"],
  ["DEMA", "더블 EMA", "main", [20], ["기간"], "이중 지수 이동평균"],
  ["TEMA", "트리플 EMA", "main", [20], ["기간"], "삼중 지수 이동평균"],
  ["WMA", "가중 이동평균", "main", [20], ["기간"], "선형 가중 이동평균"],
  ["VWMA", "거래량 가중이동평균", "main", [20], ["기간"], "거래량 가중 이동평균"],
  ["CMF", "체이킨 머니 플로우", "sub", [20], ["기간"], "가격 위치와 거래량의 흐름"],
  [
    "CHAIKIN_OSC",
    "체이킨 오실레이터",
    "sub",
    [3, 10],
    ["빠른 기간", "느린 기간"],
    "누적·분포선 모멘텀",
  ],
  [
    "KST",
    "Know Sure Thing",
    "sub",
    [10, 15, 20, 30, 10, 10, 10, 15],
    ["ROC 1", "ROC 2", "ROC 3", "ROC 4", "MA 1", "MA 2", "MA 3", "MA 4"],
    "다중 변화율 모멘텀",
  ],
  [
    "ULTIMATE_OSC",
    "얼티미트 오실레이터",
    "sub",
    [7, 14, 28],
    ["단기", "중기", "장기"],
    "세 기간의 매수 압력",
  ],
  ["STDDEV", "표준편차", "sub", [20], ["기간"], "가격 표준편차"],
  ["ENVELOPE", "엔빌로프", "main", [20, 2], ["기간", "밴드 %"], "이동평균 비율 밴드"],
  [
    "RVI",
    "상대 변동성 지수",
    "sub",
    [14, 10],
    ["평균 기간", "표준편차 기간"],
    "상승·하락 변동성 비율",
  ],
  [
    "SMI",
    "SMI 에르고딕",
    "sub",
    [14, 3, 3],
    ["범위 기간", "1차 평활", "2차 평활"],
    "스토캐스틱 모멘텀 지수",
  ],
  ["TSI", "트루 스트렝스 인덱스", "sub", [25, 13], ["느린 기간", "빠른 기간"], "이중 평활 모멘텀"],
  ["MOMENTUM", "모멘텀", "sub", [10], ["기간"], "현재가와 과거 가격의 차이"],
  ["DPO", "디트렌디드 가격 오실레이터", "sub", [20], ["기간"], "장기 추세를 제거한 주기"],
  ["FORCE_INDEX", "엘더 포스 인덱스", "sub", [13], ["기간"], "가격 변화와 거래량의 힘"],
  ["HIST_VOL", "과거변동성", "sub", [20], ["기간"], "연율화 종가 변동성"],
  ["BOLL_PERCENT_B", "Bollinger %B", "sub", [20, 2], ["기간", "표준편차"], "밴드 안의 가격 위치"],
  ["BOLL_WIDTH", "Bollinger Band Width", "sub", [20, 2], ["기간", "표준편차"], "볼린저 밴드 폭"],
  ["ACC_DIST", "누적/분포", "sub", [], [], "Accumulation/Distribution Line"],
  ["AROON_OSC", "아룬 오실레이터", "sub", [14], ["기간"], "Aroon Up과 Down의 차이"],
  [
    "APO",
    "절대 가격 오실레이터",
    "sub",
    [12, 26],
    ["빠른 기간", "느린 기간"],
    "두 EMA의 절대 차이",
  ],
  ["AVG_PRICE", "평균 가격", "main", [], [], "OHLC 평균 가격"],
  ["BOP", "밸런스 오브 파워", "sub", [], [], "시가 대비 종가의 힘"],
  ["CMO", "샹드 모멘텀", "sub", [14], ["기간"], "상승·하락 모멘텀 비율"],
  ["CHAIKIN_VOL", "체이킨 변동성", "sub", [10], ["기간"], "고저 범위 변화율"],
  ["FISHER", "피셔 트랜스폼", "sub", [10], ["기간"], "가격 분포 변환"],
  ["KAMA", "적응형 이동평균", "main", [20], ["기간"], "시장 효율성 기반 적응 평균"],
  [
    "KVO",
    "클링거 오실레이터",
    "sub",
    [34, 55],
    ["빠른 기간", "느린 기간"],
    "가격·거래량 장단기 흐름",
  ],
  ["LINREG", "리니어 회귀 곡선", "main", [20], ["기간"], "최소제곱 회귀 가격"],
  ["LINREG_SLOPE", "리니어 회귀 기울기", "sub", [20], ["기간"], "가격 회귀선의 기울기"],
  ["MASS_INDEX", "매스 인덱스", "sub", [25], ["기간"], "고저 범위의 추세 반전 압력"],
  ["MEDIAN_PRICE", "중간 가격", "main", [], [], "고가와 저가의 평균"],
  ["NATR", "정규화 ATR", "sub", [14], ["기간"], "가격 대비 평균 진폭"],
  ["NVI", "음수 거래량 지수", "sub", [], [], "거래량 감소일의 가격 흐름"],
  [
    "PPO",
    "퍼센트 가격 오실레이터",
    "sub",
    [12, 26],
    ["빠른 기간", "느린 기간"],
    "두 EMA의 백분율 차이",
  ],
  ["PVI", "양수 거래량 지수", "sub", [], [], "거래량 증가일의 가격 흐름"],
  ["QSTICK", "QStick", "sub", [14], ["기간"], "시가·종가 차이 평균"],
  ["STOCHASTIC", "스토캐스틱", "sub", [14, 3, 3], ["기간", "K 평활", "D 평활"], "%K와 %D"],
  ["TRUE_RANGE", "True Range", "sub", [], [], "갭을 포함한 단일 봉 진폭"],
  ["TRIMA", "삼각 이동평균", "main", [20], ["기간"], "이중 평활 단순 평균"],
  ["TYPICAL_PRICE", "전형 가격", "main", [], [], "고가·저가·종가 평균"],
  ["VHF", "수직 수평 필터", "sub", [28], ["기간"], "추세와 횡보 구분"],
  [
    "VIDYA",
    "가변 지수 이동평균",
    "main",
    [9, 30, 0.2],
    ["단기", "장기", "알파"],
    "변동성 적응 이동평균",
  ],
  [
    "VOLUME_OSC",
    "거래량 오실레이터",
    "sub",
    [5, 10],
    ["빠른 기간", "느린 기간"],
    "거래량 평균의 차이",
  ],
  ["WAD", "Williams 누적/분포", "sub", [], [], "가격 방향 누적 흐름"],
  ["WEIGHTED_CLOSE", "가중 종가", "main", [], [], "종가에 두 배 가중한 평균"],
  ["WILDERS", "Wilder 평활", "main", [14], ["기간"], "Wilder 방식 이동평균"],
  ["ZLEMA", "Zero Lag EMA", "main", [20], ["기간"], "지연 보정 지수 평균"],
  [
    "ALMA",
    "Arnaud Legoux MA",
    "main",
    [20, 0.85, 6],
    ["기간", "오프셋", "시그마"],
    "가우시안 가중 이동평균",
  ],
  [
    "CHANDELIER_EXIT",
    "샹들리에 청산",
    "main",
    [22, 3],
    ["기간", "ATR 배수"],
    "최고·최저와 ATR 기반 청산선",
  ],
  ["PFE", "Polarized Fractal Efficiency", "sub", [10, 5], ["기간", "EMA 기간"], "가격 이동 효율성"],
  ["RMI", "상대 모멘텀 지수", "sub", [14, 5], ["기간", "모멘텀 기간"], "다기간 RSI 변형"],
  [
    "GMMA",
    "구피 다중 이동평균",
    "main",
    [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60],
    [
      "단기 1",
      "단기 2",
      "단기 3",
      "단기 4",
      "단기 5",
      "단기 6",
      "장기 1",
      "장기 2",
      "장기 3",
      "장기 4",
      "장기 5",
      "장기 6",
    ],
    "단기·장기 EMA 군집",
  ],
  ["MCGINLEY", "맥긴리 다이내믹", "main", [14], ["기간"], "가격 속도에 적응하는 평균"],
  ["VORTEX", "보텍스 지표", "sub", [14], ["기간"], "양·음 방향성 흐름"],
  ["NET_VOLUME", "순거래량", "sub", [], [], "상승 거래량에서 하락 거래량을 차감"],
  ["WEEK_52_HIGH", "52주 최고가", "main", [252], ["거래일"], "최근 52주 최고가"],
  ["PIVOT_POINTS", "피봇 포인트", "main", [], [], "직전 봉 기반 P·R1·S1"],
  ["ZIGZAG", "지그재그", "main", [5], ["반전 %"], "유의미한 가격 반전 연결"],
  ["PRICE_CHANNEL", "가격 채널", "main", [20], ["기간"], "기간 고가·저가 채널"],
  ["ACCELERATOR_OSC", "가속 오실레이터", "sub", [5], ["평활 기간"], "Awesome Oscillator의 가속"],
  ["RANK_CORRELATION", "순위 상관 지수", "sub", [12], ["기간"], "시간과 가격 순위의 상관"],
  ["STANDARD_ERROR", "표준 오차", "sub", [20], ["기간"], "회귀 추정의 표준 오차"],
  [
    "STANDARD_ERROR_BANDS",
    "표준 오차 밴드",
    "main",
    [20, 2],
    ["기간", "배수"],
    "회귀선 주변 표준 오차 밴드",
  ],
  [
    "CONNORS_RSI",
    "Connors RSI",
    "sub",
    [3, 2, 100],
    ["RSI", "연속 기간", "순위 기간"],
    "RSI·연속 등락·변화율 순위 결합",
  ],
];

export const INDICATOR_CATALOG: IndicatorCatalogItem[] = catalogSeed.map(
  ([name, label, placement, defaultParams, paramLabels, description]) => ({
    name,
    label,
    placement,
    defaultParams,
    paramLabels,
    description,
    supportsSource: priceSources.has(name),
    supportsDailyTimeframe: name !== "FRACTAL" && name !== "ZIGZAG",
  }),
);

const catalogByName = new Map(INDICATOR_CATALOG.map((item) => [item.name, item]));
const colors = ["#225bb8", "#d43c3c", "#7a3ed1", "#198754", "#d97706", "#1769d2"];

export function indicatorCatalogItem(name: ChartIndicator): IndicatorCatalogItem {
  const item = catalogByName.get(name);
  if (!item) throw new Error(`지원하지 않는 차트 지표: ${name}`);
  return item;
}

const variableArityIndicators = new Set<ChartIndicator>(["MA", "EMA", "RSI", "WR", "VOL"]);
const decimalParams = new Set([
  "BOLL:1",
  "SAR:0",
  "SAR:1",
  "SAR:2",
  "KELTNER:1",
  "SUPER_TREND:1",
  "ENVELOPE:1",
  "VIDYA:2",
  "BOLL_PERCENT_B:1",
  "BOLL_WIDTH:1",
  "ALMA:1",
  "ALMA:2",
  "CHANDELIER_EXIT:1",
  "ZIGZAG:0",
  "STANDARD_ERROR_BANDS:1",
]);

const integerMinimums = new Map<string, number>([
  ["ADX:0", 2],
  ["HMA:0", 2],
  ["RVI:1", 2],
  ["SMI:0", 2],
  ["LINREG:0", 2],
  ["LINREG_SLOPE:0", 2],
  ["ZLEMA:0", 3],
]);

export function indicatorParamRule(
  name: ChartIndicator,
  index: number,
  timeframe: IndicatorInstance["timeframe"] = "chart",
): IndicatorParamRule {
  const item = indicatorCatalogItem(name);
  const label = item.paramLabels[index] ?? `기간 ${index + 1}`;
  const integer = !decimalParams.has(`${name}:${index}`);
  const unitInterval = (name === "ALMA" && index === 1) || (name === "VIDYA" && index === 2);
  const minimum = integerMinimums.get(`${name}:${index}`) ?? (integer ? 1 : 0.1);
  return {
    label,
    min: minimum,
    max: unitInterval ? 1 : integer ? (timeframe === "1d" ? 400 : 10_000) : 1_000,
    step: integer ? 1 : 0.1,
    integer,
  };
}

export function indicatorRequiredHistory(name: ChartIndicator, params: readonly number[]): number {
  const integerParams = params.filter((_, index) => indicatorParamRule(name, index, "1d").integer);
  if (integerParams.length === 0) return name === "WAD" || name === "PIVOT_POINTS" ? 2 : 1;
  const period = Math.ceil(integerParams[0] ?? 1);
  if (name === "FRACTAL") return period * 2 + 1;
  if (name === "ADX") return period * 2 - 1;
  if (name === "HMA") return period + Math.ceil(Math.sqrt(period)) - 1;
  if (name === "CHAIKIN_VOL") return period === 1 ? 3 : period * 2;
  if (name === "MASS_INDEX") return period + 16;
  if (name === "ACCELERATOR_OSC") return period + 33;
  if (name === "DEMA") return period * 2 - 1;
  if (name === "TEMA") return period * 3 - 2;
  if (name === "TRIX") return period * 3 + Math.ceil(integerParams[1] ?? 1) - 3;
  return Math.max(1, Math.ceil(integerParams.reduce((sum, value) => sum + value, 0)) + 1);
}

function validateIndicatorInstance(
  instance: z.infer<typeof IndicatorInstanceBaseSchema>,
  context: z.RefinementCtx,
): void {
  const item = indicatorCatalogItem(instance.name);
  const exactArity = item.defaultParams.length;
  const validArity = variableArityIndicators.has(instance.name)
    ? instance.calcParams.length >= 1 && instance.calcParams.length <= 12
    : instance.calcParams.length === exactArity;
  if (!validArity) {
    context.addIssue({
      code: "custom",
      path: ["calcParams"],
      message: variableArityIndicators.has(instance.name)
        ? `${instance.name} 파라미터는 1~12개여야 합니다.`
        : `${instance.name} 파라미터는 ${exactArity}개여야 합니다.`,
    });
  }

  instance.calcParams.forEach((value, index) => {
    const rule = indicatorParamRule(instance.name, index, instance.timeframe);
    if (value < rule.min || value > rule.max || (rule.integer && !Number.isInteger(value))) {
      context.addIssue({
        code: "custom",
        path: ["calcParams", index],
        message: `${rule.label}은 ${rule.min}~${rule.max}${rule.integer ? " 정수" : ""}여야 합니다.`,
      });
    }
  });

  if (!item.supportsSource && instance.source !== "close") {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: `${instance.name}은 고정 OHLCV 공식을 사용하므로 가격 소스를 변경할 수 없습니다.`,
    });
  }

  if (instance.timeframe === "1d" && !item.supportsDailyTimeframe) {
    context.addIssue({
      code: "custom",
      path: ["timeframe"],
      message: `${instance.name}은 이후 봉에 따라 과거 값이 바뀌므로 1D 투영을 지원하지 않습니다.`,
    });
  }

  if (instance.timeframe === "1d") {
    const requiredHistory = indicatorRequiredHistory(instance.name, instance.calcParams);
    if (requiredHistory > 400) {
      context.addIssue({
        code: "custom",
        path: ["calcParams"],
        message: `${instance.name} 설정은 준비 구간 ${requiredHistory}봉이 필요합니다. 1D 지표는 최대 400봉까지 지원합니다.`,
      });
    }
  }

  const orderedPairs: Partial<Record<ChartIndicator, Array<[number, number]>>> = {
    MACD: [[0, 1]],
    DMA: [[0, 1]],
    CHAIKIN_OSC: [[0, 1]],
    APO: [[0, 1]],
    PPO: [[0, 1]],
    KVO: [[0, 1]],
    VOLUME_OSC: [[0, 1]],
    VIDYA: [[0, 1]],
    ICHIMOKU: [
      [0, 1],
      [1, 2],
    ],
  };
  for (const [fast, slow] of orderedPairs[instance.name] ?? []) {
    if (
      instance.calcParams[fast] !== undefined &&
      instance.calcParams[slow] !== undefined &&
      instance.calcParams[fast] >= instance.calcParams[slow]
    ) {
      context.addIssue({
        code: "custom",
        path: ["calcParams", slow],
        message: `${indicatorParamRule(instance.name, fast).label}은 ${indicatorParamRule(instance.name, slow).label}보다 작아야 합니다.`,
      });
    }
  }
}

export function createIndicatorInstance(
  name: ChartIndicator,
  id: string,
  index = 0,
): IndicatorInstance {
  const item = indicatorCatalogItem(name);
  return IndicatorInstanceSchema.parse({
    id,
    name,
    calcParams: item.defaultParams,
    source: name === "VWAP" ? "hlc3" : "close",
    timeframe: "chart",
    color: colors[index % colors.length],
    lineWidth: 2,
  });
}

export function normalizeIndicatorInstances(settings: {
  mainIndicators: readonly ChartIndicator[];
  subIndicators: readonly ChartIndicator[];
  indicatorInstances?: readonly IndicatorInstance[];
}): IndicatorInstance[] {
  if (settings.indicatorInstances) return [...settings.indicatorInstances];
  return [...settings.mainIndicators, ...settings.subIndicators].map((name, index) =>
    createIndicatorInstance(name, `legacy-${index}-${name.toLowerCase()}`, index),
  );
}

export function indicatorSourceValue(candle: KLineData, source: IndicatorSource): number {
  if (source === "open" || source === "high" || source === "low" || source === "close") {
    return candle[source];
  }
  if (source === "hl2") return (candle.high + candle.low) / 2;
  if (source === "hlc3") return (candle.high + candle.low + candle.close) / 3;
  return (candle.open + candle.high + candle.low + candle.close) / 4;
}

function marketDate(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function sourceCandles(dataList: KLineData[], source: IndicatorSource): KLineData[] {
  return dataList.map((candle) => {
    const value = indicatorSourceValue(candle, source);
    return { ...candle, open: value, high: value, low: value, close: value };
  });
}

export async function configuredIndicatorCalculation<T extends Record<string, unknown>>(
  dataList: KLineData[],
  config: Pick<IndicatorInstance, "source" | "timeframe">,
  timezone: string,
  calculate: (candles: KLineData[]) => Promise<T[]> | T[],
  chartPeriod: "1m" | "5m" | "1d" = "5m",
  applyPriceSource = true,
  dailyHistory: KLineData[] = [],
): Promise<T[]> {
  const prepare = (candles: KLineData[]) =>
    applyPriceSource ? sourceCandles(candles, config.source) : candles;
  if (config.timeframe === "chart" || chartPeriod === "1d") {
    return calculate(prepare(dataList));
  }

  if (dailyHistory.length > 0) {
    const byDate = new Map(
      dailyHistory
        .toSorted((left, right) => left.timestamp - right.timestamp)
        .map((candle) => [marketDate(candle.timestamp, timezone), candle] as const),
    );
    const completedDaily = [...byDate.entries()].toSorted(([left], [right]) =>
      left.localeCompare(right),
    );
    const dailyResult = await calculate(prepare(completedDaily.map(([, candle]) => candle)));
    const dates = completedDaily.map(([date]) => date);

    return dataList.map((candle) => {
      const chartDate = marketDate(candle.timestamp, timezone);
      let low = 0;
      let high = dates.length - 1;
      let completedIndex = -1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (dates[middle] < chartDate) {
          completedIndex = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      return completedIndex >= 0 ? dailyResult[completedIndex] : ({} as T);
    });
  }

  const daily: KLineData[] = [];
  const dayIndexByBar: number[] = [];
  for (const candle of dataList) {
    const date = marketDate(candle.timestamp, timezone);
    const previous = daily.at(-1);
    const previousDate = previous ? marketDate(previous.timestamp, timezone) : null;
    if (!previous || previousDate !== date) {
      daily.push({ ...candle });
    } else {
      daily[daily.length - 1] = {
        ...previous,
        high: Math.max(previous.high, candle.high),
        low: Math.min(previous.low, candle.low),
        close: candle.close,
        volume: (previous.volume ?? 0) + (candle.volume ?? 0),
        turnover: (previous.turnover ?? 0) + (candle.turnover ?? 0),
      };
    }
    dayIndexByBar.push(daily.length - 1);
  }

  const dailyResult = await calculate(prepare(daily));
  return dayIndexByBar.map((dayIndex) => (dayIndex > 0 ? dailyResult[dayIndex - 1] : ({} as T)));
}
