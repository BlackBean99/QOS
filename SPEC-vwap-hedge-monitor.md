# QOS 15-minute VWAP and inverse hedge monitor specification

## Problem

저장 전략의 다종목 감시는 완료 봉 Rule Chain 신호를 Telegram으로 보낼 수 있지만 종목별
ON/OFF, 매도 뒤 사용자가 지정한 인버스 상품으로 paper 포지션을 전환하는 상태, 원격 전략 저장소
일시 장애 시 마지막 정상 설정 복구가 없다. 또한 Session VWAP preset은 종가만 사용해 사용자가
요청한 15분봉 시가 기준 교차를 바로 선택하기 어렵다.

## Capability map and build order

1. **Monitor resilience** — 정상 전략 목록을 로컬 read-only snapshot으로 보존하고 원격 조회 실패
   때에만 감시에 사용한다. 사용자 CRUD write는 원격 장애를 local write로 숨기지 않는다.
2. **Typed target control** — 기존 `monitor.targets`를 보존하고 optional target control에 종목별
   enabled와 optional inverse instrument를 저장한다.
3. **Rule-chain VWAP signal** — Strategy v3 catalog에 `PRICE(open)`과 Session VWAP의 상향 Entry,
   하향 Exit preset을 제공한다. 15분 timeframe 선택 시 완료 봉에서만 판정한다.
4. **Paper hedge transition** — primary BUY/SELL을 WAITING/LONG_PRIMARY/LONG_HEDGE 상태 전이로
   변환하고 성공한 Telegram 전송 뒤 상태와 중복 방지 기록을 원자적으로 저장한다.
5. **Operations UX** — 종목별 ON/OFF, inverse 검색/해제, 현재 paper leg와 Telegram/monitor
   상태를 모바일·키보드에서 관리한다.

각 capability는 이전 capability 없이도 schema/test 관점에서 독립 검증 가능하며 위 순서대로만
runtime에 연결한다.

## Functional requirements

- 기존 targets가 없거나 target control이 없는 v1/v2/v3 문서는 이전처럼 대표 종목 또는 모든
  targets를 enabled 상태로 감시한다.
- target control은 targets에 존재하는 instrumentId만 참조하고 중복할 수 없다. inverse instrument는
  primary target과 달라야 하며 실제 TOSS instrument snapshot이어야 한다.
- primary target이 OFF이면 subscription, dataset fetch, signal evaluation에서 제외한다.
- hedge instrument는 사용자가 검색해 명시적으로 선택한다. QOS가 상관관계나 상품명을 근거로
  자동 매핑하지 않는다.
- `LONG_PRIMARY + primary SELL`은 `primary SELL`과 `hedge BUY`,
  `LONG_HEDGE + primary BUY`는 `hedge SELL`과 `primary BUY`를 한 Telegram 전환 알림으로 보낸다.
- WAITING에서 첫 BUY는 LONG_PRIMARY, 첫 SELL과 configured hedge는 LONG_HEDGE가 된다. 동일 방향
  반복 신호는 새 paper 거래 전환을 만들지 않는다.
- hedge가 없으면 BUY/SELL 알림은 기존처럼 전송하되 paper leg는 LONG_PRIMARY/WAITING으로 갱신한다.
- 모든 알림은 실제 주문을 생성하지 않으며 primary signal의 완성 봉 timestamp, 가격, Rule 근거,
  paper action을 포함한다.
- 15분 시가 VWAP preset은 `open CROSS_ABOVE Session VWAP` Entry와
  `open CROSS_BELOW Session VWAP` Exit로 표현하며 signalAt=BAR_CLOSE, fillAt=NEXT_BAR_OPEN 정책을
  유지한다. 진행 중인 봉이나 미래 VWAP 값을 사용하지 않는다.
- monitor는 정상 전략 repository list를 schema 검증 후 mode 0600 atomic JSON snapshot으로 저장한다.
  repository failure에는 마지막 snapshot만 읽고 source/degraded 상태를 공개한다. snapshot이 없으면
  오류를 숨기지 않는다.

## Non-functional requirements

- 한 target/timeframe dataset과 WebSocket subscription을 계속 공유한다. hedge price 조회는 전환
  신호가 있을 때만 허용하며 불필요한 polling을 추가하지 않는다.
- monitor state/snapshot directory는 0700, 파일은 0600을 강제한다. Telegram token은 환경변수에만
  두고 UI/API/log/state에 노출하지 않는다.
- target 설정은 최대 50개, 모든 신규 string/array는 기존 document limit 안에서 bounded validation을
  적용한다.
- 360/390/768/1440px, visible focus, semantic label/status, 색 이외 상태 표현을 지킨다.

## Acceptance criteria

- deterministic candle fixture에서 15분 open/session-VWAP 상·하향 교차가 각각 BUY/SELL로 검출되고
  다음 candle을 바꾸어도 과거 신호가 변하지 않는다.
- legacy monitor JSON round-trip이 유지되고 종목별 OFF target은 runtime expansion에서 제외된다.
- primary↔hedge 전환과 반복 신호 억제가 unit test로 고정되며 재시작 뒤 state가 보존된다.
- paper position identity는 strategy revision이 아니라 strategy id+target으로 유지되고, 현재 보유한
  instrument snapshot을 저장해 설정 변경 뒤에도 실제로 기록된 이전 hedge를 먼저 정리한다.
- repository 장애 fixture에서 snapshot strategy로 monitor가 시작되고 status가 degraded source를
  표시한다.
- Telegram integration test가 compound transition message와 successful atomic state update를
  검증한다.
- 관련 unit/integration/E2E와 clean-tree full release gate가 통과하고 loopback production server와
  monitor heartbeat가 확인된다.

## Explicit non-scope

- broker 계좌 연결, 실제 주문, inverse 자동 추천, leverage 적합성 판단, 수익 보장 표현
- tick/intrabar 조기 알림. MVP 신호는 provider가 확정한 15분봉 완료 뒤 발생한다.
- 원격 repository 장애 중 전략 CRUD를 local에 별도로 쓰고 나중에 병합하는 기능
