# ExecPlan 0007: Quant Strategy Engine v3

## Status

Local MVP release automation in progress — implementation, database and Git push are complete; remote
hosting is intentionally deferred until the MVP boundary changes — 2026-09-01.

## Purpose and observable outcome

사용자가 모든 명시 Entry/Filter/Exit preset을 검색해 선택하고 수십 Rule을 중첩 조합하며 Risk,
Position, Execution을 바꿔 백테스트·비교·Decision Trace를 검토한다. Strategy v3 저장·history와
paper monitor가 같은 실행 의미를 공유하고 production server와 Git remote에 반영된다.

## Current state

- `src/domain/strategy.ts`: v1 일봉 진입 2종과 trailing exit
- `src/domain/advanced-strategy.ts`: v2 5분 rolling VWAP 고정 entry와 flat filter/exit
- `src/domain/advanced-backtest.ts`: next-open 비용 모델과 exit comparison, 부분 청산/Risk 없음
- `src/domain/chart-indicators.ts`: 105 chart indicator catalog와 완료 전일 projection 선행 구현
- `src/domain/stored-strategy.ts`: v1/v2 JSON union
- `supabase/migrations/20260825000100_strategy_management.sql`: history version 1/2 제약
- `src/components/strategy-builder.tsx`, `advanced-research.tsx`: 서로 다른 v1/v2 authoring UI

2026-09-01 baseline은 unit 124와 integration 39가 통과했다.

## Scope

- `SPEC-strategy-engine-v3.md` 전체
- Strategy v3 DSL, indicator/timeframe/rule/position/execution/backtest/metrics
- Entry 42, Exit 20, Filter 8 editable condition templates
- natural language compiler, API, persistence migration, monitor
- 새 progressive Strategy Builder, comparison, chart trace
- tests/docs/commit/push/database/server deployment
- npm-driven local production build, managed restart, status, stop and health smoke

## Non-scope

- 실제 broker 주문·계좌 구독
- 공급자가 제공하지 않는 historical constituent/delisted/sector 데이터의 추측
- automatic optimizer, walk-forward optimizer의 본 구현
- 인증·다중 사용자·공개 mutation 권한 확대
- npm registry publication and remote hosting before MVP completion

## Milestones and acceptance criteria

1. **Contract.** v3 schema가 64 condition/depth 8 chain과 모든 indicator/exit/risk/execution
   variant를 strict validate하고 v1/v2는 회귀 없이 유지된다.
2. **Indicator/timeframe.** 모든 요구 indicator, VWAP variant, resample/MTF와 prefix invariance가
   deterministic fixture에서 통과한다.
3. **Rule/position.** nested operators, trace, monotonic trailing, break-even, partial exit, priority와
   risk sizing이 unit test를 통과한다.
4. **Backtest.** costs/fill/session/warm-up/missing policy, trade ledger, 전체 metrics, A–E comparison과
   golden fixture가 재현된다.
5. **Catalog/compiler/persistence.** 42/20/8 preset이 validate/execute되고 NL→v3, v3 save/history와
   additive Supabase migration이 동작한다.
6. **Builder/explainability.** 검색→preset→수십 rule 편집→backtest→compare→trace를 360/390/768/
   1440 keyboard/axe 환경에서 완료한다.
7. **Monitor/release.** 완료 봉 paper signal과 recovery를 검증하고 전체 gates 후 commit/push,
   migration, 새 server deployment와 production smoke를 완료한다.
8. **Local release automation.** `release:local`이 전체 repository gate를 통과한 최신 source만
   `127.0.0.1` production server로 배포하고, PID ownership·health·status·stop을 재현 가능하게
   관리한다.

## Dependency order

Contract → timeframe/indicators → rule evaluator → position/execution → backtest/analytics →
catalog/compiler/persistence → UI/explainability → monitor/release.

## Verification

- Focused RED/GREEN: `npm run test:unit -- strategy-v3`, 관련 integration/e2e grep
- Full: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm audit --omit=dev`
- Database: `npm run db:migrations`, dry-run 확인 후 `npm run db:push`
- Runtime: production server critical flow와 deployed URL health/API/UI smoke
- Review: `git status --short --branch`, scoped diff, `git diff --check`, secret scan

## Rollback and recovery

- v1/v2 route/schema/read path를 보존해 v3 UI/route를 이전 commit으로 revert할 수 있다.
- DB migration은 check constraint만 확장한다. v3 rows는 export 후 보존하며 자동 삭제하지 않는다.
- 배포 rollback은 직전 Git commit/server deployment로 되돌린다.
- 실제 주문·Telegram test delivery는 배포 검증에서 수행하지 않는다.

## Progress

- [x] 2026-09-01 — repository/stack/contract/UI/storage/test baseline audit.
- [x] 2026-09-01 — capability amendment, consolidated spec와 ADR-0009 작성.
- [x] Strategy v3 contract and 42/8/20 catalog metadata.
- [x] Indicator/timeframe runtime and look-ahead tests.
- [x] Rule/position/execution engine.
- [x] Backtest/metrics/comparison/golden.
- [x] Multi-entry local compiler, optional allowlisted OpenAI fallback, API/persistence/monitor.
- [x] Builder/explainability and 360/390/768/1440 browser verification.
- [x] Full gates, review and Supabase migration release.
- [x] Git commit `fa2b6d8` and `origin/main` push.
- [ ] Local npm release automation and managed production smoke.
- [ ] Protected remote server deployment after MVP completion.

## Discoveries and remaining risks

- 기존 v2 ATR trailing은 ATR 상승 시 stop이 낮아질 수 있어 v3에서 stateful monotonic stop으로
  교체해야 한다.
- v2 generic indicator가 UI layer를 import하고 multi-series 첫 값만 사용한다. v3 runtime은
  domain registry를 별도로 소유한다.
- TOSS production access는 기존 기록상 외부 403 가능성이 있다. 코드/배포 오류와 분리해 기록한다.
- 현재 hosting provider 설정은 repository에 없다. 검증 가능한 새 Node server target을 선택하고
  credential 부재 시 Git release와 배포 blocker를 숨기지 않는다.
- Vercel CLI 59.10.0은 이 machine에서 logged out이고 GitHub repository에는 workflow/deployment가
  없다. anonymous temporary deployment는 인증 없는 mutation API를 공개하므로 사용하지 않는다.
- 사용자 결정에 따라 MVP 완료 전 배포 target은 이 Mac의 loopback interface뿐이다. 프로세스
  state/log는 gitignored `.qos/runtime`에 저장하고 다른 프로세스의 PID는 종료하지 않는다.

## Decision log

- 2026-09-01 — Full prompt is the accepted specification; scope is not reduced to scenarios A–E.
- 2026-09-01 — v3 is additive; preset factories create rule trees and are not execution dispatch keys.
- 2026-09-01 — ADR-0009 owns signal/fill/intrabar/VWAP/MTF/cost/partial/sizing/look-ahead policy.
- 2026-09-01 — Before MVP completion, release means a verified npm-driven deployment bound only to
  `127.0.0.1`; npm registry and public hosting remain disabled.

## Outcome

Implementation, full gates, DB migration and Git push are complete. Local release automation is the
active release increment; remote hosting is intentionally deferred until MVP completion.
