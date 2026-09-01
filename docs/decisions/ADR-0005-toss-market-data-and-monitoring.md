# ADR-0005: TOSS market data adapter and explicit monitor process

## Status

Accepted — 2026-08-23

## Context

고정 fixture 종목은 실제 검색·시세·실시간 signal 요구를 충족하지 못한다. Next.js request
process에서 fire-and-forget 감시를 시작하면 개발 reload, build와 process restart 때 수명과
중복 실행을 보장할 수 없다. 실제 주문 안전 조건은 아직 충족하지 않았다.

## Decision

TOSS OpenAPI를 국내·미국 종목 master, 1분/일봉 candle과 real-time trade의 유일한 production
market-data adapter로 채택한다. REST OAuth token은 server-only single-flight cache로 관리하고
요청에 timeout, 최대 2회 retry와 bounded backoff를 적용한다. 종목 master는 공식 권고에 따라
시장별 하루 캐시한다.

지속 감시는 같은 저장소의 별도 `npm run monitor` Node 프로세스로 실행한다. verified local
release에서는 ADR-0011에 따라 배포 스크립트가 이 worker를 Next server와 함께 관리한다. browser/API는
monitor desired state만 JSON에 저장하고 worker가 WebSocket 구독, REST gap sync, 완성 봉 평가,
idempotency와 Telegram delivery를 소유한다. 이는 별도 서비스나 주문 엔진이 아니며 로컬
single-user process다. 본인 주문/계좌 채널과 실제 주문은 사용하지 않는다.

## Alternatives considered

- Next.js request 안의 background task는 reload/restart 뒤 수명과 단일 실행을 보장하지 못해
  제외했다.
- browser timer/service worker는 server credential 보호와 지속 실행을 보장하지 못한다.
- 별도 queue/service는 로컬 단일 사용자 MVP에 운영 복잡성이 과도하다.

## Consequences and risks

- 실시간 알림에는 앱과 별도로 monitor process가 실행 중이어야 한다. local release는 이를 함께
  시작하고 개발 서버에서는 수동 명령을 사용한다.
- WebSocket은 lossy이므로 수신 trade volume 합계를 공식 누적 거래량으로 취급하지 않는다.
- provider 장애는 visible unavailable 상태이며 synthetic fallback으로 숨기지 않는다.
- provider 교체, 공개 배포 또는 live order는 새 ADR과 안전 승인이 필요하다.

## Revisit when

공개 배포, 다중 사용자, 24시간 운영 SLA 또는 여러 monitor instance가 필요해지거나 TOSS
데이터 계약/라이선스가 요구 범위를 충족하지 못할 때 재검토한다.
