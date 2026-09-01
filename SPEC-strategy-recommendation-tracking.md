# Spec: Strategy Recommendation, Backtest Window and Efficient Tracking

Status: Approved implementation scope — 2026-09-01

## Objective

종목을 선택하면 QOS Strategy v3의 모든 Entry preset을 같은 TOSS 데이터, 같은 비용과 같은
기간에서 평가하고, 과거 총수익률이 가장 높은 후보를 추천한다. 사용자는 평가 기간을 직접
지정하거나 timeframe별 안전한 기본값을 사용하고, 추천 전략을 편집·백테스트하거나 저장과 동시에
paper tracking을 켤 수 있다.

Tracking은 브라우저 polling이 아니라 로컬 장기 실행 worker가 완료 봉에서 BUY/SELL을 판정하고
연결된 Telegram으로 한 번만 알린다. TOSS REST 요청은 종목·timeframe별 공유 dataset, 진행 중 요청
병합, 거래 세션에 정렬된 fetch window와 작은 gap recovery로 제한한다.

## User-visible behavior

- 종목 선택 직후 기본 `1d` 기간으로 전체 Entry preset 추천 분석이 시작된다.
- 추천 결과는 후보 수, 실제 사용 기간, 총수익률, MDD, Sharpe, 거래 수와 상위 후보를 표시한다.
- “최고”는 선택한 역사 구간의 `totalReturnPercent` 내림차순이다. 동일하면 MDD, Sharpe, preset id로
  결정하며 미래 성과 보장 표현을 사용하지 않는다.
- 기간을 비우면 intraday 30일, daily 2년, weekly 5년을 선택 종목 timezone 기준으로 사용한다.
- 사용자는 시작일·종료일과 timeframe을 바꿔 다시 분석할 수 있다. intraday는 TOSS 1분봉 한계에
  맞춰 최근 31일 이내로 제한하고 오류를 설명한다.
- 추천 전략을 Strategy Builder에 적용하거나, 일반 저장 문서로 저장하면서 tracking을 ON할 수 있다.
- local production release는 Next server와 monitor worker를 함께 시작·상태 확인·종료한다.
- 실제 주문은 발생하지 않는다. 알림은 paper signal이며 Telegram 미연결 시 상태에 원인을 남긴다.

## API contracts

### Shared backtest window

```typescript
type BacktestWindowInput = {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
};

type ResolvedBacktestWindow = {
  source: "DEFAULT" | "CUSTOM";
  startDate: string;
  endDate: string;
  label: string;
};
```

`POST /api/strategy-engine/backtests`는 optional `window`을 받고 resolved window를 응답한다.
`POST /api/strategy-recommendations`는 strict body로 instrument, timeframe, optional window를 받는다.

추천 응답은 다음 책임을 가진다.

- `methodology`: catalog version, ranking metric, 후보 수, 비용/체결 정책
- `window`: 실제 적용된 기간과 default/custom 구분
- `recommendation`: winner의 preset metadata, editable StrategyDefinitionV3와 metric summary
- `rankings`: 상위 5개의 rank와 metric summary
- `warnings`: in-sample/historical, data/survivorship/provider limitation

Schema가 잘못되거나 종목/timeframe/기간이 맞지 않으면 engine을 실행하지 않고 기존 API 오류
envelope으로 422를 반환한다.

## Recommendation evaluation

`ENTRY_PRESETS_V3` 42개 각각을 `createPresetStrategyV3`로 생성한다. 각 후보는 동일한 baseline
ATR stop + 2R exit, next-bar-open fill, commission/slippage/spread를 사용하며 이름 switch나 별도
backtest engine을 만들지 않는다. 거래가 없는 후보도 분석 수에는 포함하지만 추천 순위에서는 거래가
있는 후보를 우선한다. 후보가 모두 거래 0회면 명확한 no-recommendation 결과를 반환한다.

동일 recommendation request는 in-process bounded TTL cache와 in-flight promise를 공유한다. key는
instrument id, timeframe, resolved window, catalog version이고 완료 봉 cadence에 맞춰 만료한다.

## Tracking cost and correctness policy

- worker heartbeat tick 기본 15초, 저장 전략 refresh 기본 60초로 분리한다.
- enabled strategy 목록을 매 tick마다 repository에서 읽지 않는다.
- candle dataset은 strategy id가 아니라 `instrumentId + timeframe`으로 공유한다.
- 같은 key의 REST load가 진행 중이면 새 load를 만들지 않는다.
- intraday fetch window는 거래소 local session의 PRE / bar bucket / POST에 정렬해 장 마감 뒤 반복
  요청하지 않는다.
- 초기 warm-up은 기존 bounded target을 사용하고 이후에는 마지막 candle 이후 예상 gap + 2개만
  요청한다. TOSS 1분봉 source cap은 유지한다.
- 완료 봉만 평가하고 strategy id/revision/side/bar timestamp delivery key로 중복 알림을 막는다.
- worker state에 provider sync 요청 수, 공유 cache hit, 마지막 sync, 전략 refresh 시각을 기록한다.

## Accessibility and responsive UX

추천 panel은 Strategy Builder 앞에 독립 section으로 둔다. 날짜 input과 timeframe select에는 visible
label과 도움말을 제공하고 loading/error/result를 `aria-live`로 알린다. metric은 색만으로 순위를
표현하지 않으며 360/390/768/1440에서 표가 page overflow를 만들지 않는다.

## Out of scope

- parameter optimization, walk-forward 자동화, 미래 수익 예측 또는 “최적 전략” 보장
- live broker order, account access, public hosting, authentication
- historical constituent/delisted/sector 데이터가 없는 상태에서 survivorship bias 해결 주장
- browser가 service worker나 무한 polling으로 market data를 직접 감시하는 방식

## Acceptance criteria

1. 전체 42 Entry preset이 동일 dataset에서 평가되고 결정론적으로 총수익률 1위를 추천한다.
2. default/custom window가 validation, TOSS load, engine 결과와 UI에 일관되게 적용된다.
3. 추천 전략을 builder에 적용하고 저장+tracking ON 할 수 있다.
4. 동일 종목/timeframe의 복수 tracking 전략은 한 번의 dataset fetch를 공유한다.
5. 장외 반복 tick은 같은 session fetch window에서 추가 TOSS REST 요청을 만들지 않는다.
6. monitor state/log로 요청 수, cache hit와 마지막 sync를 확인할 수 있다.
7. local release가 server와 monitor worker를 소유권 검증 후 함께 관리한다.
8. unit/integration/browser/full quality gates와 production smoke가 통과한다.
