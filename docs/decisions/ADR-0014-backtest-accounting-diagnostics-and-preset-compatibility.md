# ADR-0014: Backtest accounting, diagnostics and preset timeframe compatibility

## Status

Accepted — 2026-09-13

## Context

Strategy v3는 체결 가격에 slippage/spread를 반영해 손익을 계산하면서 같은 slippage를 별도 비용으로도
표시했다. 따라서 `gross PnL`, `slippage cost`, `net PnL`의 의미가 대사되지 않았고 사용자는 결과를
감사하기 어려웠다. 거래가 전혀 없어도 UI가 총수익률을 `0.00%`로만 표시해 실제 보합 거래와
Entry 불일치, Filter 차단, warm-up 부족, 주문 미체결을 구분하지 못했다.

추천 API는 모든 Entry preset을 모든 timeframe에서 실행했다. Session VWAP은 하루에 여러 봉이 있는
intraday에서만 의미가 있지만 일봉에서는 한 세션 한 봉의 가격과 사실상 같은 값으로 퇴화해 비정상
순위를 만들었다. 추천 상위 후보도 표시 전용이라 1위 외 전략을 적용할 수 없었다.

TOSS stock master는 quota 보호 때문에 일반 내부 retry를 하지 않는다. 그러나 cached access token이
401이 된 경우에도 재발급하지 않아, 회전된 credential을 서버 재기동으로 읽은 뒤에도 process token이
무효화되면 stale catalog로 남을 수 있었다.

## Decision

### 손익 회계

- `grossPnl`은 provider의 entry/exit raw price 차이와 수량으로 계산한다.
- commission은 실제 execution price notional, slippage/spread는 raw price와 execution price 차이로
  각각 계산한다.
- entry 비용은 포지션 개설 때 equity에 즉시 반영하고, 부분 청산 fill에는 초기 수량 비율로 배분한다.
  마지막 fill이 부동소수점 잔여 비용을 흡수한다.
- 거래와 모든 fill은 `gross - fee - slippage = net`을 만족하고, 모든 거래 net의 합은 ending equity와
  starting capital의 차이와 보고 정밀도 안에서 일치해야 한다.
- stop/risk 기준은 실제 진입 execution price를 계속 사용한다. 회계용 raw price와 주문 상태 가격을
  섞지 않는다.

### 진단과 실행 로그

- 결과에 signal, entry fill, rejected entry, exit signal, partial/final exit fill과 end-of-data exit의
  순서가 있는 event log를 포함한다.
- Entry와 Filter trace를 하나의 signal trace로 합쳐 실제 체결이 어떤 전체 Rule Chain을 통과했는지
  보존한다.
- 평가 봉, warm-up 봉, Entry/Filter 통과, 조합 신호, 진입/청산 체결, 거절과 condition별
  PASS/FAIL/WARM_UP 수를 집계한다.
- 거래가 없으면 `WARM_UP_ONLY`, `NO_ENTRY_MATCH`, `FILTER_BLOCKED`, `ORDER_NOT_FILLED`,
  `POSITION_SIZE_ZERO`, `SIGNAL_AT_END_OF_DATA` 중 원인을 반환한다. UI는 이를 `0% 수익`으로
  표현하지 않는다. 거래가 있고 절대 수익률이 0.01% 미만이면 네 자리까지 표시한다.

### Preset 호환성과 추천 선택

- catalog preset은 `supportedTimeframes` typed metadata를 가진다. 기본은 1m~1w 전체다.
- Session VWAP, Opening Range, intraday MTF와 End Of Session은 intraday에서만 허용하고,
  15m open/Session VWAP 교차는 15m에서만 허용한다.
- 추천은 요청 timeframe과 호환되는 Entry만 공통 dataset·비용으로 평가하며 제외 수를 반환한다.
- 반환한 상위 후보는 모두 선택 가능하고, 적용과 저장+tracking은 현재 선택 후보를 사용한다.

### TOSS 재인증

- stock master의 429/5xx 내부 retry 금지는 유지한다.
- 401은 quota retry와 다른 인증 복구로 취급해 endpoint의 `maxAttempts=1`이어도 cached token을
  무효화하고 새 client-credentials token으로 동일 요청을 정확히 한 번 다시 보낸다.
- 자격 증명과 token은 계속 server-only environment에 두며 로그, 문서, fixture, client bundle에
  값을 기록하지 않는다. 회전 반영에는 server/monitor 재기동이 필요하다.

## Alternatives considered

### 체결 가격 손익을 gross로 유지하고 slippage를 참고값으로만 표시

경제적 최종 equity는 맞출 수 있지만 `gross - costs = net`이 성립하지 않아 사용자가 비용을 독립적으로
감사할 수 없다. raw-price gross를 명시하는 방식을 채택했다.

### 모든 timeframe에서 모든 preset을 계속 평가하고 경고만 표시

비교 수는 유지되지만 정의상 퇴화한 indicator가 높은 순위를 차지할 수 있다. 연구 universe의 개수보다
의미가 보존되는 비교가 우선이므로 제외한다.

### stock master도 일반 3회 retry 허용

401 복구 외 429/5xx 재시도는 공급자 비용과 rate limit을 악화시킨다. 인증 갱신 한 번만 예외로 둔다.

## Consequences and risks

- 기존 result JSON consumer는 additive field를 무시할 수 있지만 새 UI는 최신 result의 diagnostics와
  events를 요구한다. 저장된 과거 snapshot 자체는 변경하지 않는다.
- raw/체결 가격을 함께 저장하므로 payload가 증가한다. event는 실제 lifecycle 사건만 저장하고 매 봉
  FAIL trace 전체를 저장하지 않으며 condition 통계로 집계한다.
- 지원 timeframe은 preset factory의 기본 DSL 의미를 제한한다. Advanced JSON에서 indicator를 직접
  조합하는 사용자는 여전히 schema와 runtime 책임을 이해해야 한다.
- historical constituent, exchange-grade intrabar path와 실제 체결 가능성은 이 결정으로 해결되지
  않으며 결과 한계에 계속 표시한다.

## Revisit when

- lot별 tax accounting, FX base currency, dividends 또는 corporate-action cash flow를 도입할 때
- higher-resolution intrabar fill과 order book spread를 사용할 때
- preset parameter에 따라 supported timeframe이 동적으로 달라질 때
- TOSS가 process 간 공유 token 또는 공식 token-revocation 동시성 계약을 제공할 때
