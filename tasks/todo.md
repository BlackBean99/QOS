# Quant Strategy Engine v3

- [x] strict v3 Rule Chain과 모든 operand/operator/parameter metadata가 검증된다.
- [x] Entry 42·Exit 20·Filter 8 preset이 name dispatch 없이 validate·execute된다.
- [x] VWAP variants, MTF completed candle과 모든 indicator prefix-invariance가 검증된다.
- [x] Entry/Exit trace, monotonic trailing, break-even, partial exit와 risk sizing이 동작한다.
- [x] 비용·tick·session·intrabar policy와 전체 metrics/trade ledger/golden result가 동작한다.
- [x] compiler/API/v3 persistence/history migration/paper monitor가 strict boundary를 유지한다.
- [x] 새 Builder에서 수십 rule 검색·중첩·수정, A–E backtest/comparison/trace가 동작한다.
- [x] 360/390/768/1440 keyboard/axe/performance와 전체 repository gates가 통과한다.
- [x] 자체 review, secret scan, DB migration과 local production smoke가 완료된다.
- [x] 검증된 release commit이 `origin/main`에 push된다.
- [ ] 인증으로 보호된 remote server deploy가 완료된다.

**Verify:** focused RED/GREEN Vitest, full repository gates, Playwright, DB migration status,
production health/API/UI smoke

---

# Workspace UX audit and redesign

- [x] 실제 TOSS 종목이 synthetic으로 표기되지 않고 시장 전환 시 오래된 검색 상태가 제거된다.
- [x] monitor 상태가 한국어 상태·heartbeat·safe error code·복구 행동을 텍스트로 제공한다.
- [x] 검색 전에는 종목 선택과 기존 전략 복구, 선택 후에는 차트·전략 작성이 우선 노출된다.
- [x] 360/390/768/1440에서 새 research desk UI가 overflow 없이 keyboard/axe를 통과한다.
- [x] format/lint/typecheck/Vitest/Playwright/build/audit/production browser와 문서가 완료된다.

**Verify:** focused Vitest/Playwright, full repository gates, production browser smoke

---

# Supabase strategy management

- [x] capability/spec/ADR와 additive migration이 작성된다.
- [x] Supabase strategy CRUD/import/export와 local unconfigured adapter가 contract test를 통과한다.
- [x] 저장 전략 backtest가 snapshot history로 저장되고 summary/detail/delete가 동작한다.
- [x] library UI가 history loading/error/empty/detail/delete를 keyboard/mobile에서 제공한다.
- [x] configured remote migration/smoke와 전체 gate/build/runtime은 완료, final re-review를 닫는다.

**Verify:** repository/service/integration Vitest, Playwright 360/390/768/1440, full gates

---

# Indicator manager and drawing catalog

- [x] built-in 27종, QOS custom 4종, 확장 74종의 105개가 검색 가능한 catalog에 표시되고 실제 계산된다.
- [x] 지표를 추가하고 instance별 기간/source/chart-or-1D/색/굵기를 dialog에서 저장한다.
- [x] 같은 지표의 중복 instance와 개별 삭제, legacy 설정 호환, 전략 저장·복원이 동작한다.
- [x] 19개 drawing이 아이콘과 이름을 가지며 실제 overlay 생성·삭제·복원이 동작한다.
- [x] 360/390/768/1440 keyboard/axe/browser, 전체 gate/build/runtime이 통과한다.

**Verify:** focused Vitest, indicator lifecycle Playwright, full repository gates, production smoke

---

# Completed: Interactive chart parity correction

- [x] KLineChart pagination 방향이 공식 v10 계약과 일치하고 과거 candle이 왼쪽으로만 추가된다.
- [x] inclusive/repeated page에서 timestamp 중복과 무한 요청이 발생하지 않는다.
- [x] VWAP·Ichimoku·Stochastic RSI가 실제 chart indicator로 생성·toggle된다.
- [x] brush/Fibonacci를 포함한 모든 노출 drawing이 실제 생성·삭제·저장·복원된다.
- [x] 360/390/768/1440, keyboard, axe, console/network, production build/runtime이 통과한다.
- [x] 독립 리뷰 required finding이 모두 해소되고 문서 결과가 최신 gate와 일치한다.

**Verify:** focused Vitest, Playwright chart regression, 전체 repository gate, production browser smoke

---

# MVP daily backtest walking slice tasks

> 현재 active checklist는 아래 "Live market strategy workspace"이며 기존 checklist는 완료 이력이다.

## Live market strategy workspace

### Task 1: TOSS market data boundary

- [x] Dynamic domestic/US instrument schema와 legacy fixture 격리가 동작한다.
- [x] OAuth single-flight, daily stock cache, local search와 paged candles가 strict validation된다.
- [x] timeout/429/5xx/invalid payload가 안전하고 관측 가능한 오류로 변환된다.
- [ ] configured real provider search/candle smoke가 secret 출력 없이 통과한다.

