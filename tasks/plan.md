# Completed Plan: Strategy recommendation and efficient tracking

1. timeframe별 default/custom backtest 기간 계약을 API와 engine에 연결한다.
2. 전체 Entry 42개를 동일 데이터·비용으로 평가하는 deterministic 추천 API를 만든다.
3. monitor의 dataset/요청을 종목·timeframe별 공유하고 session cadence와 관측 지표를 적용한다.
4. 추천 적용·저장+tracking ON UI와 local server+worker lifecycle을 연결한다.
5. 전체 gate/browser/runtime/Git push와 local release를 완료한다.

상세 명세는 `SPEC-strategy-recommendation-tracking.md`, 진행과 rollback은
`.agent/execplans/0008-strategy-recommendation-tracking.md`가 기준이다.

---

# Completed Plan: Quant Strategy Engine v3

1. Strategy v3 Rule Chain·indicator/timeframe·execution 계약을 strict schema와 ADR로 고정한다.
2. 모든 Entry 42·Exit 20·Filter 8을 같은 evaluator에서 실행 가능한 preset factory로 구현한다.
3. position/risk/partial exit/비용/intrabar와 전체 metrics·trace·comparison을 구현한다.
4. compiler/API/persistence/migration/monitor와 새 Strategy Builder를 연결한다.
5. 전체 gates·browser·DB·Git·server 배포와 rollback smoke를 완료한다.

상세 acceptance criteria와 진행은 `.agent/execplans/0007-quant-strategy-engine-v3.md`, 실행 계약은
`SPEC-strategy-engine-v3.md`와 `docs/decisions/ADR-0009-strategy-v3-rule-chain-and-execution.md`가
기준이다. 기존 미완료 TOSS provider smoke task는 삭제하거나 완료 처리하지 않는다.

---

# Completed Plan: Workspace UX audit and redesign

1. 실제 TOSS/synthetic 출처와 시장 전환 상태 오류를 회귀 테스트로 고정하고 수정한다.
2. Telegram/monitor heartbeat·오류·복구 행동을 관측 가능한 상태 panel로 바꾼다.
3. 검색 전 recovery와 종목 선택 후 authoring을 분리해 핵심 흐름을 다시 배치한다.
4. warm paper/ink/teal research desk 시각 체계를 360/390/768/1440에 적용한다.
5. 전체 gate/build/production browser/접근성/성능과 문서를 검증한다.

상세 acceptance criteria, 진행, rollback은
`.agent/execplans/0006-workspace-ux-redesign.md`가 기준이다.

---

# Completed Plan: Supabase strategy management final review

1. Supabase migration, server-only credential and repository contracts를 고정한다.
2. 전략 CRUD/import/export adapter와 optimistic revision 회귀를 구현한다.
3. 저장 전략 실행→history 저장→summary/detail/delete API를 구현한다.
4. 전략 library에 history loading/empty/detail/delete UI를 연결한다.
5. remote smoke, 전체 gate/build/production browser와 문서를 검증한다.

상세 진행과 rollback은 `.agent/execplans/0005-supabase-strategy-management.md`가 기준이다.

---

# Completed Plan: Indicator manager and drawing catalog

1. 105종 indicator catalog와 저장 가능한 instance 설정 계약을 실패 unit test로 고정한다.
2. legacy chart 설정을 손실 없이 instance 목록으로 정규화하고 source/timeframe 계산 adapter를 만든다.
3. 검색 가능한 추가 dialog와 instance별 설정·삭제 dialog를 구현한다.
4. KLineChart 전체 built-in drawing에 QOS custom drawing을 합치고 icon toolbar로 노출한다.
5. 실제 browser에서 추가→설정→중복 추가→삭제→저장 복원을 검증하고 전체 gate/build/runtime을 실행한다.

---

# Completed Plan: Interactive chart parity correction

> 완료 이력이다. 상세 계약은 `SPEC-interactive-chart.md`, 진행 기록은
> `.agent/execplans/0004-live-market-strategy-workspace.md`가 기준이다.

