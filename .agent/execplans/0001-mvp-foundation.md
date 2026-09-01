# ExecPlan 0001: MVP foundation and backtest walking skeleton

## Status

Complete — 2026-08-22. The first walking slice is implemented, independently reviewed,
built and running locally.

## Purpose

QOS를 경량 단일 웹 애플리케이션으로 시작하고, 첫 사용자 가치인 “전략 조건을
조립하고 검증 가능한 일봉 백테스트 결과를 확인한다”를 가장 작은 수직 슬라이스로
제공한다. 자연어는 같은 구조를 만드는 보조 입력이며, 결과에는 데이터 범위,
유니버스, 비용 및 편향 관련 가정을 노출해 숫자를 재현하고 검토할 수 있어야 한다.

## Current state

- 시작 시 저장소에는 제품 코드, 패키지 매니저, 애플리케이션 명령과 테스트가 없었다.
- 현재는 실행 가능한 Next.js 앱, route handler, domain/fixture module, Vitest와
  Playwright 검증 및 문서화된 품질 명령이 있다.
- 첫 슬라이스는 npm + Node.js 20.9 이상 + 단일 Next.js/TypeScript 앱으로 결정했다.
  로컬 저장 방식, LLM과 실제 시장 데이터 공급자는 미결정이다.
- 외부 API, 사용자 계정, 저장된 전략과 주문 기능은 구현되지 않았다.
- MVP는 로컬 중심 단일 사용자이며 회원가입·인증·공개 배포가 필요하지 않다.
- 첫 대상은 KOSPI와 NASDAQ이다. 실제 종목 유니버스와 데이터 공급자는 미결정이다.

## Scope

- 단일 애플리케이션 기술 스택과 로컬 실행 경계를 결정하고 ADR로 기록한다.
- 데스크톱·모바일에서 실행되는 최소 애플리케이션과 품질 명령을 마련한다.
- 명시적이고 제한된 전략 입력을 안전한 중간 표현으로 변환·검증한다.
- KOSPI와 NASDAQ의 작은 고정 일봉 fixture로 결정론적 paper backtest를 실행한다.
- 기간, 유니버스, 시간대, 수수료, 슬리피지와 주요 위험지표를 결과에 표시한다.
- 전략 작성부터 결과 탐색까지 한 개의 접근 가능한 수직 흐름을 검증한다.

## Non-goals

- 실제 주문, 브로커 연결, 실시간 시세, 초저지연 처리
- 모든 시장·자산과 모든 자연어 전략 문법 지원
- 마이크로서비스, Kafka, 별도 데이터 플랫폼 또는 분산 작업 시스템
- 모델이 생성한 임의 코드의 실행
- 회원가입, 인증, 다중 사용자, 과금과 공개 시장 배포
- 실데이터 공급자 연동과 전체 KOSPI/NASDAQ 종목 지원

## Milestones

### 0. Confirm product boundaries

- 확정된 첫 흐름, 사용자/배포 모델과 시장 범위를 기록한다.
- 데이터·보안·배포 경계를 `docs/PRODUCT.md`와 이 계획에 반영한다.

Acceptance criteria:

- 첫 흐름은 종목 선택→전략 조립→구조화 확인→일봉 paper backtest→결과다. 자연어는
  지원 형식 안에서 같은 구조를 만드는 보조 경로다.
- 단일 사용자·무인증·비공개 로컬 사용과 KOSPI/NASDAQ 범위가 기록된다.
- 첫 fixture 슬라이스는 외부 공급자 자격증명 없이 실행 가능하고, 실데이터 공급자는
  별도 결정으로 남는다.

### 1. Decide the smallest platform

- 단일 애플리케이션 후보를 로컬 실행, 타입 안정성, 서버 비밀 분리, 유지보수 단순성,
  테스트/브라우저 지원 기준으로 비교한다.
- 앱 프레임워크, 패키지 매니저, 런타임과 초기 로컬 저장소 선택을 ADR로 기록한다.
- 선택된 도구의 정확한 dev, lint, format, typecheck, test, build 명령을 문서화한다.

Acceptance criteria:

- 결정과 기각 대안, 결과·위험 및 재검토 조건이 ADR에 있다.
- 새 개발자가 README만 따라 로컬 production build까지 재현할 수 있다.

### 2. Build a tested application shell

- 모바일 우선 내비게이션, 오류 경계, loading/empty/error 상태와 디자인 토큰을 만든다.
- CI와 같은 로컬 품질 명령을 추가하고 비밀/생성물 제외 규칙을 스택에 맞게 보완한다.
- 390px와 1440px에서 앱 셸을 브라우저로 확인한다.

Acceptance criteria:

