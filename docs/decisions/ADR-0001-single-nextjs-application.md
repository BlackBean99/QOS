# ADR-0001: Start with a single Next.js application

## Status

Accepted

## Date

2026-08-22

## Context

첫 제품 흐름은 로컬 단일 사용자가 KOSPI와 NASDAQ의 작은 결정론적 일봉 fixture로
전략을 구조화하고 historical paper backtest 결과를 검토하는 것이다. 인증, 공개 배포,
외부 LLM, 실제 시장 데이터, 지속 실행 scheduler와 주문은 범위 밖이다. 초기 PRD의
Next.js + FastAPI + PostgreSQL 구성은 장기 비전을 모두 한 번에 구현하는 전제였지만,
현재 슬라이스에는 프로세스·계약·운영 복잡성만 추가한다.

## Decision

- npm과 Node.js 20.9 이상에서 동작하는 단일 Next.js App Router/TypeScript 앱으로
  시작한다.
- 브라우저 UI와 route handler의 신뢰 경계를 유지하고, 전략·백테스트 계산은 framework와
  독립적인 순수 TypeScript 모듈로 둔다.
- 첫 슬라이스에는 DB, ORM, Python service, Tailwind, UI kit, query library와 chart
  library를 추가하지 않는다.
- runtime input validation에는 작은 명시적 dependency인 Zod만 사용한다.
- Vitest와 Playwright로 unit/integration/browser 검증을 재현한다.

## Alternatives considered

### Next.js + FastAPI + PostgreSQL

Python quant 생태계와 영속성을 바로 사용할 수 있지만 첫 fixture 흐름에 세 프로세스,
두 언어 계약, migration과 컨테이너 운영을 요구한다. 실제 데이터/계산 규모가 정해지기
전에는 채택하지 않는다.

### Vite SPA + FastAPI

frontend build는 단순하지만 별도 API 서버와 CORS/개발 프로세스가 필요하다. 현재의
서버 비밀 경계와 한 명령 실행 요구에는 단일 Next.js 앱이 더 작다.

### Static client-only application

가장 작지만 향후 LLM/API 비밀을 브라우저에 두지 않는 경계를 처음부터 검증할 수 없다.

## Consequences and risks

- 설치, 개발, 테스트와 production 실행이 한 package에서 재현된다.
- 첫 backtest는 JavaScript 수치 계산이며 pandas 기반 대규모 연구 성능을 보장하지 않는다.
- 영속성이 없으므로 새로고침 뒤 결과 보존과 전략 버전 관리는 후속 범위다.
- framework에서 분리한 domain contract를 유지해야 향후 Python engine으로 이동할 수 있다.

## Revisit when

- 실제 수년치 다종목 데이터에서 TypeScript engine이 측정된 성능 목표를 충족하지 못할 때
- 서버 재시작을 넘는 전략/실행 저장이 제품 acceptance criteria가 될 때
- 외부 데이터 또는 LLM adapter를 도입해 별도 Python 생태계의 이점이 운영비보다 클 때
