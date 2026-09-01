# ExecPlan 0006: Workspace UX audit and redesign

## Status

Complete — implementation and repository verification finished — 2026-09-01.

## Purpose and observable outcome

QOS의 실제 사용자 흐름을 검색 → 차트 검토 → 전략 구성 → 저장·감시 순서로 다시 정리한다.
사용자는 검색 전에는 종목 선택과 기존 전략 복구에 집중하고, 종목 선택 후에만 차트·전략
작성 도구를 보게 된다. 실제 TOSS 데이터와 synthetic fixture 표시는 모든 화면과 접근성 설명에서
정확해야 하며, provider·monitor 실패는 원인과 즉시 가능한 복구 행동을 함께 보여야 한다.

시각 결과는 기존 near-black/acid-lime 전면 터미널에서 벗어나 warm paper canvas, 짙은 ink,
teal action, red/blue market semantics를 쓰는 고밀도 research desk로 바뀐다. 장식 이미지·새
production dependency·과도한 모션은 추가하지 않는다.

## Current state and evidence

- `app/page.tsx`와 `src/components/market-workspace.tsx`는 검색, Telegram, 빈 안내, 전략
  라이브러리를 모두 같은 시각 우선순위로 연속 배치한다.
- 검색 전 390px 화면에서 전략 작성 폼과 전체 이력까지 펼쳐져 핵심 행동까지의 길이가 크다.
- `src/components/strategy-builder.tsx`는 실제 TOSS 종목도 `SYNTHETIC`으로 표시한다.
- `app/api/strategies/parse/route.ts`의 잘못된 종목 오류도 synthetic 종목을 선택하라고 안내한다.
- 시장 지역을 바꿔도 `src/components/market-workspace.tsx`의 이전 검색 결과와 오류가 남는다.
- `src/components/telegram-settings.tsx`는 monitor의 `heartbeatAt`과 `lastErrorCode`를 받지 않아
  stopped/error/reconnecting 상태의 복구 판단이 어렵다.
- 2026-09-01 baseline에서 format/lint/typecheck와 Vitest 149개는 통과했다. 전체 Playwright는
  49 pass, 9 intentional skip, 2 fail이었다. 두 실패는 병렬/Strict Mode에서 느린 최초 전략
  목록 test가 첫 GET 한 건만 gate해 생기는 경쟁 조건이며 focused 단독 실행은 통과했다.

## Scope

- 실제 브라우저 감사에서 확인한 데이터 출처·검색 상태·monitor 상태 오류 수정
- 검색/상태/차트/전략/라이브러리의 정보 구조와 진행 안내 재설계
- 전략 라이브러리의 검색 전 recovery mode와 종목 선택 후 authoring mode 분리
- 360/390/768/1440 반응형, 키보드 focus, 명도 대비, loading/error/empty 상태 개선
- 기존 KLineChart·전략·저장·Telegram 동작 계약을 보존하는 E2E 회귀 보강
- `DESIGN.md`, `docs/WORKLOG.md`, quality 기록과 이 ExecPlan 동기화

## Non-scope

TOSS credential/IP 변경, 새 시장 공급자, DB/migration, 인증, 전략 DSL·지표 계산·백테스트
엔진 변경, monitor supervisor/자동 시작, Telegram 실제 전송, 실제 주문, 배포와 새 dependency.

## Milestones and acceptance criteria

1. **Audit contracts and regression baseline.** 실제 TOSS 종목은 모든 새/수정 경로에서 real data로
   표시되고, 시장 전환은 이전 검색 결과·오류를 제거한다. 병렬 E2E initial-list test는 Strict
   Mode 요청 수와 무관하게 같은 상태를 검증한다.
2. **Observable system state.** Telegram/monitor panel이 한국어 상태, 마지막 heartbeat,
   안전한 error code와 `npm run monitor` 복구 행동을 텍스트로 표시한다. 색만으로 상태를
   전달하지 않는다.
3. **Information architecture.** 검색 전에는 search + automation status + saved strategy recovery가
   첫 흐름이고, 프리셋·저장 폼은 종목 선택 후에만 나타난다. 검색 → 차트 → 전략 → 라이브러리
   anchor와 현재 선택 상태가 명확하다.
4. **Visual redesign.** 360/390/768/1440에서 가로 overflow 없이 warm paper/ink/teal research
   desk가 적용되고, 44px target·visible focus·reduced motion·chart table alternative를 유지한다.
