# ExecPlan 0004: Live market strategy workspace

## Status

Active — indicator manager/drawing expansion completed 2026-08-25; configured TOSS smoke remains
blocked by external IP/permission HTTP 403.

## Purpose and observable outcome

고정 synthetic 4종목 선택을 TOSS 국내·미국 실제 종목 검색으로 교체하고, 실제 candle을
KLineChart에서 지표·drawing·BUY/SELL과 함께 탐색한다. 전략·chart 설정은 server JSON으로
CRUD/import/export되며 저장 view에서 즉시 backtest 또는 별도 monitor를 시작할 수 있다.
monitor가 완성 봉 BUY/SELL을 감지하면 연결된 Telegram private chat으로 한 번만 알린다.

## Current state

- Strategy v1/v2, deterministic synthetic backtest와 custom SVG candle UI가 있다.
- `src/domain/instruments.ts`가 네 instrument enum과 메타데이터를 소유한다.
- root `.env.local`에는 이름만 확인된 TOSS/Telegram server credential이 있고 gitignored다.
- 2026-08-23 baseline은 format, lint, typecheck, Vitest 66, Playwright 20와 build가 통과했다.

## Scope

- TOSS OAuth, actual stock master search, candle history와 live trades
- KLineChart Upbit-family chart, requested indicators, drawings와 saved configuration
- versioned atomic JSON CRUD/import/export and saved strategy view
- separate local monitor, completed-bar signal evaluation, idempotency and Telegram delivery
- responsive/accessibility/error/observability/security tests and current-state docs

## Non-scope

Live order, account/order subscription, public hosting, auth/multi-user, proprietary TradingView code,
exchange-grade tick reconstruction and licensed market-data redistribution.

## Milestones and acceptance criteria

1. **Contracts and provider boundary.** Dynamic instrument identity and metadata snapshot coexist with
   legacy fixture tests; mocked TOSS auth/search/candle errors pass; real configured search/candle smoke
   returns valid data without logging secrets.
2. **Strategy store.** Atomic JSON repository and CRUD/import/export routes pass schema, conflict,
   traversal/size and secret-exclusion tests; restart read is demonstrated.
3. **Interactive chart.** Lazy chart shows real candles, Korean candle colors, a searchable 105-item
   indicator manager with per-instance settings, strict older-left pagination, pan/zoom/fit/crosshair/
   PNG/fullscreen, 19 icon drawings, signal overlays and table.
4. **Monitoring and Telegram.** Separate worker handles WebSocket ack/reconnect/gap sync, completed-bar
   evaluation, persisted dedupe and safe Telegram delivery; UI exposes desired/running/error state.
5. **Integrated flow and gates.** Search→select→save/view→backtest/monitor works at 360/390/768/1440,
   keyboard and axe; all repository gates, audit, real provider smoke and production runtime pass.

## Verification

