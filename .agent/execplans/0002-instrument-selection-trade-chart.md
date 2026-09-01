# ExecPlan 0002: Instrument selection and trade chart

## Status

Complete — 2026-08-22. Instrument selection, contract propagation, trade-price chart,
documentation and post-change verification are complete.

## Purpose and user-visible outcome

기존의 시장별 단일 synthetic 표본을 암묵적으로 실행하는 흐름을, 사용자가 KOSPI 또는
NASDAQ 개별 종목을 이름·티커로 검색하고 명시적으로 선택한 뒤 전략을 실행하는 흐름으로
확장한다. 결과에는 선택한 종목의 종가 차트와 BUY/SELL 체결 마커가 함께 표시되고, 색을
보지 못해도 같은 시점을 확인할 수 있는 표 대안이 있어야 한다.

## Specification

### Objective and success criteria

- 종목 검색은 bundled synthetic fixture catalog만 대상으로 하며 실시간 조회처럼 표현하지
  않는다.
- 검색어가 비어 있으면 전체 catalog를, 이름·티커·시장 검색어가 있으면 일치하는 종목만
  표시한다. 결과 없음 상태와 현재 선택을 명확히 표시한다.
- 선택한 `instrumentId`는 version 1 Strategy의 필수 필드이며 선언된 시장과 일치해야 한다.
- 빠른 조립과 문장 입력 모두 현재 선택 종목을 사용하고, 종목 변경 시 이전 구조·결과를
  폐기해 서로 다른 종목 결과가 섞이지 않게 한다.
- backtest 결과는 선택 종목의 가격 series와 체결 내역을 반환한다.
- 가격 차트는 BUY/SELL을 색뿐 아니라 서로 다른 도형, 텍스트 legend와 정확한 표로 구분한다.
- 360px, 390px, 768px, 1440px에서 검색→선택→전략 확인→실행→마커 확인이 동작한다.

### Tech stack and commands

- 기존 npm + Node.js 20.9 이상 + Next.js 16.3.2 + React 19 + TypeScript + Zod를 유지한다.
- 새 production dependency나 외부 network service를 추가하지 않는다.
- focused tests: `npm run test:unit -- instruments strategy backtest`,
  `npm run test:integration`
