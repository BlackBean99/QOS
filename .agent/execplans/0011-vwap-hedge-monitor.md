# ExecPlan 0011: 15-minute VWAP and inverse hedge monitoring

## Status

Completed and released locally — 2026-09-13.

## Purpose and observable outcome

사용자가 저장 전략별 여러 주식·ETF를 개별 ON/OFF하고, 15분봉 시가가 Session VWAP을 교차한
완료 봉 BUY/SELL 신호를 Telegram으로 받는다. 선택한 inverse 상품이 있으면 SELL 뒤 hedge BUY,
다음 BUY 뒤 hedge SELL과 primary BUY로 paper position이 이어진다. 원격 전략 저장소의 일시 장애에도
마지막 정상 monitor 설정은 read-only snapshot으로 계속 감시한다.

## Current implementation evidence

- `src/domain/strategy-v3/schema.ts`는 PRICE open, Session VWAP, 15m과 cross operator를 지원한다.
- `src/domain/strategy-v3/catalog.ts`의 Session VWAP preset은 close 기준이고 matching open exit가 없다.
- `src/domain/stored-strategy.ts` monitor는 strategy-level enabled와 raw targets만 저장한다.
- `src/monitor/runner.ts`는 target별 완료 봉 신호와 delivery dedupe는 하지만 paper leg/hedge 상태와
  repository snapshot fallback이 없다.
- `src/components/strategy-monitor-targets.tsx`는 target 추가/삭제만 제공한다.
- 2026-09-12 local release는 당시 paused Supabase 때문에 monitor health가 실패했고, 2026-09-13
  Supabase CLI에서 project가 `ACTIVE_HEALTHY`로 복구된 것을 확인했다.

## Scope

- additive target control schema, legacy migration-free compatibility
- open/session VWAP Entry/Exit presets and deterministic no-look-ahead tests
- persistent paper leg state machine and compound Telegram alerts
- monitor strategy read-only snapshot fallback and degraded telemetry
- responsive target toggle/inverse picker/current state UX
- earlier catalog review findings: single-flight disk miss, Retry-After parsing, STOCK_ALL inner retry,
  cache provenance, directory permission and v1/v2 monitor coverage
- docs, full clean-tree verification, Git delivery and verified loopback release

## Non-scope

- live order, broker/account integration, automatic inverse matching, public hosting/auth
- incomplete concurrent 3-minute chart and voice assistant changes

## Milestones

1. **Contracts and RED tests.** Snapshot, target controls, paper transition and open-VWAP catalog/signal
   behavior are failing tests with legacy fixtures.
2. **Runtime GREEN.** Add schema/helpers/state store and connect snapshot/transition delivery to runner without
   increasing periodic provider requests.
3. **UI GREEN.** Add accessible per-target switches, inverse search/clear and paper leg status; make exact
   completion timing and paper-only scope visible.
4. **Reliability closure.** Fix outstanding instrument catalog quota/cache findings and regression tests.
5. **Release.** Update ADR/current docs/worklog, format and review diff, create an isolated clean worktree for all
   gates, commit/push approved feature paths, then start loopback production and monitor and verify health.

## Verification

- Focused: `npx vitest run tests/unit/monitor-targets.test.ts tests/unit/monitor-state.test.ts
tests/unit/monitor-hedge.test.ts tests/unit/strategy-v3/catalog.test.ts`
- Integration: `npx vitest run tests/integration/monitor-runner.test.ts
tests/integration/strategy-crud-routes.test.ts`
- Browser: target ON/OFF, inverse search, status labels at 360/390/768/1440 with axe/keyboard checks
- Clean tree: format, lint, typecheck, full Vitest, production build, audit and Chromium E2E
- Runtime: local release status, monitor heartbeat/source/target count and redacted log inspection

## Rollback and recovery

- New monitor fields are optional. Reverting runtime leaves legacy targets and strategy-level toggle intact; exported
  JSON can omit `targetControls` when opened by an older build.
- Paper positions and snapshot are local derived operational state. Stop the owned monitor, archive only
  `.qos/data/monitor-state.json`/snapshot, and restart to reset without touching strategies or market data.
- Failed local release leaves no unmanaged process. Deploy the last known clean commit through the same owned
  loopback script.

## Progress

- [x] 2026-09-13 — repository/runtime/UI/Telegram and failure-state audit.
- [x] 2026-09-13 — assumptions and capability map recorded; official Supabase restore/status path verified.
- [x] contracts and failing tests.
- [x] runtime and UI implementation.
- [x] reliability closure and focused/browser review.
- [x] 2026-09-13 — clean-tree full gates, Git delivery and verified loopback release.

## Discoveries and remaining risks

- Supabase became `ACTIVE_HEALTHY` on 2026-09-13, but a future free-plan pause can recur; snapshot fallback remains
  required for monitor continuity and deliberately does not accept writes.
- A completed-bar open/VWAP comparison is known only after the bar's VWAP is final. It is not an opening-tick alert;
  UI and Telegram must state completion latency.
- Telegram delivery and local state cannot be transactionally committed together. State advances only after a
  successful Telegram API response; a process crash in that narrow gap can duplicate an alert, never silently
  advance without notifying.
- position identity must survive strategy revisions. It is keyed by strategy+target while the delivery key keeps
  revision; the held instrument snapshot prevents a changed hedge setting from closing the wrong paper leg.

## Decision log

- 2026-09-13 — use existing Strategy v3 operands/rules, not a parallel special-case signal engine.
- 2026-09-13 — inverse mapping is explicit user input and remains paper-only.
- 2026-09-13 — target controls are optional and keyed by instrumentId to preserve existing target snapshots.
- 2026-09-13 — read-only last-known-good monitor snapshot isolates remote availability without split-brain writes.
- 2026-09-13 — stable position identity and held-instrument snapshot survive strategy/hedge configuration changes.
- 2026-09-13 — Next.js security audit findings require the exact 16.3.5 patch before release.

## Outcome

Commit `a60d580` implements the completed 15-minute open/Session VWAP Entry and Exit presets, per-target
ON/OFF, explicit inverse paper hedge transitions, resilient strategy snapshot and target-level telemetry. A clean
worktree passed format, lint, typecheck, 197 unit tests, 53 integration tests, 250 total Vitest tests, production
build, full and production dependency audits with zero vulnerabilities, and Playwright with 83 pass/9 intentional
matrix skips. The same commit is running at `http://127.0.0.1:3000`; owned Next and monitor processes are healthy,
the monitor is connected to PRIMARY storage with one enabled strategy/target and no error, and a real Telegram
test message was accepted. Existing incomplete 3-minute chart and voice-assistant files were restored unchanged
after the clean deployment build.