- 앱이 한 명령으로 로컬 실행되고 production build가 성공한다.
- 키보드 탐색, visible focus, reduced motion과 최소 AA 대비를 검증한다.
- 초기 성능 기준값과 번들 예산을 `docs/QUALITY_GATES.md`에 기록한다.

### 3. Define strategy and backtest contracts

- 허용되는 전략 중간 표현, validation 오류, 버전과 실행 제한을 명시한다.
- 가격 데이터, 시장 달력, 비용 모델, 체결 시점과 결과 지표 계약을 정의한다.
- KOSPI와 NASDAQ의 달력, 시간대, 통화, 휴장일과 교차 시장 환율 가정을 분리한다.
- 미래정보 참조, 결측치, 기업행위, 생존편향을 어떻게 탐지 또는 노출하는지 정한다.
- 데이터 모델과 API 계약을 ADR로 기록한다.

Acceptance criteria:

- 지원/거부 예시와 오류가 문서 및 unit test로 고정된다.
- 동일 입력과 fixture는 동일 결과를 생성한다.
- 임의 모델 출력이나 사용자 코드를 실행하지 않는 경계가 테스트된다.

### 4. Deliver the paper-backtest vertical slice

- 종목 선택과 전략 조립, 구조화된 전략 확인, 실행, 결과 대시보드를 한 흐름으로
  연결하고 자연어 입력은 보조 경로로 제공한다.
- fixture 데이터로 수익률, 최대 낙폭과 비용 반영 결과를 계산한다.
- KOSPI와 NASDAQ의 대표 fixture를 각 시장 규칙에 따라 독립 실행한다.
- 입력 중복 제출을 막고 실패를 복구 가능한 UI 상태로 표시한다.

Acceptance criteria:

- 대표 전략 하나가 작성부터 결과까지 end-to-end로 동작한다.
- 결과에 기간, 유니버스, 시간대, 비용 모델, 데이터 출처와 한계가 보인다.
- unit, integration, e2e, 접근성 및 모바일/데스크톱 visual 검증이 통과한다.

### 5. Review and hand off

- 보안, Quant 정확성, UX, 접근성, 성능과 운영 실패 모드를 자체 리뷰한다.
- 문서, ADR, WORKLOG와 이 계획을 실제 상태로 갱신한다.
- 구현과 별개로 남은 live data 및 trading 위험을 명시한다.

## Verification

아래 package script와 검증 결과를 2026-08-22 최종 작업 트리에서 확인했다.

- format: `npm run format:check`
- lint: `npm run lint`
- typecheck: `npm run typecheck`
- unit/integration: `npm run test` — 38 passed
- e2e/accessibility: `npm run test:e2e` — 16 passed at 360/390/768/1440; tested
  states axe 0
- production build: `npm run build` — passed
- production run: `npm run start` — `http://127.0.0.1:3000`에서 running/smoke passed
- browser: keyboard focus, no document overflow, console/network error 0
- performance: production local lab LCP 약 48ms, CLS 0, resource 8개/약 150KiB;
  INP와 실제 사용자 p75는 미측정
- repository docs: `git diff --check` — passed

## Rollback and recovery

- 각 milestone은 독립적인 논리 변경으로 유지한다.
- 애플리케이션 골격 선택이 실패하면 사용자 변경을 보존한 채 해당 골격 변경만 명시적
  경로로 되돌리고, ADR 상태를 `Superseded`로 바꾸는 새 ADR을 작성한다.
- 스키마 변경에는 적용 전에 역방향 또는 forward-fix 절차와 데이터 백업/복원 검증을
  추가한다.
- backtest 결과가 잘못된 경우 실행을 실패 상태로 표시하고 결과 게시를 중지한다.
- live trading은 이 계획에 없으므로 브로커나 실제 계좌에 영향을 주는 롤백은 없어야 한다.

## Progress

- [x] 2026-08-22: 저장소 현황과 기존 하네스 부재 확인
- [x] 2026-08-22: 공식 Codex 문서와 최신 디자인 후보 조사
- [x] 2026-08-22: 하네스 및 첫 ExecPlan 초안 작성
- [x] 2026-08-22: Milestone 0 — 첫 흐름, 단일 사용자/무인증/비공개 범위와
      KOSPI/NASDAQ 시작 범위 반영
- [x] 2026-08-22: 구현 요청 확인, PRD를 Phase 1A walking slice와 roadmap으로 분리
- [x] 2026-08-22: Milestone 1 — npm/Next.js/TypeScript 단일 앱과 contract 결정을
      ADR-0001/0002로 기록