1. KLineChart v10 loader 방향 오류와 반복 page를 실패 테스트로 고정한다.
2. 과거 cursor/no-progress/중복 제거를 순수 pagination model로 분리하고 chart loader에 연결한다.
3. VWAP·Ichimoku·Stochastic RSI를 KLineChart custom indicator로 등록한다.
4. drawing은 실제 overlay count/points와 저장 JSON을 browser test로 검증한다.
5. Upbit 공개 chart의 핵심 도구와 동작을 비교하고 전체 gate/production runtime을 재검증한다.

---

# Implementation Plan: MVP daily backtest walking slice

> 현재 active plan은 아래 "Live market strategy workspace"이며 기존 section은 완료 이력이다.

## Implementation Plan: Live market strategy workspace

### Overview

실제 TOSS 종목/시세, KLineChart, server JSON 전략 라이브러리와 별도 Telegram signal monitor를
하나의 로컬 single-user 흐름으로 연결한다. 상세 상태와 recovery는
`.agent/execplans/0004-live-market-strategy-workspace.md`가 기준이다.

### Dependency order

```text
dynamic instrument + TOSS boundary
  -> JSON strategy/chart store
    -> real-candle backtest + interactive chart
      -> completed-bar monitor + Telegram
        -> integrated browser/runtime verification
```

### Architecture decisions

- TOSS는 production market-data adapter이며 provider 실패를 synthetic 데이터로 숨기지 않는다.
- KLineChart는 client-only chunk이고 부족한 drawing만 custom overlay로 구현한다.
- 전략 JSON과 monitor/Telegram runtime state는 `.qos/data`의 서로 다른 versioned 파일이다.
- 실제 주문과 계좌 channel은 사용하지 않는다.

### Task list

작업별 acceptance criteria는 `tasks/todo.md`의 "Live market strategy workspace"에서 추적한다.

## Overview

`docs/PRD.md`의 장기 제품 비전 중 첫 배포 단위를 KOSPI/NASDAQ synthetic 종목 선택 →
선택형 전략 조립 → 구조 확인 → historical paper backtest → 결과 흐름으로 구현한다.
제한된 자연어는 같은 구조를 만드는 보조 경로다. 상세 진행과 결정은
`.agent/execplans/0001-mvp-foundation.md`와 `docs/decisions/`가 기준이다.

## Architecture decisions

- npm과 단일 Next.js/TypeScript 애플리케이션을 사용한다. 첫 슬라이스에는 별도
  FastAPI, DB, scheduler와 외부 공급자를 두지 않는다.
- 자연어는 임의 코드나 자유 형식 LLM 결과가 아니라 허용 목록 기반 parser와
  versioned schema로 변환한다.
- 신호는 일봉 종가로 평가하고 다음 fixture 세션 시가에 체결해 미래정보 사용을
  방지한다.
- 차트는 production chart dependency 없이 접근 가능한 SVG와 표 형태의 요약을 함께
  제공한다.

## Task list

작업별 acceptance criteria와 검증 명령은 `tasks/todo.md`에서 추적한다.

1. 범위·스택·계약 문서화
2. 전략 계약과 제한된 해석기
3. 시장 fixture와 결정론적 backtest
4. API 및 반응형 사용자 흐름
5. 전체 품질 게이트와 production 실행 검증

## Dependency order

```text
scope/ADR
  -> strategy contract/parser
    -> market fixtures/backtest engine
      -> route handlers
        -> responsive UI
          -> browser and production verification
```

## Risks and mitigations

| Risk                            | Impact | Mitigation                                                             |
| ------------------------------- | ------ | ---------------------------------------------------------------------- |
| 자연어 지원 범위를 과장         | High   | 지원 예문과 거부 사유를 UI에 표시하고 외부 LLM으로 표현하지 않는다.    |
| look-ahead bias                 | High   | 종가 신호를 다음 세션 시가에만 체결하고 unit test로 고정한다.          |
| fixture 결과를 실제 성과로 오인 | High   | source/version/synthetic 경고와 시장 가정을 결과에 상시 표시한다.      |
| 광범위 PRD가 첫 범위로 오인     | Medium | 현재 delivery scope와 roadmap을 PRD 상단에서 분리한다.                 |
| 비 LTS 로컬 Node                | Medium | 지원 범위를 Node 20.9+로 명시하고 현재 Node 25에서도 build를 검증한다. |

## Open questions deferred

- 실제 시장 데이터 공급자, 라이선스와 조정주가 정책
- 외부 LLM 공급자와 모델 출력 계약
- 저장소/DB, 사용자 인증과 공개 배포
- scheduler 기반 지속 paper trading과 모든 live trading 기능