**Verify:** `npm run test:unit -- instruments toss`, `npm run test:integration -- toss`

### Task 2: JSON strategy library

- [x] 전략·chart schema와 atomic `0600` repository가 CRUD/restart/conflict를 통과한다.
- [x] import/export가 strict/size/id 충돌을 검증하고 secret을 포함하지 않는다.
- [x] 저장 view에서 backtest/monitor action을 선택할 수 있다.

**Verify:** `npm run test:unit -- strategy-store`, `npm run test:integration -- strategies`

### Task 3: Interactive real-data chart — 2026-08-25 재검증 완료

- [x] KLineChart가 실제 candle, 한국식 색, grid, crosshair, pan/zoom/fit/scroll을 제공한다.
- [x] VWAP/Ichimoku/Stochastic RSI를 포함한 지표 toggle이 실제 indicator instance를 만든다.
- [x] requested built-in/custom drawing이 실제 point를 만들고 settings에서 저장·복원된다.
- [x] 과거 pagination이 중복·역방향·무한 조회 없이 명시적 시작 경계에서 멈춘다.

**Verify:** `npm run test:unit -- chart`, `npm run test:e2e`

### Task 4: Live monitor and Telegram

- [x] worker가 trade subscription/reconnect/gap sync와 completed-bar evaluation을 수행한다.
- [x] persisted idempotency가 duplicate alert를 막고 상태/로그는 secret을 마스킹한다.
- [x] Telegram private chat 연결과 plain-text delivery의 오류 경로가 검증된다.

**Verify:** `npm run test:unit -- monitor telegram`, `npm run test:integration -- monitor`

### Task 5: Integrated gates and handoff

- [x] 360/390/768/1440, keyboard, axe, no-overflow와 chart lazy-load를 검증한다.
- [x] format/lint/typecheck/test/E2E/build/audit와 app/monitor runtime smoke가 통과한다.
- [ ] configured TOSS real provider master+candle smoke가 통과한다(현재 HTTP 403).
- [x] README/Product/Architecture/Quality/DESIGN/WORKLOG/ExecPlan/ADR가 실제 상태다.
- [x] status/diff/diff-check/secret scan과 자체 리뷰가 완료된다.

**Verify:** 모든 repository quality command와 runtime smoke

## Task 1: Scope and toolchain

**Acceptance criteria:**

- [x] PRD가 현재 walking slice와 후속 roadmap을 구분한다.
- [x] 앱 프레임워크와 계약 결정이 ADR에 기록된다.
- [x] npm install/dev/format/lint/typecheck/test/e2e/build/start 명령이 실제로 존재한다.

**Verification:** `npm run format:check`, `npm run lint`, `npm run typecheck`

**Files likely touched:** `package.json`, config files, PRD, ADRs, ExecPlan

## Task 2: Strategy contract and bounded parser

**Acceptance criteria:**

- [x] 대표 KOSPI/NASDAQ 문장이 version 1 전략 구조로 변환된다.
- [x] 시장 누락, 분봉 요청, 지원하지 않는 규칙과 범위 오류가 실행 전에 거부된다.
- [x] 어떤 사용자 입력도 코드로 평가하거나 실행하지 않는다.

**Verification:** `npm run test:unit -- strategy`

**Dependencies:** Task 1

**Files likely touched:** `src/domain/strategy.ts`, `src/domain/interpret.ts`, unit tests

## Task 3: Deterministic market fixtures and backtest

**Acceptance criteria:**

- [x] KOSPI/NASDAQ fixture가 시장, 시간대, 통화, 달력과 source version을 분리한다.
- [x] 종가 신호가 다음 세션 시가에 체결되고 비용·slippage가 반영된다.
- [x] return, MDD, Sharpe, win rate, equity, drawdown과 거래 이유가 재현 가능하다.

**Verification:** `npm run test:unit -- backtest`

**Dependencies:** Task 2

**Files likely touched:** fixture files, `src/domain/backtest.ts`, unit tests

## Checkpoint: Domain

- [x] Unit tests and typecheck pass.
- [x] 동일 입력이 동일 결과를 반환한다.

## Task 4: API and responsive workflow

**Acceptance criteria:**

- [x] 사용자가 전략 입력 → 구조 확인 → backtest → 결과를 한 화면에서 완료한다.
- [x] loading, validation, server error와 중복 제출 상태가 명확하다.
- [x] 결과에 비용, 체결, 데이터 출처, 한계와 synthetic 경고가 표시된다.

**Verification:** `npm run test`, `npm run test:e2e`

**Dependencies:** Task 3

**Files likely touched:** route handlers, app page, UI components, styles, e2e test

## Task 5: Production and browser verification

**Acceptance criteria:**

