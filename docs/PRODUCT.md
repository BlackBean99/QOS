# Product

## Status

2026-09-13 기준 로컬 단일 사용자용 실제 시장 strategy workspace가 구현되었다. TOSS 국내·
미국 종목 검색/시세, KLineChart, Supabase-backed JSON 전략/백테스트 이력과 별도 Telegram
signal monitor가 동작한다. 실제 주문, 인증·다중 사용자와 공개 배포는 범위 밖이다.

## Goal

사용자가 실제 종목에서 전략을 구성·저장하고, 재현 가능한 paper backtest와 완성 봉
BUY/SELL을 차트에서 검토한 뒤 실시간 Telegram 알림으로 이어갈 수 있게 한다.

## Users and priorities

코드 없이 전략을 검증하려는 개인 투자자와 가정·결과를 재현 가능하게 검토하려는 Quant
입문자/연구자가 대상이다. 우선순위는 정확성 > 거래 안전성 > 사용성 > 성능 > 시각적
화려함이다.

## Implemented scope

- TOSS OpenAPI의 실제 국내·미국 거래 가능 주식·ETF·ETN·REIT 등 stock master 검색;
  restart-safe 24시간 local catalog, 명시적 cache 상태와 provider 실패 시 synthetic fallback 없음
- TOSS 수정주가 일봉/1분봉, 로컬 5분 집계와 lossy 실시간 체결 기반 현재 봉 갱신
- v1/v2 read 호환과 신규 Strategy v3: 43 Entry·8 Filter·21 Exit preset, 최대 64개 중첩
  Entry/Filter Rule, Long/Short, 1m~1w, Position/Risk/Execution과 strict 자연어 compiler
- VWAP 6 variant, trend/momentum/breakout/mean reversion/volatility/volume/Ichimoku/market
  structure/MTF를 같은 evaluator에서 조합하고 partial exit·비용·trace·성과 비교
- KLineChart 10 기반 캔들, 중복 없는 왼쪽 과거 탐색, 105종 검색형 지표 catalog와
  복수 instance 추가·설정·삭제, 19개 icon drawing, pan/zoom/fit/crosshair/PNG/전체 화면
- 지표별 기간·OHLC/composite source·현재 chart/직전 완료 일봉·색·굵기 설정과 전략 저장 복원
- 전략과 instrument snapshot/chart setting/drawing을 Supabase JSON으로 CRUD/import/export
- 저장 view에서 즉시 paper backtest를 실행하고 revision·engine·result snapshot 이력 조회/삭제
- 저장 view에서 한 전략에 최대 50개 주식·ETF 대상을 검색·저장하고 종목별 ON/OFF와 사용자가
  지정한 inverse paper hedge를 관리
- 종목 선택 시 43개 Entry 전체의 동일 기간/비용 historical ranking, 직접/자동 기간과 추천 적용
- 별도 monitor가 target별 모든 지원 timeframe의 완성 봉만 평가하고 target-scoped 영속 dedupe 뒤
  Telegram private chat으로 전송하며 primary/inverse paper leg를 재시작 뒤에도 보존
- 15분봉 open과 Session VWAP 상·하향 교차를 같은 v3 Rule Chain의 Entry/Exit으로 제공하고,
  원격 전략 저장소 장애에는 마지막 정상 read-only snapshot으로 감시 지속
- local release가 monitor를 자동 실행하고 종목/timeframe 공유 cache와 session cadence로 REST를 제한

기존 synthetic fixture는 전략 계산의 결정론적 회귀 테스트에만 사용한다. 사용자 검색과 실제
데이터 route에서는 노출하거나 장애 fallback으로 사용하지 않는다.

## Confirmed flow

1. 사용자가 한국/미국과 이름·티커를 선택해 TOSS 거래 가능 주식·ETF 등을 local catalog에서
   검색한다. 필요할 때만 catalog를 명시적으로 새로고침한다.
