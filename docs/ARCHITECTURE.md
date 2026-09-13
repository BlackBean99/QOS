# Architecture

## Current state

QOS는 npm + Node.js 20.9 이상 + Next.js/TypeScript 단일 앱과 같은 저장소의 별도 local
monitor process로 구성된다. 실제 시장 adapter는 TOSS, 차트 runtime은 KLineChart 10이다.
전략과 백테스트 이력은 구성된 경우 Supabase Postgres, 미구성 개발·테스트에서는 versioned
local JSON에 저장한다. 인증, public hosting과 주문 엔진은 없다.

## Repository map

```text
app/                    Next.js page, styles와 API routes
src/components/         종목/전략/KLineChart/라이브러리/Telegram UI
src/domain/strategy-v3/ strict Rule Chain, 72개 preset catalog와 allowlisted compiler
src/domain/strategy-runtime/ pure indicator/timeframe registry, evaluator와 Decision Trace
src/domain/backtest-v3/ position/exit/risk/execution, trade ledger와 metrics/comparison
src/server/toss/        OAuth, stock master, candle REST와 realtime WebSocket
src/server/             Supabase/local repository, 관리 service, HTTP 오류와 redacted logging
src/monitor/            completed-bar evaluator, runtime state와 delivery runner
scripts/live-monitor.ts 별도 monitor process entrypoint
scripts/local-deploy.ts loopback production lifecycle과 contract health check
supabase/               CLI config와 additive Postgres migrations
.qos/data/              gitignored local fallback/instrument catalog/settings/monitor JSON
.qos/runtime/           gitignored local production state/lock/log
tests/                  Vitest unit/integration
e2e/                    Playwright 360/390/768/1440와 axe
```

## Runtime data flow

```text
Browser
  -> /api/instruments -> persistent 24h catalog -> TOSS all-active domestic/US stock master
  -> /api/market/candles -> TOSS adjusted 1d/1m -> optional local 5m aggregation
  -> /api/market/stream -> TOSS trade WebSocket -> SSE -> current display candle
  -> strategy compiler/builder -> strict Strategy v1/v2/v3
  -> /api/strategy-engine/{catalog,compile,backtests} -> actual TOSS candles -> paper result/comparison
  -> /api/strategy-recommendations -> one dataset -> all 43 Entry runs -> historical ranking
  -> /api/strategies CRUD/import/export -> Supabase qos_strategies
  -> /api/strategies/:id/backtests -> TOSS paper backtest -> qos_backtest_runs snapshot
  -> /api/backtest-runs/:id -> full history read/delete
  -> /api/telegram connect/test -> .qos/data/settings.json + Telegram Bot API

npm run monitor (development) / managed monitor (local release)
  -> acquire repository-scoped singleton process lease
  -> reads enabled stored strategies; on failure reads monitor-only last-known-good snapshot
  -> expands optional monitor.targets and filters per-target enabled controls
  -> refreshes desired state every 60s and subscribes TOSS trades
  -> shares instrument+timeframe candles and repairs completed gaps on session-aligned windows
  -> evaluates completed 1m~1w bars as paper BUY/SELL
  -> plans WAITING/LONG_PRIMARY/LONG_HEDGE paper transitions for explicit inverse targets
  -> dedupe key(strategy id, revision, target instrument, side, bar) in monitor-state.json
  -> stable position key(strategy id, target) + held instrument snapshot across revisions
  -> Telegram plain-text delivery, then atomic sent+paper-leg state write

npm run release:local
  -> stop only the PID owned by this repository's saved deployment state
  -> format/lint/typecheck/Vitest/build/audit and Chromium E2E
  -> start Next production on 127.0.0.1 and a repository-local monitor worker
  -> verify home + complete 43/8/21 catalog + compiler + fresh non-error monitor heartbeat
  -> refuse a second live monitor lease owner
  -> atomically record both PID/start times/Git commit/dirty state in .qos/runtime
```

`deploy:local`은 빠른 build/restart 명령이고 `release:local`은 공식 전체 gate 경로다. 상태 파일의
repository root, PID 시작 시각, process cwd와 server/worker command가 모두 일치하지 않으면 종료를
거부하며 정상 server의 정확한 loopback listener도 검사한다. MVP 완료 전에는 npm registry publish나 원격 hosting을 이 흐름에
연결하지 않는다. 자세한 결정과 rollback은 ADR-0010을 따른다.

