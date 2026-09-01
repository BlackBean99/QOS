import { createReferenceResearchStrategy, type ResearchStrategy } from "./advanced-strategy";
import type { InstrumentSummary } from "./instruments";
import type { Strategy } from "./strategy";

export type StrategyPreset = {
  id: string;
  title: string;
  author: string;
  principle: string;
  timeframe: string;
  create: (instrument: InstrumentSummary) => Strategy | ResearchStrategy;
};

/** Publicly documented principles, not endorsements or exact proprietary portfolios. */
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "donchian-trend",
    title: "Donchian 추세 돌파",
    author: "Richard Donchian 스타일",
    principle: "고점 돌파와 거래량으로 추세 시작을 확인하고 추적 손절합니다.",
    timeframe: "일봉",
    create: (instrument) => ({
      version: 1,
      name: `${instrument.symbol} Donchian 추세 돌파`,
      market: instrument.market,
      instrumentId: instrument.instrumentId,
      timeframe: "1d",
      entry: {
        price: { kind: "rolling_high_breakout", period: 20 },
        volume: { kind: "volume_ratio_above", period: 20, ratio: 1.5 },
      },
      exit: { kind: "trailing_stop", percent: 5 },
      assumptions: {
        signalAt: "session_close",
        fillAt: "next_session_open",
        positionSizing: "all_in_single_asset",
      },
    }),
  },
  {
    id: "trend-following",
    title: "추세 추종 이동평균",
    author: "Ed Seykota 스타일",
    principle: "중기 이동평균 상향 돌파를 추세 전환 신호로 사용합니다.",
    timeframe: "일봉",
    create: (instrument) => ({
      version: 1,
      name: `${instrument.symbol} 추세 추종`,
      market: instrument.market,
      instrumentId: instrument.instrumentId,
      timeframe: "1d",
      entry: {
        price: { kind: "sma_cross_above", period: 50 },
        volume: { kind: "volume_ratio_above", period: 20, ratio: 1 },
      },
      exit: { kind: "trailing_stop", percent: 8 },
      assumptions: {
        signalAt: "session_close",
        fillAt: "next_session_open",
        positionSizing: "all_in_single_asset",
      },
    }),
  },
  {
    id: "vwap-exit-lab",
    title: "VWAP 청산 비교 연구",
    author: "공개 VWAP·ATR 원칙 조합",
    principle: "VWAP 돌파 진입 후 ATR·일목·EMA·고정 trailing을 동시에 비교합니다.",
    timeframe: "5분봉",
    create: (instrument) => createReferenceResearchStrategy(instrument.instrumentId, instrument),
  },
];