2. 전체 Entry 추천과 실제 데이터 기간을 검토하고, 추천을 적용하거나 직접 검색형 preset에서
   진입·필터·청산을 Rule Chain에 계속 추가하거나 자연어
   v3 후보를 검토한다.
3. KLineChart에서 실제 candle, 지표와 drawing을 조작한다.
4. 전략·종목 snapshot·chart 설정을 JSON으로 저장하고 view/import/export/수정/삭제한다.
5. 저장 view에서 paper backtest를 실행해 BUY/SELL marker와 동일 정보의 표를 검토하고,
   summary 이력과 full JSON snapshot을 다시 열거나 삭제한다.
6. 저장 전략 하나에 여러 종목을 붙여 개별 ON/OFF하고 필요하면 inverse 상품을 명시적으로 고른 뒤
   Telegram tracking을 켠다. local release monitor가 변경을 60초 안에 반영한다.

## Explicit limitations

- WebSocket trade stream은 sequence/snapshot이 없는 lossy feed다. REST candle이 기준이며 실시간
  trade volume을 공식 누적 거래량으로 취급하지 않는다.
- monitor는 process가 실행되는 동안만 동작한다. local release가 함께 시작하지만 sleep/reboot와
  crash 자동 복구는 없다. v3도 완료 봉만 평가하며 실제 주문은 만들지 않는다.
- 15분 open/Session VWAP 신호는 진행 중 tick이 아니라 봉 종료 후 최종 VWAP으로 확정된다. inverse
  관계·leverage 적합성은 자동 검증하거나 추천하지 않는다.
- 추천은 선택한 역사 구간의 in-sample 총수익률 순위이며 미래 성과, parameter 최적화 또는
  survivorship bias 해결을 의미하지 않는다.
- provider가 반환한 session/adjusted candle을 사용하며 독립 exchange calendar, 환율,
  상장폐지와 기업행위 재구성은 아직 없다.
- 검색 universe는 TOSS stock master가 반환하는 활성 거래 가능 종목이다. 옵션·채권·선물과
  historical/delisted universe까지 지원한다고 주장하지 않는다. 장애 시 stale catalog는 최대
  7일일 수 있고 UI에 기준 시각을 표시한다.
- 신호와 backtest는 투자 조언이나 주문이 아니다. 계좌·주문 API는 호출하지 않는다.
- 공개 Upbit 화면에서 확인한 표준 지표·drawing 연구 흐름은 제공하지만 TradingView의
  proprietary community script, Volume Profile/object tree와 pixel-identical UI는 복제하지 않는다.
- Supabase가 구성되면 project availability와 migration이 전략 CRUD의 전제다. 장애 시 divergent
  local write로 fallback하지 않으며 monitor만 마지막 정상 snapshot을 명시적으로 사용한다.

## Non-goals

- 초저지연/극초단타, exchange-grade tick reconstruction 또는 시세 재배포
- 초기 live trading, 무인 실제 주문과 broker/account channel
- 회원가입, 인증, 다중 사용자와 공개·상업 배포
- TradingView proprietary code 또는 승인 없는 Advanced Charts 사용
- 임의 사용자 코드를 전략으로 실행하는 범용 플랫폼

## Safety requirements

- 시크릿은 server-only `.env.local`에서 사용하고 client/export/log에 포함하지 않는다.
- 사용자/모델 입력은 strict schema를 통과한 선언형 전략만 실행한다.
- 실제 거래는 명시적 승인, 멱등성, 한도, kill switch, reconciliation, 감사 로그와 수동
  복구가 모두 설계되기 전까지 추가하지 않는다.

## Open product decisions

- 감시할 Strategy v2 청산 설정 선택 UI와 여러 청산 설정 동시 감시 여부
- 독립 거래소 달력, 장중 휴장/조기 종료, 환율과 기업행위 보강 공급자
- Mac reboot/crash supervisor와 공개 배포를 할 경우의 Supabase Auth·owner RLS 운영 모델