## Provider and failure boundaries

- OAuth credential과 Telegram token은 environment에서만 읽는다. OAuth token은 timeout과
  최대 2회 retry/bounded backoff를 갖는 single-flight cache다. provider 401은 quota-sensitive
  stock master도 cached token을 폐기하고 정확히 한 번 재인증하지만 429/5xx 내부 retry는 하지 않는다.
- 종목 master는 `market + ACTIVE`만 요청해 TOSS가 반환하는 주식·ETF·ETN·REIT·우선주 등
  전체 security type을 보존한다. quota-sensitive endpoint 내부 retry는 끄고 시장 refresh를 1.1초
  간격으로 single-flight 직렬화하며 validated row를
  `.qos/data/instrument-catalog-v1.json`에 atomic `0600`으로 저장한다. 24시간 fresh, transient/auth
  실패 시 fetchedAt부터 최대 7일 STALE이며 HIT/REFRESHED/STALE, MEMORY/DISK/PROVIDER 출처와 기준
  시각을 API/UI에 표시한다.
  빈 결과나 provider 오류는 fixture로 대체하지 않는다.
- TOSS candle은 최대 200개 단위로 paging/dedupe해 오래된 순으로 정규화한다. 5분봉은 1분봉
  OHLCV를 로컬 집계한다.
- backtest 기간은 종목 timezone의 inclusive date로 resolve하며 자동 기간은 분봉 30일/일봉 2년/
  주봉 5년이다. recommendation은 한 dataset으로 요청 timeframe과 호환되는 Entry만 실행하고 bounded
  TTL/in-flight cache를 사용한다. 실제 candle 기간과 비호환 제외 수는 요청 기간과 별도로 반환한다.
- realtime `trade:kr/us`는 full-replace subscription, ping과 reconnect를 처리한다. sequence가
  없으므로 REST candle이 authoritative하며 stream volume 합계를 사용하지 않는다.
- 오류 log는 구조화하고 credential/token/chat id 같은 민감 필드를 redact한다.

## Persistence and concurrency

- configured Supabase Data API adapter는 server-only secret과 8초 timeout, read-only bounded
  retry/backoff를 사용한다. response를 strict schema로 재검증하고 update/delete에 id+revision을
  함께 걸어 optimistic concurrency를 원자적으로 지킨다.
- `qos_strategies`와 `qos_backtest_runs`는 versioned additive migration, RLS, browser role revoke를
  사용한다. history 목록은 summary-only이고 단건 조회만 immutable strategy/instrument snapshot과
  full result를 반환한다. 전략 삭제 시 run은 보존하고 FK만 null이 된다. counter row는
  500개/5MiB 한도를 concurrent transaction에서도 원자적으로 예약·반납한다.
- Supabase env가 없는 개발·테스트의 `strategies.json`과 `backtest-runs.json`은 strict envelope,
  temporary write + atomic rename, backup, `0600` permission과 pre-write byte 검증을 사용한다.
  삭제된 전략의 local run도 idempotent detach해 같은 UUID 재가져오기에 연결되지 않는다.
  구성된 remote 장애는 local fallback하지 않는다.
- import는 strict schema/5MiB document(+bounded transport overhead)/id 정책을 검증한다. export는
  시크릿·chat id·delivery state를 제외하고 remote bulk replace는 optimistic concurrency를
  우회하므로 지원하지 않는다.
- 전략 mutation은 Next server의 repository boundary가 소유하고 monitor runtime은 같은
  repository에서 전략을 읽으며 별도 `monitor-state.json`과 read-only
  `monitor-strategies-v1.json` snapshot을 소유한다. snapshot fallback은 monitor read에만 쓰고 CRUD
  write에는 사용하지 않는다.
- `monitor.targets`는 최대 50개 unique instrument snapshot의 optional additive field다. 없거나
  비어 있으면 대표 종목 하나로 호환 실행한다. runtime은 target별로 market/instrumentId만
  materialize하고 같은 target+timeframe dataset 및 subscription을 공유한다. optional
  `targetControls`는 target별 enabled와 명시적 hedge snapshot을 저장한다.

## Quant and chart boundaries

