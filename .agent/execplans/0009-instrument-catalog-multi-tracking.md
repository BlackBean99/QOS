# ExecPlan 0009: Persistent Instrument Catalog and Multi-Target Tracking

## Status

Active — 2026-09-01.

## Purpose and observable outcome

TOSS 거래 가능 종목 master 전체를 하루 단위 local persistent cache로 검색해 ETF 등 상품 유형을
포함하고, 저장 전략 하나에 사용자가 고른 최대 50개 종목을 연결해 완료 봉 BUY/SELL Telegram
paper signal을 감시한다. UI의 중심을 단일 종목 감시에서 전략 기반 multi-target 감시로 확장한다.

## Current implementation evidence

- `src/server/toss/client.ts`: 현재 STOCK/commonShare만 요청한다.
- `src/server/toss/instrument-search.ts`: market별 in-memory 24h cache와 in-flight 병합만 있다.
- `src/domain/stored-strategy.ts`: monitor는 enabled/interval만 저장한다.
- `src/monitor/runner.ts`: document의 대표 instrument 하나만 구독·평가한다.
- `src/components/strategy-library.tsx`: 저장 전략 detail에서 단일 monitor toggle만 제공한다.

## Scope

- TOSS all-active security master query, persistent catalog, cache metadata와 manual refresh
- optional multi-target monitor schema와 legacy compatibility
- target별 runtime materialization, dataset/subscription sharing, instrument-scoped idempotency
- 저장 전략 기반 target search/add/remove/save/toggle responsive UX
- focused/full tests, browser/accessibility, docs/ADR/Git/local release

## Non-scope

- live order/account API, 옵션·채권·선물 catalog, 합성 상품 데이터
- auth/multi-user/public deploy, Redis/message broker, parameter optimization
- TOSS가 반환하지 않는 historical/delisted universe의 추측

## Dependency order and milestones

1. **Contracts and RED tests.** Provider query, catalog cache states, additive API metadata,
   monitor.targets validation/materialization과 target-scoped delivery를 실패 테스트로 고정한다.
2. **Catalog vertical slice.** Atomic store, 24h TTL/7d stale, in-flight/1 TPS refresh와 all-security
   query를 구현하고 unit/integration test를 통과시킨다.
3. **Monitor vertical slice.** optional targets와 legacy fallback, target expansion, market-aware trade
   filtering, dataset sharing/idempotency/telemetry를 구현한다.
4. **Responsive workflow.** Strategy Library에 strategy-first target picker를 추가하고 cache/product
   status, loading/error/empty/limit/conflict 상태를 제공한다.
5. **Release.** docs와 status를 실제 결과로 갱신하고 format/lint/typecheck/Vitest/Playwright/build/
   audit, diff/review, commit/push와 verified loopback release를 완료한다.

## Verification

- Focused: `npm run test:unit -- toss-instruments instrument-catalog monitor-targets`
- Integration: `npm run test:integration -- strategy-crud-routes monitor-runner`
- Browser: ETF search + strategy selection + three-target save/toggle, keyboard/axe and viewport matrix
- Full: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm audit --omit=dev`
- Runtime: `npm run release:local`, status/health/search cache/monitor heartbeat smoke
- Review: relevant diff, `git diff --check`, secret scan and fresh-context adversarial review

## Rollback and recovery

- `monitor.targets`와 API cache metadata는 additive다. revert하면 old documents의 대표 instrument가
  계속 감시된다. 새 JSON을 old build에서 읽어야 할 때는 targets field를 제거해 import한다.
- cache file은 derived data다. 손상 시 앱을 중지하고
  `.qos/data/instrument-catalog-v1.json`만 별도 보관/제거한 뒤 다음 검색에서 재생성한다.
- local release 실패 시 managed server/monitor만 정지하고 직전 검증 commit을 build/deploy한다.
- 감시는 UI에서 OFF할 수 있고 실제 주문 또는 계좌 변경은 없다.

## Progress

- [x] 2026-09-01 — repository/provider/search/store/monitor/UI baseline audit.
- [x] 2026-09-01 — official TOSS OpenAPI 1.2.14 all-security/cache contract 확인.
- [x] 2026-09-01 — specification, ExecPlan and proposed ADR 작성.
- [x] 2026-09-01 — catalog/search/API RED→GREEN; ETF/restart/stale/1.1s quota tests.
- [x] 2026-09-01 — multi-target schema/monitor RED→GREEN; v1/v2/v3 target identity와 telemetry.
- [x] 2026-09-01 — strategy-first responsive UX; 360/390/768/1440 Playwright+axe focused pass.
- [ ] full gates, review, docs, Git push and local release.

## Discoveries and remaining risks

- TOSS `STOCK_ALL`은 공식상 1 TPS이고 마켓당 최대 수천 건이므로 cold cache에서 market refresh를
  병렬 실행하면 rate limit을 유발할 수 있다. refresh queue를 직렬화해야 한다.
- provider master는 거래 가능 종목을 반환하지만 옵션·채권·선물 universe endpoint는 아니다.
- Mac sleep/reboot와 process crash 자동 복구는 기존과 동일하게 아직 없다.
- 서로 다른 target은 provider candle 호출이 필요하지만 같은 target/timeframe을 쓰는 전략은 공유한다.

## Decision log

- 2026-09-01 — official default를 사용해 securityType/commonShare filters를 제거한다.
- 2026-09-01 — fresh 24h, bounded stale 7d, explicit cache status를 채택한다.
- 2026-09-01 — 새 DB/Redis 없이 versioned atomic local JSON cache를 사용한다.
- 2026-09-01 — monitor.targets는 optional additive field, empty는 primary fallback이다.
- 2026-09-01 — strategy document를 복제 저장하지 않고 target별 runtime materialization을 한다.

## Outcome

구현 결과는 restart-safe catalog, all-security search, cache provenance, optional 50-target schema,
target별 monitor runtime과 strategy-first picker로 구성됐다. full gate, provider smoke, Git push와
verified local release 결과는 마지막 milestone에서 기록한다.