- [x] 360px, 390px, 768px, 1440px에서 핵심 흐름이 동작한다.
- [x] 키보드 focus, semantic labels, automated accessibility 검사와 reduced motion이 확인된다.
- [x] 모든 품질 명령과 production build가 통과하고 production server가 실행된다.
- [x] 문서, WORKLOG와 ExecPlan이 실제 결과와 일치한다.

**Verification:** 모든 `npm run` 품질 명령, production server smoke test, `git diff --check`

**Dependencies:** Task 4

**Files likely touched:** tests, README, AGENTS, architecture/quality/worklog/ExecPlan docs

---

# Instrument selection and trade chart tasks

## Task 1: Instrument contract and catalog

**Acceptance criteria:**

- [x] 이름·티커·시장 검색과 no-result가 결정론적으로 동작한다.
- [x] stable `instrumentId`와 market mismatch가 strict validation된다.
- [x] KOSPI/NASDAQ instrument fixture가 currency/timezone/calendar/source/version을 유지한다.

**Verification:** `npm run test:unit -- instruments strategy`

**Files likely touched:** instrument domain, fixture, Strategy schema, unit tests

## Task 2: Strategy and backtest propagation

**Acceptance criteria:**

- [x] builder와 parser route가 선택 instrument를 Strategy에 보존한다.
- [x] backtest가 선택 instrument candle을 사용하고 price series와 동일 symbol trades를 반환한다.
- [x] 동일 input은 동일 결과이며 invalid/unknown instrument는 실행되지 않는다.

**Verification:** `npm run test:unit -- strategy backtest`, `npm run test:integration`

**Dependencies:** Task 1

**Files likely touched:** parser, backtest, route handlers, related tests

## Checkpoint: Domain and routes

- [x] Focused unit/integration tests and typecheck pass.
- [x] Market/instrument inconsistency fails closed.

## Task 3: Search and trade chart workflow

**Acceptance criteria:**

- [x] 키보드/터치로 종목을 검색·선택하고 종목 변경 시 이전 output이 reset된다.
- [x] 가격 chart에서 BUY/SELL을 도형·문자·색으로 구분한다.
- [x] marker와 동일한 fill date/price를 읽는 table alternative와 no-result 복구가 있다.

**Verification:** `npm run test:e2e`

**Dependencies:** Task 2

**Files likely touched:** workbench/builder/result/chart components, CSS, E2E test

## Task 4: Full verification and handoff

**Acceptance criteria:**

- [x] format, lint, typecheck, unit/integration, E2E, build와 runtime smoke가 통과한다.
- [x] 360/390/768/1440, keyboard, axe, console/network와 overflow를 확인한다.
- [x] README, Product, Architecture, Quality, DESIGN, WORKLOG, ADR와 ExecPlan이 실제 상태다.

**Verification:** 모든 repository quality command, runtime browser smoke, `git diff --check`

**Dependencies:** Task 3

**Files likely touched:** docs, plan/task tracking, relevant verification tests

---

# Phase 1B indicator research tasks

## Task 1: Strategy v2 and indicator math

- [x] VWAP/EMA/ATR/Ichimoku/Stochastic RSI가 정의된 warm-up과 reference 값을 반환한다.
- [x] 5분봉 VWAP entry와 여덟 exit 설정이 strict Strategy v2로 검증된다.
- [x] unknown/model-added field와 market/instrument mismatch를 거부한다.

**Verify:** `npm run test:unit -- indicators advanced-strategy`

## Task 2: Intraday comparison engine

- [x] synthetic 5-minute fixture에서 signal bar 다음 open에 체결한다.
- [x] eight-run comparison과 return/MDD/Sharpe/PF/MFE/MAE/holding metrics가 결정론적이다.
- [x] price/indicator/trade series가 같은 instrument/timeframe을 유지한다.

**Verify:** `npm run test:unit -- advanced-backtest`

## Task 3: LLM compiler boundary

- [x] missing key, timeout/provider failure, invalid output과 valid mocked output이 구분된다.
- [x] model output은 strict Strategy v2 validation 전에는 반환/실행되지 않는다.
- [x] prompt size/token/store/secret 경계가 테스트된다.

**Verify:** `npm run test:integration`

## Task 4: Candle-first research UI

- [x] 기본 OHLC candle과 VWAP/EMA/Ichimoku toggle, Stochastic RSI panel이 표시된다.
- [x] reference prompt→JSON confirmation→exit comparison을 한 흐름에서 완료한다.
- [x] chart/table은 keyboard/axe와 360/390/768/1440에서 동작한다.

**Verify:** `npm run test:e2e`

## Task 5: Full verification and handoff

- [x] 전체 quality gate, build, production smoke와 independent review가 통과한다.
- [x] PRD/Product/Architecture/DESIGN/README/ADR/ExecPlan/WORKLOG가 실제 상태다.
- [x] 실제 data/LLM credential 부재와 남은 quant 위험을 명시한다.

**Verify:** all repository gates and `git diff --check`