- [x] 2026-08-22: Milestone 2 — 테스트된 application shell
- [x] 2026-08-22: Milestone 3 — strict strategy/backtest contract와 regression tests
- [x] 2026-08-22: Milestone 4 — paper-backtest vertical slice와 responsive results UI
- [x] 2026-08-22: Milestone 5 — independent review, full gates, production smoke와 문서 동기화
- [x] 2026-08-22: UX amendment — 설명형 hero를 선택형 전략 조립기와 live structure로
      교체하고 자연어 오류에 클릭 가능한 완성 예시를 추가

## Discoveries and risks

- 현재 README의 제품명 외에는 기존 구현 제약이 없어 사용자 설명과 저장소 충돌은 없다.
- 인증과 공개 배포가 제외되어 첫 애플리케이션의 보안·운영 범위가 작아졌다.
- 데이터 공급자와 구체 종목 유니버스는 미정이지만 첫 fixture 슬라이스를 막지 않는다.
- LLM 자연어를 실행 코드로 취급하면 보안·재현성 위험이 크므로 제한된 버전형 중간
  표현을 우선 검토해야 한다.
- 여러 시장을 한 번에 지원하면 달력, 시간대, 통화, 기업행위와 데이터 라이선스가 첫
  슬라이스를 크게 확장한다.
- 독립 리뷰에서 부분 regex의 반대 의미 해석, nested unknown field strip, exit audit
  누락과 ledger 반올림 불일치를 발견했다. whole-string template, strict schema,
  exit reason과 exact ledger regression으로 수정했고 재검토에서 required code finding이
  없음을 확인했다.

## Decision log

- 2026-08-22: 첫 실행에서는 제품 코드를 만들지 않고 하네스와 계획만 작성했다.
  저장소가 초기 상태이고 제품 경계를 먼저 확인해야 하기 때문이다.
- 2026-08-22: ADR은 아직 만들지 않았다. 대안과 소유자 제약을 확인하지 않은 기술
  선택을 확정 사실처럼 남기지 않기 위해서다.
- 2026-08-22: 첫 후보 흐름은 고정 일봉 fixture를 사용하는 paper backtest다. 외부
  공급자와 실거래 위험 없이 전략 계약과 계산 정확성을 먼저 검증할 수 있기 때문이다.
- 2026-08-22: 최초에는 자연어 전략→구조화 확인 흐름을 채택했으나 UX amendment로
  종목 선택→선택형 조립→구조 확인을 기본 경로로 대체했다. 자연어는 지원 형식을 아는
  사용자를 위한 보조 경로다.
- 2026-08-22: MVP는 로컬 중심 단일 사용자이며 회원가입·인증·공개 배포를 제외한다.
- 2026-08-22: 첫 시장 범위는 KOSPI와 NASDAQ이다. 외부 공급자가 정해질 때까지 작은
  결정론적 fixture로 시작하고 시장별 달력·시간대·통화 규칙을 분리한다.
- 2026-08-22: 사용자 구현 요청에 따라 `docs/decisions/ADR-0001-single-nextjs-application.md`와
  `ADR-0002-strategy-and-backtest-contract.md`를 채택했다. 첫 슬라이스는 별도 FastAPI,
  DB, scheduler와 외부 LLM 없이 단일 Next.js process로 구현한다.

## Confirmed product decisions

- First flow: instrument selection → visual strategy builder → structured confirmation → daily
  paper backtest → results. Bounded natural language is an auxiliary path.
- User model: local-first single user; no signup or authentication.
- Distribution: no public or commercial deployment target for MVP.
- Markets: KOSPI and NASDAQ, initially represented by deterministic fixtures.

## Deferred decisions

- Exact instrument universe and benchmark for each market
- Historical market-data provider, license, retention and adjustment policy
- LLM provider and the supported strategy representation

## Outcome

Phase 1A walking slice가 완료되었다. 사용자는 첫 화면의 선택형 조립기에서
KOSPI/NASDAQ, 돌파, 거래량 배수와 trailing stop을 구성하거나 같은 조건을 지원된
자연어 template로 입력하고 version 1 구조를 확인한 뒤, synthetic 일봉 fixture
backtest의 성과·위험·거래 진입/청산 이유·시장/비용/편향 가정을 모바일과 데스크톱에서
검토할 수 있다. 자연어 해석 실패 시 완성 예시를 클릭하거나 조립기로 복귀할 수 있다.

코드는 사용자 입력을 실행하지 않으며 부정·미만·OR·지원 밖 청산과 unknown schema
field를 거부한다. 신호는 session close, 체결은 다음 fixture session open이며 exact
ledger와 결정론적 지표를 regression test로 고정했다. 실제 데이터, LLM, 저장, 지속
paper trading, broker와 live trading은 이 계획의 완료 범위가 아니다.