---

# Implementation Plan: Instrument selection and trade chart

## Overview

사용자가 bundled KOSPI/NASDAQ synthetic instrument를 이름·티커로 검색하고 선택한 뒤,
기존 전략을 실행해 종가 chart에서 BUY/SELL 체결 시점을 확인하는 수직 슬라이스를 추가한다.
상세 명세와 진행 기록은 `.agent/execplans/0002-instrument-selection-trade-chart.md`가 기준이다.

## Architecture decisions

- 실제 provider를 고정하지 않고 stable fixture `instrumentId`와 작은 local catalog를 사용한다.
- Strategy v1이 선택 instrument를 명시하고 market mismatch는 strict validation으로 거부한다.
- 기존 SVG 접근을 확장해 가격·체결 chart를 만들고 exact table alternative를 함께 제공한다.
- 새 production dependency, DB, network service 또는 실제 주문은 추가하지 않는다.

## Task list

작업별 acceptance criteria와 검증은 `tasks/todo.md`의 “Instrument selection and trade chart”
섹션에서 추적한다.

1. instrument catalog/search/contract
2. strategy parser와 backtest propagation
3. 검색·선택·trade chart UI
4. 전체 gate/runtime/docs/review

## Dependency order

```text
instrument identity/catalog
  -> Strategy validation and route propagation
    -> instrument fixture backtest and price series
      -> search UI and trade-marker chart
        -> browser, production and documentation verification
```

## Risks and mitigations

| Risk                                  | Impact | Mitigation                                                    |
| ------------------------------------- | ------ | ------------------------------------------------------------- |
| synthetic series를 실제 가격으로 오인 | High   | 선택·결과에 SYNTHETIC, source/version과 한계를 반복 표시한다. |
| market/instrument 불일치              | High   | schema refinement와 route/backtest 양쪽에서 fail closed한다.  |
| chart marker 접근성                   | High   | 도형·문자·색 legend와 exact table alternative를 병용한다.     |
| 모바일 검색/표 overflow               | Medium | 360px부터 검증하고 표만 명시적으로 horizontal scroll한다.     |

## Open questions deferred

- 실제 전체 instrument master, provider id, symbol change와 delisting policy
- 실제/조정 가격, 기업행위, 데이터 license와 retention
- 다종목 portfolio, 기준 통화와 환율 계약

---

# Implementation Plan: Phase 1B indicator research

## Overview

5분봉 VWAP 진입과 여덟 청산 설정을 같은 synthetic series에서 비교하고, LLM이 만든
Strategy v2 후보를 strict validation 뒤 실행하는 candle-first research slice를 추가한다.

## Dependency order

```text
Strategy v2 contract
  -> indicator math + intraday fixture
    -> exit comparison engine
      -> optional LLM compiler
        -> candle/overlay/result UI
          -> browser, review and production verification
```

## Architecture decisions

- 기존 Strategy v1을 유지하고 research 전용 Strategy v2를 additive하게 둔다.
- 같은 exit 종류의 서로 다른 파라미터 비교는 허용하고 정확히 같은 설정만 거부한다.
- 기본 reference는 8-run이고 Strategy v2 후보는 최대 12-run까지 동적으로 표시한다.
- 가격 chart는 OHLC candle이 기본이며 VWAP/EMA/Ichimoku만 가격 축에 겹친다.
- Stochastic RSI는 별도 oscillator panel로 표시한다.
- OpenAI output은 `store:false` strict structured output과 Zod validation을 모두 통과해야 한다.

## Risks and mitigations

| Risk                   | Impact | Mitigation                                                |
| ---------------------- | ------ | --------------------------------------------------------- |
| LLM이 실행 의미를 왜곡 | High   | allowlist schema, semantic validation, confirm-before-run |
| 분봉 look-ahead        | High   | 이전 bar에서 신호 확정, 다음 bar open fill regression     |
| indicator 정의 차이    | High   | formula/seed/warm-up을 spec과 unit fixture로 고정         |
| chart 과밀/접근성      | Medium | overlay toggle, oscillator 분리, table fallback           |
| synthetic 결과 오인    | High   | source/version/warning을 chart와 result 가까이에 표시     |
