# SPEC: signal-monitoring

## Contract

별도 `npm run monitor` 프로세스가 JSON에 저장된 enabled monitor를 읽고 TOSS WebSocket을
구독한다. 5분 전략은 완성 5분 봉, 일봉 전략은 완성 거래일 봉에서 평가한다. 기존 전략
allowlist만 실행하며 사용자 코드를 평가하지 않는다.

신호 key는 `<strategyId>:<revision>:<side>:<bar timestamp>`다. 전송 전과 전송 결과를
`.qos/data/monitor-state.json`에 기록해 재연결·재시작 중 중복 알림을 막는다. 프로세스는
heartbeat, provider 상태, 마지막 봉, 마지막 신호와 delivery 결과를 구조화 로그와 상태
파일에 남긴다.

## Acceptance criteria

- browser를 닫아도 monitor 프로세스가 실행 중이면 감시가 지속된다.
- 연결 끊김은 bounded exponential backoff로 복구하고 REST 캔들로 gap을 재동기화한다.
- 진행 중 봉, 중복 이벤트와 오래된 이벤트는 알림을 만들지 않는다.
- monitor 중단은 구독 해제이며 실제 주문이나 계좌 접근을 하지 않는다.