- Focused: `npm run test:unit`, `npm run test:integration`
- Full: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm audit --omit=dev`
- Runtime: `npm run dev` plus browser search/chart/store flow; `npm run monitor` heartbeat and a
  controlled Telegram test/signal fixture. Real TOSS calls use configured env but output only status,
  counts and public instrument metadata.
- Review: `git status --short --branch`, relevant diff, `git diff --check`, secret-pattern scan.

## Rollback and recovery

Stop `npm run monitor` first. Removing the new routes/components returns the app to fixture behavior;
no provider-side state or orders are created. `.qos/data/*.json` is user-owned local data and must be
backed up/moved, never silently deleted. A corrupt store is left untouched and recovered from the
last `.bak` copy or exported JSON. Revoking credentials is external and not automated by the app.

## Progress

- [x] 2026-08-23 — Capability map, module specs and ADRs recorded after user approval.
- [x] 2026-08-23 — TOSS contracts, search, candle history and dynamic instrument migration.
- [x] 2026-08-23 — JSON strategy/chart store and CRUD/import/export UI.
- [x] 2026-08-25 — Correct KLineChart forward/backward pagination and no-progress termination.
- [x] 2026-08-25 — Verify VWAP/Ichimoku/Stochastic RSI and every exposed drawing as real chart state.
- [x] 2026-08-25 — Add 105 actual indicator instances, duplicate lifecycle, parameter/source/timeframe/
      style dialogs, 19 drawing icons and persisted settings.
- [x] 2026-08-23 — Monitor worker, Telegram connection/delivery and status UI.
- [x] 2026-08-23 — Full automated/runtime verification, docs and final review.
- [ ] Configured TOSS real provider master+candle smoke (currently HTTP 403).

## Discoveries and remaining risks

- 2026-08-25 direct Upbit comparison found that the public chart uses TradingView and exposes
  VWAP, Ichimoku Cloud, Stochastic RSI, Fibonacci, brush and broader drawing controls. QOS had only
  button-presence coverage for drawings and omitted those three indicators from the interactive chart.
- KLineChart v10 defines `forward` as older/left pagination and `backward` as newer/right pagination.
  The initial implementation reversed these flags, allowing historical pages to appear after the
  current range and repeatedly request the same boundary. A pure pagination reducer and 4-viewport
  browser regression now prove strict unique ordering and finite no-progress termination.
- Fast consecutive KLineChart anchor clicks share a 500ms double-click window. Browser automation uses
  separate click windows and drawing guidance keeps the active tool visible; actual Fibonacci,
  brush and all other exposed overlays persist as timestamp/value points.
- 1m provider page boundaries can split a 5m bucket. The oldest raw-minute bucket is now withheld and
  reconciled with the next inclusive older page before aggregation; a two-page misaligned reference
  locks exact OHLCV and prevents silent VWAP/indicator input corruption.
- Public Upbit comparison exposes a broad TradingView catalog, not a small fixed toggle row. QOS now
  owns a searchable 105-item catalog and stable instance settings while explicitly excluding licensed
  proprietary scripts, Volume Profile/object tree and pixel-identical TradingView parity.

- TOSS AsyncAPI 1.2.2 declares full-replace `trade:kr`/`trade:us`; stream has no snapshot or sequence
  and is explicitly lossy, so REST must seed and repair candle state.
- TOSS candle endpoint supports `1m` and `1d`, maximum 200 per page; 5m is locally aggregated with
  explicit session/timezone boundaries.
- Local JSON is not safe for multiple app/worker writers without a shared lock. Runtime state and
  strategy documents therefore use separate files; strategy mutations stay in the Next process.
- Live data availability depends on market session, registered IP, credential and local process uptime.
- Configured TOSS OAuth smoke currently returns HTTP 403 from the execution environment; contract tests
  pass, but real search/candle acceptance remains open until the registered public IP matches.
- Strategy v2 monitoring intentionally evaluates the first comparison exit only; selectable/multiple
  exits are a follow-up product decision.

## Decision log

- 2026-08-23 — TOSS provider and explicit monitor process: `ADR-0005`.
- 2026-08-23 — versioned local JSON store: `ADR-0006`.
- 2026-08-23 — KLineChart 10: `ADR-0007`.

## Outcome

기능 구현과 mock/fixture 기반 자동화, production/monitor/Telegram runtime 검증은 완료했다.
2026-08-25 indicator manager expansion은 Vitest 119, Playwright 35 pass/9 intentional matrix skips,
production build/browser에서 완료했다. 105종 전체 생성은 desktop에서, instance lifecycle과
parameter/source/style/완료 일봉 preload, axe/overflow는 360/390/768/1440에서 검증했다.
TOSS configured real provider는 HTTP 403이므로 실행 환경의 등록 IP/앱 권한을 바로잡은 뒤
master+candle smoke를 다시 통과해야 이 plan의 전체 acceptance를 완료할 수 있다.