- Strategy v1은 일봉, v2는 5분봉 호환 계약으로 유지한다. v3는 이름 기반 분기 없이 recursive
  Entry/Filter Rule을 실행하고 기본적으로 T close 신호→T+1 open paper fill을 사용한다.
- v3 자연어 compiler는 여러 catalog preset을 로컬에서 하나의 Rule Chain으로 합성한다. 사전 밖
  입력의 optional OpenAI 출력은 preset id intent만 허용하며 선택 종목과 strict DSL은 서버가
  재구성한다. 모델 출력 코드나 자유 expression은 실행 경로에 들어오지 않는다.
- v3 indicator registry는 SMA/EMA/MACD/ADX/DMI/Ichimoku/RSI/Stochastic/ROC/Momentum,
  ATR/ATRP/Bollinger/Donchian/Keltner, 6종 VWAP와 band/distance, RVOL/OBV/CMF, Z-score/MA
  deviation, opening range/confirmed market structure/SAR를 named output으로 계산한다.
- v3 position state가 initial/current stop, high/low since entry, remaining quantity, current R와
  fired exits를 소유한다. Exit priority, monotonic trailing, break-even, scale-out, commission,
  slippage, spread, tick과 intrabar policy는 versioned JSON이다.
- v3 ledger의 gross PnL은 provider raw price 기준이며 commission과 raw↔execution slippage를 각각
  빼서 net을 계산한다. result는 lifecycle event log와 condition 집계, 거래 없음 원인을 포함한다.
- Higher timeframe은 거래소 session open 정렬 bucket에서 완료된 candle만 as-of projection하고,
  breakout·swing·Ichimoku source는 미래 봉을 참조하지 않는다.
- 실제 종목은 strategy와 함께 immutable instrument snapshot을 저장해 ticker metadata 변경과
  provider lookup을 분리한다.
- KLineChart는 browser-only lazy chunk다. 27개 built-in, QOS custom 4개와 exact-version
  `@ixjb94/indicators` 기반 확장 74개를 하나의 105종 catalog로 제공한다. 각 지표는 stable
  instance id, 계산 파라미터, OHLC/composite source, chart/1D timeframe과 style을 갖고
  KLineChart 실제 indicator로 생성된다. 1D 지표를 분봉에 투영할 때는 직전 완료 일봉 값만
  사용해 미래정보를 막는다.
- 19개 drawing은 KLineChart built-in overlay와 QOS rectangle/pitchfork/fan을 합쳐 icon
  toolbar로 제공하고 timestamp/value point를 QOS 저장 schema에 serialize한다.
- KLineChart v10의 `forward`는 older/left, `backward`는 newer/right다. provider cursor와
  timestamp set을 별도 reducer가 소유하며 inclusive boundary, 중복 timestamp, 같은 cursor와
  no-progress page에서 추가 older 요청을 종료한다.
- 일봉 실시간 bucket은 종목 timezone의 local midnight, 1/5분봉은 UTC instant interval로
  구분한다. BUY/SELL은 문자·방향·색 overlay와 동일 내용의 HTML 표를 함께 제공한다.

## Safety constraints

- 계좌, 주문, position subscription과 주문 endpoint는 사용하지 않는다.
- 어떤 입력도 코드로 평가하지 않으며 route/store/backtest 경계에서 Zod로 재검증한다.
- service-role endpoint는 인증 없는 localhost 단일 사용자 경계다. 공개 배포 전에는 Supabase
  Auth와 owner-scoped RLS를 별도 ADR/migration으로 추가해야 한다.
- live order 또는 provider 교체는 별도 ADR과 migration/안전 설계가 필요하다.

## Adopted decisions

단일 앱/전략 계약/종목 선택/OpenAI compiler는 ADR-0001~~0004, TOSS+monitor/local JSON/
KLineChart는 ADR-0005~~0007, Supabase primary persistence는 ADR-0008, Strategy v3 DSL과
conservative execution은 ADR-0009를 따른다.
Verified loopback lifecycle은 ADR-0010, 추천·기간·monitor cadence는 ADR-0011, persistent
instrument catalog와 multi-target monitoring은 ADR-0012를 따른다.
Monitor snapshot fallback, 15분 VWAP open 교차와 paper hedge state는 ADR-0013을 따른다.
백테스트 회계·진단·preset timeframe 호환성과 TOSS 401 복구는 ADR-0014를 따른다.
