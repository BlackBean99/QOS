# ExecPlan 0008: Strategy Recommendation and Efficient Tracking

## Status

Completed — 2026-09-01.

## Purpose and observable outcome

선택 종목에 대해 전체 Strategy v3 Entry catalog를 동일 조건으로 비교한 역사적 수익률 1위와 상위
후보를 보여주고, 기간을 직접 설정하거나 명시적인 기본값을 사용한다. 추천을 저장하면서 tracking을
켜면 local release에 포함된 monitor가 완료 봉 BUY/SELL을 Telegram으로 알리고, 공유 cache와
session-aligned cadence로 TOSS API 요청을 제한한다.

## Current implementation evidence

- `src/domain/strategy-v3/catalog.ts`: Entry 42 / Filter 8 / Exit 20 editable preset factory
- `src/domain/backtest-v3/engine.ts`: 비용·next-open·metrics를 포함한 공통 v3 engine
- `src/domain/backtest-window.ts`: timeframe별 기본/직접 기간, 완료 봉과 target 정책
- `app/api/strategy-recommendations/route.ts`: 한 dataset에서 Entry 42개 평가·순위·cache
- `src/monitor/runner.ts`: shared dataset, session cadence, failure backoff와 provider telemetry
- `src/monitor/process-lease.ts`: 저장소당 monitor worker 한 개를 보장하는 PID lease
- `scripts/local-deploy.ts`: loopback Next와 monitor를 함께 검증·시작·종료하는 v2 lifecycle
- `src/components/strategy-recommendation-panel.tsx`: 추천·기간·적용·tracking workflow

## Scope

- `SPEC-strategy-recommendation-tracking.md` 전체
- shared backtest window domain/API/UI
- all-entry recommendation runner, bounded cache/coalescing, observability
- shared/session-aware monitor dataset sync and refresh cadence
- recommendation apply/save+tracking UX
- local release server+monitor lifecycle
- tests, ADR, current-state docs, Git push and verified local redeploy

## Non-scope

- parameter optimizer와 out-of-sample 자동 평가
- live order 또는 계좌 연결
- public remote deploy와 npm registry publish
- 공급자가 제공하지 않는 bias 데이터의 추측

## Dependency order and milestones

1. **Window contract.** strict default/custom 기간과 target 계산을 unit test로 고정하고 v3 backtest
   route가 resolved window를 반환한다.
2. **Recommendation API.** 42 Entry preset을 한 dataset에서 실행하고 deterministic ranking,
   bounded TTL cache/in-flight coalescing과 structured event를 integration test로 검증한다.
3. **Tracking runtime.** repository refresh cadence, instrument/timeframe shared dataset, session fetch
   window, bounded gap recovery와 provider counters가 fake TOSS call-count test를 통과한다.
4. **Managed local runtime.** legacy state를 읽으면서 v2 state가 Next와 monitor PID를 각각 검증하고
   deploy/status/stop에서 함께 관리한다.
5. **Responsive workflow.** 종목 선택→자동 추천→기간 재분석→builder 적용→저장+tracking ON을
   keyboard, 360/390/768/1440 browser에서 완료한다.
6. **Release.** docs/ADR/WORKLOG를 갱신하고 full gates, diff review, commit/push, local release와
   server/monitor status smoke를 완료한다.

각 milestone은 focused test, typecheck와 diff check 후 다음 단계로 이동하고 기존 v1/v2 계약은
호환 상태로 남긴다.

## Verification

- Focused: `npm run test:unit -- backtest-window recommendation local-deployment`
- Integration: `npm run test:integration -- strategy-recommendations monitor-runner`
- Browser: recommendation/tracking flow + existing viewport/axe matrix in `npm run test:e2e`
- Full: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm audit --omit=dev`
- Runtime: `npm run release:local`, `npm run deploy:local:status`, recommendation API smoke,
  monitor PID/heartbeat 확인
- Review: `git status --short --branch`, relevant diff, `git diff --check`, secret scan

## Rollback and recovery

- 신규 recommendation route/panel과 optional window는 additive하여 commit revert가 가능하다.
- monitor state는 additive default로 legacy version을 읽고 기존 delivery key를 보존한다.
- local deploy 실패 시 시작된 owned monitor/server만 종료하고 이전 managed state를 임의 삭제하지
  않는다. 새 release가 실패하면 검증된 직전 commit을 build/deploy한다.
- 저장+tracking으로 만든 전략은 일반 Strategy Library에서 OFF 또는 삭제할 수 있다.

## Progress

- [x] 2026-09-01 — repository, catalog, backtest, monitor, local release와 UI baseline audit.
- [x] 2026-09-01 — spec와 dependency-ordered ExecPlan 작성.
- [x] 2026-09-01 — window contract and backtest API.
- [x] 2026-09-01 — recommendation engine/API/cache/telemetry.
- [x] 2026-09-01 — efficient monitor and managed worker lifecycle.
- [x] 2026-09-01 — responsive recommendation/tracking UI.
- [x] 2026-09-01 — full verification and ADR/current-state documentation.

## Discoveries and remaining risks

- TOSS intraday는 1분 source 8,000개 cap이 있어 최근 31일보다 오래된 intraday window를 정확히
  제공할 수 없다. API는 fail closed하고 UI가 이 범위를 설명해야 한다.
- early close/특별 휴장 calendar는 독립적으로 제공되지 않아 regular session 경계에 의존한다.
- Mac sleep/reboot와 process crash 자동 재시작은 아직 제공하지 않는다.
- 추천은 in-sample ranking이며 survivorship bias를 해결하지 않는다. 결과에 항상 표시한다.
- configured TOSS production smoke는 현재 `rate_limited` 응답으로 완료하지 못했다.

## Decision log

- 2026-09-01 — “가장 수익률이 높은”은 동일 historical window의 total return 1위로 정의한다.
- 2026-09-01 — 모든 42 Entry preset을 공통 DSL/engine으로 평가하고 parameter optimization은 하지 않는다.
- 2026-09-01 — tracking은 completed-bar WebSocket + bounded REST repair이며 browser polling이 아니다.
- 2026-09-01 — default window는 intraday 30일, daily 2년, weekly 5년이다.
- 2026-09-01 — provider 실패는 key별 30초 시작 exponential backoff, 최대 5분으로 제한한다.
- 2026-09-01 — monitor는 repository-scoped PID lease를 가져 중복 worker를 fail closed한다.

## Outcome

Entry 42개 추천, default/custom 기간, 편집·저장+tracking UI, 비용 제한 monitor와 server+worker
local lifecycle이 구현됐다. format/lint/typecheck, Vitest 220, Playwright 75 pass/9 intentional skip,
production build, audit와 실제 deploy/status/singleton/stop smoke가 통과했다. 외부 TOSS smoke는 공급자
`rate_limited`로 남았고 live order는 추가하지 않았다.
