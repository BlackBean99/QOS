# QOS live market workspace capability map

Status: Approved for implementation — 2026-08-23

## Outcome

고정 synthetic 종목 화면을 실제 TOSS 국내·미국 종목 검색과 시세 기반의 로컬 전략
워크스페이스로 교체한다. 실제 주문은 만들지 않으며 백테스트와 완성 봉 기준 paper signal
감시만 지원한다.

## Capabilities and dependencies

```text
strategy-library ----+
                     +--> signal-monitoring --> telegram-delivery
market-data-stream --+          |
        |                        |
        +--> interactive-chart <-+
                     |
                     +--> application-flow
strategy-library ----+
```

| Capability           | Responsibility                                      | Depends on                          |
| -------------------- | --------------------------------------------------- | ----------------------------------- |
| `strategy-library`   | 전략·차트 설정의 versioned JSON CRUD, import/export | Strategy schemas                    |
| `market-data-stream` | TOSS 인증, 종목 검색, 과거 캔들, 실시간 체결 정규화 | TOSS REST/WebSocket                 |
| `signal-monitoring`  | 완성 봉 생성, 전략 평가, 신호 중복 방지, 상태 복구  | Strategy library, market data       |
| `telegram-delivery`  | 로컬 봇 연결, 안전한 채팅 선택, BUY/SELL 알림       | Signal monitoring, Telegram Bot API |
| `interactive-chart`  | Upbit 계열 캔들, 지표, drawing, 신호, 설정 복원     | Market data, strategy library       |
| `application-flow`   | 검색→차트→저장→백테스트/감시의 접근 가능한 통합 UI  | All capabilities                    |

## 2026-08-25 persistence amendment

```text
strategy-persistence -> backtest-history -> strategy-management
          |                       |                   |
          +-----------------------+-------------------+-> application-flow
```

| Capability             | Responsibility                                              | Depends on                  |
| ---------------------- | ----------------------------------------------------------- | --------------------------- |
| `strategy-persistence` | Supabase-backed strategy JSON CRUD, revision, import/export | Strategy schemas, Supabase  |
| `backtest-history`     | Saved-strategy run snapshots, summaries, full results       | Strategy persistence        |
| `strategy-management`  | Stored strategy execution and history lifecycle service     | Both persistence capability |

Build order: `strategy-persistence` → `backtest-history` → `strategy-management` →
`application-flow`.

## Cross-cutting constraints

- 브라우저 번들·로그·JSON export에 TOSS/Telegram secret을 포함하지 않는다.
- TOSS REST에는 timeout, 제한된 retry/backoff와 rate-limit 오류를 적용한다.
- 한국 시장은 `Asia/Seoul`·KRW, 미국 시장은 `America/New_York`·USD로 명시한다.
- TOSS WebSocket 체결은 lossy이므로 누적 거래량을 프레임 합계로 재구성하지 않는다.
- BUY/SELL은 색뿐 아니라 글자·도형과 동일 정보 표로 구분한다.
- 실제 주문, 계좌 구독, 공개 배포와 다중 사용자는 범위 밖이다.

## 2026-09-01 Strategy engine v3 amendment

Status: Approved for full implementation by the user — 2026-09-01

이 amendment는 기존 v1/v2 호환 계층을 보존하면서 신규 작성·백테스트·비교·paper monitor의
기본 계약을 임의 길이 Rule Chain 기반 Strategy v3로 전환한다. 프리셋 이름으로 별도 엔진을
선택하지 않으며 모든 Entry·Filter preset은 같은 typed condition tree를 생성한다.

| Capability                     | Responsibility                                                                 | Depends on                                |
| ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `strategy-contract-v3`         | 중첩 Rule Chain, operand, exit/risk/execution, parameter metadata의 strict DSL | Existing instrument contract              |
| `market-timeframe-runtime`     | session/timezone, resample, 완료 HTF projection, 명시적 VWAP variant           | `market-data-stream`                      |
| `indicator-runtime-v3`         | 전략용 pure indicator registry, warm-up, cached multi-series output            | `strategy-contract-v3`, timeframe runtime |
| `rule-evaluator-v3`            | AND/OR/NOT·비교/cross/break/touch/between 평가와 Decision Trace                | contract, indicator runtime               |
| `position-execution-v3`        | position state, exit priority, partial exit, sizing, costs와 fill policy       | contract, rule evaluator                  |
| `backtest-analytics-v3`        | deterministic simulation, trade ledger, metrics, comparison, golden result     | position execution, timeframe runtime     |
| `strategy-catalog-compiler-v3` | 모든 명시 Entry/Exit/Filter preset과 자연어→검증된 v3 DSL                      | contract, rule evaluator                  |
| `strategy-persistence-v3`      | v1/v2/v3 JSON 호환, immutable run snapshot과 Supabase migration                | contract, backtest analytics              |
| `strategy-builder-v3`          | 검색 가능한 catalog, 무제한 rule chain, progressive disclosure UI              | catalog/compiler, persistence             |
| `research-explainability-v3`   | 비교표, 선택 지표 chart, trade detail과 entry/exit trace                       | builder, backtest analytics               |
| `paper-monitor-v3`             | 완료 봉 v3 signal, idempotent paper alert와 position-state recovery            | execution, persistence, market runtime    |

Build order: `strategy-contract-v3` → `market-timeframe-runtime` +
`indicator-runtime-v3` → `rule-evaluator-v3` → `position-execution-v3` →
`backtest-analytics-v3` → catalog/compiler + persistence → builder + explainability →
`paper-monitor-v3`.

### V3 cross-cutting constraints

- Entry와 Filter condition 수는 preset 개수와 무관하다. UI는 최소 64개 leaf rule과 8단계 중첩을
  검증 가능한 한도로 제공하고 schema 밖 입력을 실행하지 않는다.
- 프리셋은 editable Strategy v3 JSON factory다. 이름 기반 실행 분기나 임의 코드는 없다.
- indicator, timeframe, VWAP variant와 output series는 magic string을 흩뿌리지 않고 strict
  discriminated union과 registry key로 관리한다.
- 신규 실행은 실제 주문을 만들지 않는다. 배포되는 서버도 backtest와 paper signal만 제공한다.
