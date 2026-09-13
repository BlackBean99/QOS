# Instrument Catalog Cache and Multi-Target Tracking Specification

## Status

Implemented — release verification pending, 2026-09-01.

## Problem

종목 검색이 process memory에만 24시간 캐시되어 재시작 뒤 다시 TOSS 전체 종목 API를 호출한다.
또한 `securityType=STOCK&commonShare=true`로 제한해 ETF·ETN·REIT·우선주 등 TOSS가 거래
가능하다고 반환하는 종목을 검색하지 못한다. 저장 전략 감시는 전략에 묶인 한 종목만 구독하므로,
전략 하나를 사용자가 고른 여러 종목에 적용하는 흐름도 없다.

## User outcomes

1. 이름이나 티커로 국내·미국의 TOSS 거래 가능 종목을 검색하며 ETF 등 상품 유형을 확인한다.
2. 정상 조회한 종목 master는 앱 재시작 뒤에도 재사용한다.
3. 저장 전략을 선택하고 최대 50개 감시 종목을 추가·삭제한 뒤 한 번에 감시를 켠다.
4. monitor는 각 대상의 완료 봉 BUY/SELL을 별도로 판단하고 Telegram에 종목명·티커를 보낸다.
5. 종목 수가 늘어도 같은 종목·timeframe의 candle dataset과 WebSocket 구독은 공유한다.

## Provider and catalog contract

- Source of truth는 TOSS OpenAPI 1.2.14의 `GET /api/v1/stocks/all`이다.
- `market`과 명시적 `status=ACTIVE`만 전송한다. `securityType`·`commonShare`는 생략해 공식
  계약의 전체 유형·보통주/우선주 전체를 받는다.
- 현재 공식 유형은 STOCK, FOREIGN_STOCK, DEPOSITARY_RECEIPT, INFRASTRUCTURE_FUND, REIT,
  ETF, FOREIGN_ETF, ETN, STOCK_WARRANTS다. UI는 provider의 `securityType`을 그대로 표시한다.
- 검색 범위는 TOSS가 해당 stock master에서 거래 가능하다고 반환한 활성 종목이다. 옵션·채권·
  선물이나 master에 없는 상품을 합성하거나 지원한다고 주장하지 않는다.
- 시장별 provider refresh는 `STOCK_ALL` 1 TPS를 침범하지 않게 직렬화한다.

## Persistent cache contract

- 기본 위치: `.qos/data/instrument-catalog-v1.json` (Git 제외, directory `0700`, file `0600`).
- schema version, market, fetchedAt, validated provider rows를 저장한다. 임시 파일 write 후 atomic
  rename하며 market별 최대 20,000개, 전체 파일 20 MiB를 넘으면 실패한다.
- fresh TTL은 24시간이다. memory hit, restart-safe disk hit, provider refresh를 구분한다.
- 같은 market의 concurrent miss는 한 promise로 합친다.
- fresh cache가 없으면 provider를 조회한다. 만료 cache가 있고 provider가 timeout, unavailable,
  rate_limited, forbidden 또는 unauthorized이면 fetchedAt부터 최대 7일까지만 `STALE`로 제공한다.
  invalid response/document는 손상된 데이터를 새 정상 데이터처럼 저장하지 않는다.
- API는 기존 `instruments`와 `source`를 보존하고 `cache` metadata를 additive하게 반환한다.
  사용자는 `HIT`, `REFRESHED`, `STALE` 및 기준 시각을 확인할 수 있다.
- `refresh=true`는 명시적 수동 갱신이다. 서버의 in-flight 병합과 1 TPS 직렬화는 그대로 적용한다.

## Monitor target contract

- `monitor.targets`는 optional InstrumentSnapshot array이며 최대 50개, instrumentId 중복 금지다.
- field가 없거나 빈 배열이면 legacy처럼 document의 대표 `instrument` 하나가 유효 target이다.
- 저장 전략의 대표 instrument는 backtest/chart 기준으로 유지한다. targets는 paper signal 감시
  universe이며 전략 정의 자체를 여러 문서로 복제해 저장하지 않는다.
- runtime에서 target마다 strategy의 `market`·`instrumentId`만 해당 snapshot으로 materialize하고
  같은 검증된 Entry/Filter/Exit/Risk/Execution 정의를 실행한다. v1/v2/v3 모두 지원한다.
- dataset key는 target instrumentId + timeframe이다. evaluation/delivery key에는 stored strategy id,
  revision, target instrumentId, side와 bar timestamp를 모두 포함한다.
- realtime trade는 market region과 symbol이 모두 일치하는 target만 평가한다.
- BUY/SELL은 완료 봉 paper signal이며 실제 주문을 생성하지 않는다.

## UX contract

- 기존 첫 종목 선택은 backtest/chart authoring을 위해 유지한다.
- 저장 전략 detail에 별도 “다종목 신호 감시” 영역을 둔다: 현재 전략 → 대상 검색 → 선택 목록 →
  저장/감시 ON. 대표 종목은 기본 대상임을 보여준다.
- 검색 결과와 선택 목록은 종목명, 티커, 시장, securityType을 표시한다.
- loading, empty, provider error, stale cache, 50개 한도와 저장 충돌을 텍스트로 설명한다.
- 모든 control은 keyboard로 동작하고 360/390/768/1440에서 document overflow가 없어야 한다.

## Observability questions

1. 검색이 provider, memory/disk cache 또는 stale fallback 중 어디서 제공됐는가?
2. market refresh에 얼마나 걸렸고 몇 개 row를 저장했는가?
3. 활성 저장 전략 수와 실제 감시 target/dataset 수는 각각 몇 개인가?
4. 특정 신호가 어느 strategy와 target에서 생성·전송·중복 제거됐는가?

`instrument_catalog_refresh`, `instrument_catalog_stale`, 기존 monitor structured event에 bounded
market/status/count/duration을 기록한다. 토큰, chat id와 provider body는 기록하지 않는다.

## Acceptance scenarios

- ETF 이름/티커 검색 결과에 `ETF`가 표시되고 선택 가능하다.
- provider를 한 번 성공시킨 뒤 새 search instance가 network 없이 disk catalog를 사용한다.
- TTL 만료 후 provider rate limit이면 7일 이내 catalog를 STALE로 표시해 검색하고, 7일 초과면
  provider error를 그대로 반환한다.
- 전략 하나에 AAPL, SPY, QQQ를 저장하고 monitor를 켜면 세 종목을 구독·평가하며 동일 timestamp
  신호도 세 개의 독립 delivery key를 갖는다.
- targets가 없는 기존 JSON 전략은 수정 없이 대표 종목 하나를 계속 감시한다.

## Non-goals

- 실제 주문, 옵션/채권/선물 master 통합, 자체 거래 가능성 판정
- 여러 전략을 묶은 portfolio order/risk engine
- 공개 서버, 다중 사용자 인증, 외부 Redis/queue
