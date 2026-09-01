# ADR-0011: Historical all-entry recommendation and efficient tracking

## Status

Accepted

## Date

2026-09-01

## Context

종목을 고른 사용자가 수십 개 Strategy v3 진입 아이디어 중 어디서 시작할지 판단하기 어렵고,
기존 backtest API는 1,200봉 고정이라 비교 기간을 설명하거나 재현할 수 없었다. “가장 수익률이
높은 전략”은 미래 예측 또는 parameter 최적화로 오해될 수 있어 평가 universe, 기간, 비용과 순위
기준을 고정해야 한다.

기존 monitor는 WebSocket을 사용하지만 15초 tick마다 저장소를 다시 읽고 strategy id별 candle
cache를 가져 동일 종목의 복수 전략이 REST를 중복 호출했다. UI에서 monitor를 ON해도 별도 terminal
process를 직접 시작해야 해 장시간 추적이 실제 local release lifecycle에 포함되지 않았다.

## Decision

- 추천 universe는 현재 `ENTRY_PRESETS_V3` 42개 전체다. 각 preset은 별도 strategy dispatch가
  아니라 `createPresetStrategyV3`가 만드는 editable DSL이며, 동일 TOSS dataset, ATR 2x stop +
  2R target, next-bar-open과 같은 commission/slippage/spread로 공통 v3 engine에서 실행한다.
- “추천”은 선택한 역사 구간에서 거래가 한 번 이상 발생한 후보의 `totalReturnPercent` 내림차순
  1위다. 동률은 절대 MDD 오름차순, Sharpe 내림차순, preset id 순이다. 결과에는 in-sample,
  survivorship/provider 한계와 실제 사용 candle 기간을 표시한다.
- backtest window는 종목 timezone의 inclusive 날짜다. 비우면 intraday 30일, daily 2년, weekly
  5년을 사용한다. TOSS 1분 source 한계 때문에 custom intraday는 최근 31일 이내·최대 31일로
  fail closed한다. 일반 v3와 저장 전략 backtest도 같은 기간 계약을 사용한다.
- 추천 결과는 instrument/timeframe/resolved window/catalog version key의 최대 100개 in-process
  TTL cache에 저장하고 같은 in-flight 요청을 병합한다. TTL은 완료 봉 cadence에 맞추며 1시간을
  넘지 않는다.
- monitor는 저장 전략을 기본 60초마다 refresh하고 15초 heartbeat와 분리한다. dataset은
  `instrumentId + timeframe`으로 공유하고 동시 load를 병합한다. REST fetch window는 거래소 local
  PRE/장중 bar bucket/POST에 정렬하며, initial warm-up 뒤에는 마지막 candle과 현재 시각 사이 gap +
  2개만 bounded recovery한다.
- provider page 요청 수, dataset cache hit, 마지막 provider sync와 strategy refresh를 monitor
  state와 redacted structured log에 기록한다. 실패한 provider load는 dataset key별 30초부터 시작해
  최대 5분인 exponential backoff로 negative-cache하여 realtime trade마다 REST를 재호출하지 않는다.
- 완료 봉은 regular session close를 상한으로 계산한다. 따라서 세션 마지막 60분/4시간 부분 봉은
  nominal interval이 아니라 장 종료에 완료되고, 일봉/주봉은 provider 확정 여유 5분 뒤에 사용한다.
- `release:local`/`deploy:local`은 Next production server와 별도 monitor worker를 함께 시작하고
  각각 PID/cwd/command/start time을 검증한다. monitor는 repository-scoped PID lease를 먼저
  획득하며 이미 live worker가 있으면 두 번째 worker를 시작하지 않는다. monitor는 Next request 내부
  background task로 합치지 않는다. 개발 서버에서는 managed release가 없을 때 `npm run monitor`를
  독립적으로 사용할 수 있다.

## Alternatives considered

### 최근 성과가 좋은 일부 전략만 비교

호출과 CPU는 줄지만 사용자가 요구한 momentum, volatility, volume, VWAP, Ichimoku, mean
reversion과 market structure 전체 universe를 평가하지 않는다. catalog 42개를 한 dataset에서
실행하는 비용이 로컬 MVP에서 감당 가능하므로 채택하지 않았다.

### 수익률 최대 parameter optimization

표면 수익률을 높일 수 있지만 data snooping과 과최적화를 크게 늘리고 “추천”을 미래 성과처럼
보이게 한다. 이번 기능은 각 preset 기본 parameter 비교로 제한하고 walk-forward/out-of-sample은
별도 기능으로 남긴다.

### 브라우저 interval polling

구현은 간단하지만 브라우저가 닫히면 중단되고 server credential 경계와 비용 통제가 약하다.
기존 별도 worker의 WebSocket + REST repair 구조를 유지한다.

### 전략별 candle polling

코드가 단순하지만 같은 종목에 Exit만 다른 전략을 여러 개 추적할 때 API 비용이 전략 수에
비례한다. 신호 evaluator만 전략별로 실행하고 market dataset은 공유하는 방식을 채택했다.

### 범용 supervisor 또는 queue

crash restart와 scheduling은 강화되지만 Mac 단일 사용자 MVP에 새 운영 계층이 과도하다. 현재
verified local release가 두 프로세스의 lifecycle만 명시적으로 소유한다.

## Consequences and risks

- 42개 후보가 한 번의 candle download를 공유하지만 engine CPU는 42회 사용한다. bounded cache로
  같은 완료 봉 구간의 반복 요청을 피하며 duration을 log로 관측한다.
- 가장 높은 과거 총수익률은 미래 최적 전략이 아니다. parameter sensitivity, out-of-sample,
  delisted universe와 benchmark ranking은 아직 제공하지 않는다.
- local monitor는 release와 함께 실행되지만 Mac sleep/reboot, process crash 뒤 자동 재시작과 로그
  rotation은 제공하지 않는다. status/heartbeat와 재배포가 수동 복구 경로다.
- 하나의 정상 entrypoint는 lease로 보호되지만 `MonitorRunner`를 직접 import해 별도 custom process를
  만드는 비표준 실행은 운영 계약 밖이다.
- early close/특별 휴장에 대한 독립 calendar가 없어 regular session PRE/POST 경계는 TOSS candle과
  provider session 정의에 의존한다.
- in-memory 추천 cache는 Next process 재시작 때 비워지고 다중 process 간 공유되지 않는다. 현재
  single-process local scope에서는 일관성보다 단순성이 우선한다.

## Revisit when

- 추천 p95가 2초를 지속 초과하거나 42-run CPU가 local UX를 방해할 때
- TOSS가 더 긴 intraday 보존, exchange calendar 또는 conditional candle endpoint를 제공할 때
- 여러 사용자/여러 worker, 24시간 SLA, Mac reboot 자동 복구가 필요할 때
- walk-forward/out-of-sample과 parameter sensitivity를 사용자 기능으로 승인할 때