- full gates: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:e2e`, `npm run build`
- runtime: `npm run dev` 또는 build 후 `npm run start`

### Project structure and code style

- `src/domain/instruments.ts`: 안정적인 종목 식별자, catalog metadata와 순수 검색 함수
- `src/fixtures/markets.ts`: instrument별 versioned candle fixture
- `src/domain/strategy.ts`, `interpret.ts`, `backtest.ts`: 선택 종목 계약과 실행
- `src/components/`: 검색·선택 UI와 접근 가능한 가격/체결 차트
- `tests/`, `e2e/`: domain, route, 전체 사용자 흐름 검증

기존 named export, strict Zod object, framework와 독립적인 순수 domain function, class 기반
global CSS 관례를 유지한다. 한 번만 쓰는 범용 abstraction이나 chart dependency를 만들지
않는다.

### Testing strategy

- unit: 검색 normalize/빈 결과/시장 필터, 시장-종목 불일치 거부, 선택 종목별 결정론적 실행,
  price series와 trade fill 일치
- integration: parse/backtest route가 `instrumentId`를 유지하고 unknown/mismatch 입력을 거부
- E2E: 티커 검색, 종목 선택, 전략 실행, BUY/SELL marker와 표, no-result 복구, axe 및 overflow
- runtime: console/network 오류, 키보드 focus order, 네 viewport와 production smoke

### Boundaries

- Always: synthetic/source/version 경고, 시장별 calendar/timezone/currency 분리, 다음 세션 시가
  체결, strict runtime validation을 유지한다.
- Ask first: 실제 데이터 provider, 전체 종목 universe, DB, external LLM 또는 새 dependency 도입.
- Never: 실제 주문, 사용자/모델 코드 실행, 실제 가격으로 오인되는 표시, 종목 변경 뒤 오래된
  결과 유지.

## Current implementation state

- `src/fixtures/markets.ts`가 KOSPI/NASDAQ 각 두 종목의 versioned synthetic candle을
  제공하고 stable fixture id로 조회한다.
- `src/domain/strategy.ts`가 `instrumentId`를 필수로 검증하고 market mismatch를 거부한다.
- 이름·티커 검색과 명시적 선택이 빠른 조립과 문장 입력보다 먼저 제공된다.
- 결과는 선택 종목의 price series, BUY/SELL SVG marker와 동일 정보의 표를 제공한다.
- 종목이나 조건 변경은 이전 확인/결과를 폐기하고, 실행 중 입력을 잠가 오래된 응답이
  다른 선택과 섞이지 않게 한다.

## Scope

- 네 개의 작은 KOSPI/NASDAQ synthetic instrument catalog와 검색/선택 UI
- Strategy의 stable `instrumentId`와 market consistency validation
- 선택 종목별 fixture backtest, price series, BUY/SELL chart와 table alternative
- unit/integration/E2E, 접근성·반응형·runtime 검증 및 상태 문서 갱신

## Non-goals

- 외부 검색 API, 실시간/실제 가격, provider 선택, 전체 상장 종목과 delisting 처리
- 다종목 portfolio, cross-market 합산, 환율 계산 또는 종목 비교
- 전략 저장, 사용자 계정, scheduler, broker, paper/live order
- 종목 상세 페이지, candlestick/zoom/pan 또는 chart library

## Milestones

### 1. Define and validate instrument contract

- stable `instrumentId`와 display/search metadata를 정의하고 market mismatch를 거부한다.
- 네 종목 fixture를 instrument id로 조회하고 검색 함수의 경계값을 테스트한다.

Acceptance criteria:

- 빈/대소문자/한글·영문/티커 검색과 no-result가 결정론적으로 동작한다.
- 알려지지 않은 id와 시장 불일치 전략은 backtest 전에 거부된다.
- 기존 시장별 timezone, currency, calendar가 instrument fixture에도 유지된다.

### 2. Carry selection through strategy and backtest

- 빠른 조립과 parser route가 선택 종목을 version 1 Strategy에 포함한다.
- backtest가 해당 fixture를 실행하고 price series와 같은 symbol의 trades를 반환한다.

Acceptance criteria:

- UI에서 확인한 종목 id가 parse 응답, backtest 요청과 결과에서 바뀌지 않는다.
- 다른 종목 선택은 해당 종목의 metadata/candles/result를 사용한다.
- 같은 strategy와 fixture는 같은 결과를 반환한다.

### 3. Deliver search and trade-marker UI

- 전략 입력 전에 종목 검색/선택을 제공하고 종목 변경 시 이전 출력을 reset한다.
- 결과 첫 chart 영역에 종가와 BUY/SELL marker, legend와 table alternative를 추가한다.

Acceptance criteria:

- 키보드와 터치로 검색 결과를 선택할 수 있고 결과 없음에서 복구할 수 있다.
- chart marker는 체결 날짜/가격과 일치하고 BUY/SELL을 도형·문자·색으로 구분한다.
- exact dates/prices를 읽을 수 있는 table이 chart와 함께 존재한다.

### 4. Verify and document

- 모든 품질 게이트와 실제 runtime, 네 viewport, keyboard/axe/console/network를 확인한다.
- Product, Architecture, Quality Gates, DESIGN, README, WORKLOG와 이 계획을 실제 상태로 갱신한다.

Acceptance criteria:

- 관련 automated test, format, lint, typecheck, build가 통과한다.
- 360/390/768/1440에서 overflow 없이 전체 흐름과 접근성 검사가 통과한다.
- 문서가 synthetic catalog와 여전히 미결정인 실제 provider/universe를 구분한다.

## Verification

2026-08-22 최종 작업 트리에서 아래 결과를 확인했다.

- `npm run format:check`, `npm run lint`, `npm run typecheck` — passed
- `npm run test:unit` — 29 passed; `npm run test:integration` — 9 passed
- `npm run test` — 38 passed
- `npm run test:e2e` — 16 passed at 360/390/768/1440; tested states axe 0
- `npm run build` — passed
- production server에서 검색→선택→실행 smoke, console/network, keyboard와 반응형 화면 확인
  (1440px resource 10개/약 159KiB, lab LCP 약 52ms, CLS 약 0.017, document overflow 없음)
- `git diff --check` — passed

## Rollback and recovery

- 변경은 catalog/contract, 실행, UI, 문서 순서의 작은 단계로 유지한다.
- 계산 오류가 발견되면 instrument 선택 결과를 실행하지 않고 기존 paper-only 경계를 유지한다.
- 영속 데이터나 외부 시스템이 없어 migration/remote rollback은 없다. feature 파일과 호출부를
  함께 되돌리면 기존 시장별 단일 fixture 흐름으로 복구할 수 있다.
- local server를 검증을 위해 재시작한 경우 마지막에는 동작 가능한 production 또는 dev
  process 상태와 포트를 명시한다.

## Progress

- [x] 2026-08-22: 저장소, Next.js 16.3.2 local docs, 기존 tests/UI/domain/fixture 확인
- [x] 2026-08-22: baseline format, lint, typecheck, Vitest 27, Playwright 12 통과
- [x] 2026-08-22: Milestone 1 — instrument contract and fixtures
- [x] 2026-08-22: Milestone 2 — strategy/backtest propagation
- [x] 2026-08-22: Milestone 3 — accessible search and trade chart UI
- [x] 2026-08-22: Milestone 4 — full verification, review and documentation

## Discoveries and remaining risks

- 현재 `market`은 실제 index가 아니라 시장별 sample instrument 선택 역할을 한다.
- 실제 종목명을 사용해도 candle은 합성 데이터이므로 모든 선택·결과 가까이에 synthetic 표시가
  필요하다.
- market과 instrument를 모두 계약에 두면 감사 가능성은 높지만 불일치 위험이 생긴다.
  schema refinement와 route/backtest 재검증으로 fail-closed 처리한다.
- SVG marker가 모바일에서 작아질 수 있어 chart와 동일한 정보를 표로 제공하고 44px 선택
  target을 유지한다.
- 실제 provider가 정해질 때 symbol 변경이나 delisting에 흔들리지 않도록 외부 symbol이 아닌
  `MARKET:SYMBOL` 형식의 stable fixture id를 사용한다. provider 영속 id는 후속 ADR 대상이다.

## Decision log

- 2026-08-22: 외부 provider 없이 bundled synthetic instrument catalog를 사용한다. 사용자
  가치와 계약을 먼저 검증하면서 미결정 공급자를 고정하지 않기 위해서다.
- 2026-08-22: Strategy version은 1을 유지하며 `instrumentId`를 필수 additive field로 넣는다.
  저장된 전략이 아직 없고 현재 로컬 walking slice뿐이므로 migration 대상이 없다.
- 2026-08-22: 가격/체결 chart는 기존 SVG 접근법을 확장하고 새 production dependency를
  추가하지 않는다.
- 2026-08-22: 실제 가격처럼 보이지 않도록 실제 상장 symbol/name 옆에 `SYNTHETIC`을 항상
  표시하고 데이터 출처/버전을 결과에 유지한다.

## Related decisions

- `docs/decisions/ADR-0001-single-nextjs-application.md`
- `docs/decisions/ADR-0002-strategy-and-backtest-contract.md`
- `docs/decisions/ADR-0003-instrument-selection-contract.md`

## Outcome

사용자는 첫 화면에서 Apple, NVIDIA, 삼성전자, SK하이닉스 synthetic fixture를
이름·티커로 검색하고 하나를 선택한 뒤 전략을 조립하거나 지원 문장으로 입력할 수 있다.
선택 종목은 strict Strategy 계약과 backtest 결과까지 유지되며 시장 불일치는 실행 전에
거부된다. 결과의 종가 차트와 BUY/SELL marker는 같은 체결 정보의 표 대안을 제공한다.

실제 종목 데이터, 전체 universe, provider id, 종목 변경·상장폐지 정책과 다종목
portfolio는 여전히 후속 결정이다.
