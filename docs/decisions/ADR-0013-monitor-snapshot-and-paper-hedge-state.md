# ADR-0013: Monitor snapshot fallback and explicit paper hedge state

## Status

Accepted

## Date

2026-09-13

## Context

로컬 monitor가 Supabase의 저장 전략 목록을 주기적으로 읽는다. free project가 paused되거나 네트워크가
일시 중단되면 이미 켜 둔 신호 감시도 시작하지 못한다. 다종목 target은 전체 ON/OFF만 지원하며,
사용자가 primary SELL 뒤 명시한 inverse 상품을 paper BUY하고 이후 primary BUY에서 되돌리는 상태를
표현하지 못한다. 별도 하드코딩 신호기는 Strategy v3 백테스트와 실시간 판정을 갈라놓는다.

## Decision

- repository list 성공 시 검증된 전체 전략 문서를 server-only atomic 0600 monitor snapshot으로 저장한다.
  다음 list가 실패하면 monitor에만 snapshot을 사용하고 status에 SNAPSHOT/degraded를 공개한다. API CRUD
  write는 계속 실패시켜 remote/local split-brain을 만들지 않는다.
- 기존 targets 위에 optional `targetControls`를 additive하게 두며 enabled와 사용자가 선택한 optional
  hedge instrument를 instrumentId로 연결한다. 필드가 없으면 모두 enabled인 legacy 의미다.
- primary 신호마다 WAITING/LONG_PRIMARY/LONG_HEDGE paper state machine을 적용한다. inverse는 자동
  추론하지 않고 사용자가 선택하며 실제 주문은 생성하지 않는다. Telegram 성공 뒤 delivery와 position
  state를 같은 local state write로 기록한다.
- delivery dedupe는 strategy revision을 포함하지만 position key는 strategy id+target instrument로
  안정화한다. position에는 현재 실제로 paper 보유한 instrument snapshot을 함께 저장해 전략 revision
  또는 hedge 설정이 바뀌어도 이전 leg를 다른 종목으로 오인하지 않는다.
- 15분 시가 Session VWAP 전략은 기존 Strategy v3의 PRICE(open), VWAP(SESSION), CROSS_ABOVE/BELOW와
  CONDITION exit로 표현한다. 진행 봉이 아니라 완료 봉에서 signal을 확정한다.

## Alternatives considered

### Supabase 실패 시 local repository로 CRUD 자동 전환

화면은 계속 쓸 수 있지만 원격 복구 뒤 양쪽 revision 병합과 충돌 해결이 필요해 전략 진실 공급원이
둘이 된다. read-only monitor snapshot만 허용한다.

### ticker 이름으로 inverse 자동 매핑

편리하지만 leverage, issuer, tracking error, 시장과 통화가 다른 상품을 잘못 선택할 수 있다. 명시적
사용자 선택이 거래 안전 원칙에 맞다.

### VWAP 전용 polling worker

빠르게 만들 수 있으나 Rule Chain, completion timing, dataset cache와 delivery dedupe를 복제한다.
기존 monitor/runtime에 typed preset으로 통합한다.

## Consequences and risks

- 마지막 정상 전략은 원격 장애 중에도 계속 감시되지만 사용자가 원격에서 바꾼 최신 설정은 연결이
  회복될 때까지 반영되지 않는다. UI/status와 log가 source와 snapshot 시각을 표시한다.
- Telegram 성공 직후 state write 전에 process가 죽으면 동일 알림이 한 번 중복될 수 있다. 반대로
  전송 실패인데 paper state만 바뀌지는 않는다.
- hedge는 primary signal에 의해 전환되는 추적 상태이며 독립 전략이나 실제 계좌 포지션이 아니다.
- 보유 중 hedge 설정을 바꾸면 다음 primary signal에서 저장된 이전 hedge를 먼저 paper SELL한 뒤 새
  설정으로 전환한다. 설정 저장 자체가 임의의 거래 신호를 만들지는 않는다.
- 15분봉 open 비교는 bar close 후 최종 Session VWAP에 대해 판정하므로 최대 한 bar의 확인 지연이 있다.

## Revisit when

- multi-user/auth가 도입되어 snapshot tenant isolation이 필요할 때
- broker reconciliation과 idempotent order ledger를 갖추고 live trading을 검토할 때
- provider가 reliable server-side push candle-close event를 제공해 timer fallback을 제거할 때
- 원격 repository 장애 중 editing과 conflict merge가 실제 요구될 때
