# ADR-0012: Persistent instrument catalog and multi-target monitoring

## Status

Accepted

## Date

2026-09-01

## Context

TOSS 전체 종목 API는 영업일 단위 저변동 master이고 공식 문서도 하루 한 번 local caching을
권장한다. 현재 process-memory cache는 재시작마다 사라지며 세 시장을 동시에 요청해 `STOCK_ALL`
1 TPS 한도와 충돌할 수 있다. 또한 STOCK 보통주만 필터링해 거래 가능한 ETF·ETN·REIT·우선주를
제외한다. 실시간 monitor는 저장 전략의 대표 종목 하나만 감시해 전략을 여러 관심종목에 재사용할
수 없다.

## Decision

- `/stocks/all`에는 market과 ACTIVE만 지정하고 공식 default인 전체 security type/common share를
  사용한다. market refresh는 process 안에서 in-flight를 병합하고 1 TPS로 직렬화한다.
- validated market rows를 `.qos/data/instrument-catalog-v1.json`에 atomic `0600` JSON으로 저장한다.
  24시간 fresh TTL 이후 refresh하며 transient/auth provider failure에는 fetchedAt부터 최대 7일 stale
  fallback을 명시적으로 제공한다. API와 UI가 HIT/REFRESHED/STALE을 숨기지 않는다.
- 저장 전략의 monitor에 optional targets(최대 50, unique)를 additive하게 둔다. 없거나 비어 있으면
  대표 instrument 하나를 사용해 기존 JSON과 UI 동작을 보존한다.
- monitor는 strategy를 target별 runtime document로 materialize한다. dataset/WebSocket은
  instrument+timeframe으로 공유하고 evaluation/delivery identity에는 target instrumentId를 포함한다.
  signal은 완료 봉 paper alert이며 주문은 생성하지 않는다.

## Alternatives considered

### 브라우저 localStorage cache

서버 재시작과 무관하지만 monitor process가 재사용할 수 없고 검증·권한·여러 tab 동시성을 브라우저로
분산한다. server-only provider boundary와 맞지 않아 채택하지 않았다.

### Redis 또는 DB catalog

다중 instance에는 유리하지만 로컬 단일 사용자 MVP에 운영 서비스와 migration을 추가한다. atomic
local JSON으로 충분하므로 채택하지 않았다.

### security type별 여러 provider 요청

유형별 제어는 가능하지만 공식 API가 필터 생략 시 전체 유형을 반환하므로 호출 수와 rate-limit 위험만
늘어난다.

### target마다 저장 전략 복제

기존 monitor를 그대로 쓸 수 있지만 전략 변경이 N개 문서로 분기되고 UX가 다시 종목 중심이 된다.
하나의 정의와 target list를 유지하는 runtime materialization을 채택했다.

## Consequences and risks

- 첫 cold search는 지역의 3~4개 market을 1 TPS로 채워 수 초 걸릴 수 있으나 이후 검색과 재시작은
  local cache를 사용한다.
- stale 결과는 최대 7일 오래될 수 있으므로 UI에 기준 시각과 갱신 action을 표시한다.
- target 수에 따라 서로 다른 candle dataset의 첫 warm-up 비용은 증가한다. 동일 dataset 공유,
  session cadence와 failure backoff는 기존 정책을 유지한다.
- official stock master 범위 밖의 옵션·채권·선물은 검색되지 않는다.

## Revisit when

- 여러 app/worker instance가 같은 catalog를 동시에 갱신해야 할 때
- catalog file이 20 MiB 또는 market 20,000 rows 한도를 실제로 넘을 때
- TOSS rate-limit headers를 중앙 adaptive limiter로 공유할 필요가 생길 때
- target 50개에서 provider 비용/latency가 로컬 사용 범위를 넘을 때