5. **Integrated verification.** source-label/search/monitor/library 회귀, 전체 Vitest/Playwright,
   format/lint/typecheck/build, production browser screenshot·keyboard·axe·console/network 점검과
   자체 코드 리뷰가 완료된다.

## Verification

- Focused: `npm run test -- tests/integration/routes.test.ts`, 관련 Playwright grep/project
- Full: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm audit --omit=dev`
- Runtime: `npm run dev`와 production `npm run start`에서 390/768/1440 search, no-result,
  selected chart, strategy save/history recovery 화면을 확인한다.
- Browser: axe 0 violation, keyboard focus 순서, console warning/error 0, API mock status,
  document overflow와 before/after screenshot을 확인한다.
- Review: `git status --short --branch`, 관련 diff, `git diff --check`, secret-pattern scan.

## Rollback and recovery

변경은 client UI, 한 route 오류 문구, E2E와 문서에 한정한다. 문제가 생기면 변경 파일만 이전
마크업/스타일로 되돌릴 수 있고 DB migration이나 원격 상태 복구는 필요하지 않다. `.qos/data`,
Supabase row, Telegram 연결과 monitor delivery state는 읽기 전용으로 보존하며 삭제·초기화하지
않는다. 실제 Telegram 테스트 전송과 전략 mutation은 runtime 감사에서 수행하지 않는다.

## Progress

- [x] 2026-09-01 — 저장소/문서/Next.js 16.3.2 CSS·Client Component 지침 확인.
- [x] 2026-09-01 — 1440/390 초기 화면과 mocked selected-chart 화면 브라우저 감사.
- [x] 2026-09-01 — baseline format/lint/typecheck/Vitest와 Playwright failure 재현·국소화.
- [x] 2026-09-01 — 데이터 출처·시장/검색어 전환·E2E race 회귀를 RED/GREEN으로 수정.
- [x] 2026-09-01 — monitor 상태·heartbeat·safe error code와 복구 UX 구현·자동화 검증.
- [x] 2026-09-01 — 정보 구조·전략 recovery/authoring mode와 전면 시각 redesign 구현.
- [x] 2026-09-01 — 전체 gate/build/production browser/접근성/문서/diff 리뷰.

## Discoveries and remaining risks

- 실시간 SSE 때문에 generic `networkidle`은 QOS browser 완료 조건으로 쓸 수 없다. 의미 있는
  heading/status를 기다린 뒤 console/network를 별도로 검사해야 한다.
- 전체 E2E initial-list 실패는 production 저장 로직 실패가 아니라 개발 Strict Mode가 effect를
  재실행할 수 있는데 test가 첫 GET 호출 번호를 상태 의미로 사용한 것이 원인이다. test를
  release 이전 요청/이후 refresh 의미로 바꾼다.
- configured TOSS 실제 provider HTTP 403은 기존 ExecPlan 0004의 외부 IP/permission blocker이며
  이 UI 변경으로 해결하거나 성공으로 표시하지 않는다.
- 현재 `globals.css`와 일부 chart component가 크다. 이번 변경은 동작 중인 KLineChart 내부를
  재작성하지 않고 shell/token/정보 구조를 바꾸며, 무관한 dead component 삭제는 하지 않는다.

## Decision log

- 2026-09-01 — 새 UI framework나 production dependency 없이 기존 semantic HTML과 CSS를
  재구성한다. Next.js 16.3.2 설치 문서의 root global CSS와 좁은 Client Component boundary를
  유지한다.
- 2026-09-01 — 거래 기능이나 저장 계약을 바꾸지 않는 가역적 UX 변경이므로 새 ADR은 만들지
  않고 `DESIGN.md`와 이 계획에 근거를 남긴다. 기존 ADR-0005~0008 경계를 유지한다.

## Outcome

검색 전 command/recovery와 선택 후 chart/authoring이 분리된 새 research desk를 구현했다. 실제
TOSS 종목, 수정주가와 paper 결과 source label은 runtime 계약을 따르며 검색과 시장 변경 중 늦은
응답은 폐기된다. monitor 오류는 heartbeat, safe code와 복구 명령을 노출한다.

최종 검증은 format/lint/typecheck, unit 110, integration 39, Vitest 149, Playwright 63 pass와
9 intentional matrix skips, production build/start, audit 0 vulnerabilities다. production bundle의
mocked selected flow를 390/768/1440에서 확인했고 console/page error, document overflow와 axe
violation은 모두 0이었다. configured TOSS 실제 smoke의 HTTP 403 외부 blocker는 그대로 남는다.
