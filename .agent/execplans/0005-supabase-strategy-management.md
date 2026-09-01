# ExecPlan 0005: Supabase strategy management and backtest history

## Status

Active — implementation and verification complete; final independent re-review pending — 2026-08-25.

## Purpose and observable outcome

전략 JSON CRUD를 Supabase에 영속하고 저장 전략의 paper backtest 결과를 조회·상세 확인·삭제할
수 있는 이력으로 운영한다. 브라우저에 Supabase secret을 노출하지 않고 기존 import/export와
monitor 계약을 유지한다.

## Scope

- additive Supabase migration, RLS/grants and server-only REST adapter
- existing strategy CRUD/import/export repository boundary migration
- saved-strategy backtest management service and summary/full history API
- strategy library history UI, loading/error/empty/delete states
- existing local JSON compatibility when Supabase is not configured

## Non-scope

Supabase Auth, multi-user ownership, public deployment, live orders, arbitrary SQL/LLM execution,
failed-provider-attempt audit and cross-project replication.

## Milestones

1. Contract, ADR, migration and threat boundary.
2. Supabase strategy/history repositories with strict response and failure tests.
3. Management service and REST subresources with revision/snapshot integration tests.
4. Responsive strategy history UI and browser CRUD/run/detail/delete flow.
5. Remote migration/smoke when the configured project is active, full gates/build/runtime and docs.

## Verification

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
`npm run test:e2e`, `npm run build`, `npm audit --omit=dev`, `git diff --check`.

## Rollback and recovery

Export strategy/history rows before any remote rollback. Revert the repository factory to local JSON;
do not drop remote tables automatically. A paused/unreachable or un-migrated project returns an observable
store error and never writes to a divergent local fallback.

## Progress

- [x] Capability map, spec and ADR accepted from the user's explicit development authorization.
- [x] Existing remote migration versions preserved as local no-op baseline markers; QOS migration applied.
- [x] Repository/service/API tests and implementation.
- [x] UI/E2E implementation.
- [x] Atomic 500 strategy/5MiB portable storage migrations applied and remote history aligned.
- [x] Provider-independent recovery, orphan history, mobile/focus and async race regressions pass.
- [x] Final full gates, production smoke and independent re-review closeout.

## Discovery

- The configured project initially reported `INACTIVE`, then resumed and returned Data API `PGRST205`
  before migration. Eleven pre-existing remote migration versions were absent from this repository. QOS
  added explicit no-op baseline markers rather than repairing/deleting remote history; dry-run then selected
  only the intended QOS migrations, which were applied successfully through `20260825000700`.
- Remote smoke created temporary strategy/history rows, verified revision filtering and `ON DELETE SET NULL`,
  then removed both test rows. Migration `00600` recomputes and validates the export-safe counter
  before applying the lower CHECK constraint; `00700` serializes that recount against strategy writes.
  Local/remote migration versions are aligned.
