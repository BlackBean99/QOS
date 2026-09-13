# Quality gates

## Status

2026-09-01 기준 npm/Next.js 도구 체인과 실제 시장 strategy workspace가 구성되었다. 아래 명령은
로컬에서 실제 실행하며, 명령이 바뀌면 README와 AGENTS.md를 함께 갱신한다.

## Always available

- Git 상태: `git status --short --branch`
- diff 공백 검사: `git diff --check`
- 변경 검토: `git diff -- . ':(exclude)LICENSE'`

## Required commands

| Gate                     | Command                       | 2026-09-01 result                   |
| ------------------------ | ----------------------------- | ----------------------------------- |
| Format check             | `npm run format:check`        | Passed                              |
| Lint                     | `npm run lint`                | Passed                              |
| Typecheck                | `npm run typecheck`           | Passed                              |
| Unit tests               | `npm run test:unit`           | 161 passed                          |
| Integration tests        | `npm run test:integration`    | 44 passed                           |
| Full Vitest suite        | `npm run test`                | 205 passed                          |
| End-to-end               | `npm run test:e2e`            | 71 passed, 9 matrix skips           |
| Production build         | `npm run build`               | Passed                              |
| Production run           | `npm run start`               | v3 UI/catalog/storage smoke passed  |
| Combined local gates     | `npm run verify`              | See required gates above            |
| Managed local deploy     | `npm run deploy:local`        | Loopback contract smoke passed      |
| Local deployment status  | `npm run deploy:local:status` | Healthy/stopped passed              |
| Managed local stop       | `npm run deploy:local:stop`   | Owned process stop passed           |
| Verified local release   | `npm run release:local`       | Full gates + loopback smoke passed  |
| Monitor runtime          | `npm run monitor`             | 2026-09-01 singleton/lifecycle pass |
| Accessibility automation | browser + `test:e2e`          | production axe: 0 selected flow     |
| Dependency audit         | `npm audit --omit=dev`        | 0 known production vulnerabilities  |
| Supabase migration       | `npm run db:migrations`       | Local/remote versions aligned       |
| Supabase remote CRUD/RLS | temporary-row smoke           | CRUD/update/history/delete passed   |
| TOSS real provider       | safe OAuth/master smoke       | HTTP 403; IP/permission unresolved  |

E2E는 첫 실행 전에 `npx playwright install chromium`이 필요하다. 표의 결과는 현재
작업 트리의 마지막 검증 기록이며 이후 코드 변경 뒤에는 다시 실행해야 한다.
아홉 skip은 105개 indicator 전체 생성, 19개 drawing 전체 anchor와 candle stale-response race를
desktop에서 한 번씩만 실행한 다른 세 viewport의 의도된 project skip이다. instance lifecycle,
설정 dialog, Fibonacci/brush, pagination, 검색 경합, 다중 자연어 Entry→Rule Chain과 axe는 네
viewport 모두 실행한다.

MVP 완료 전 공식 production release는 `npm run release:local`이다. 전체 gate가 하나라도
실패하면 시작하지 않으며 성공 후 home, Strategy v3 catalog와 다중 Entry compiler contract가
정상이고 monitor heartbeat와 worker ownership을 확인한 경우에만 `127.0.0.1` 상태를 기록한다. `deploy:local`은 빠른 build/restart 경로라 전체
release 증거를 대신하지 않는다. `deploy:local:stop`은 저장소/PID 시작 시각/cwd/process/listener
소유권을 모두 확인한 프로세스만 종료한다.

## Test expectations by change

- 계산/변환/전략/위험지표: unit tests와 경계값 fixture
- DB/API/data-provider adapter/주문 상태: integration tests와 실패/timeout 테스트
- Supabase 변경: dry-run에서 대상 migration만 확인하고 remote version 정렬, strict Data API
  response, revision conflict, secret 비노출, count/bytes 원자 한도, 전략/history CRUD와 삭제 후
  snapshot 발견성 검증
- 회원/전략/백테스트/결과/paper order: end-to-end tests
- 버그 수정: 변경 전 실패하고 변경 후 통과하는 regression test
- interactive chart: 공식 pagination 방향, repeated/no-progress cursor, 105개 실제 indicator,
  지표별 parameter/source/compound warm-up 검증, instance 추가/설정/중복/삭제/저장,
  완료 일봉 preload와 repainting 지표의 1D 차단, no-look-ahead, 실제 style, 19개 drawing
  point 생성·복원, PNG/fullscreen
- 주요 UI: 360px·390px·768px·1440px visual regression
- 모든 사용자 흐름: 자동 접근성 검사와 수동 키보드 검증
- LLM compiler: local multi-entry composition, missing key/provider failure/invalid output/strict valid
  output, allowlisted preset intent, prompt size와 `store: false`
- recommendation/window: 현재 전체 Entry 평가 수, deterministic return/MDD/Sharpe tie-break, default/custom
  timezone 기간, 실제 candle 범위, TTL/in-flight cache와 invalid intraday window
- monitor cost: 같은 instrument/timeframe 복수 전략의 provider call count, after-session no-refetch,
  desired-state refresh cadence, provider failure backoff, request/cache telemetry, singleton lease와
  server+worker lifecycle
- monitor transition: target별 ON/OFF, legacy v1/v2/v3, 15분 open/Session VWAP no-look-ahead,
  primary↔inverse paper leg, Telegram 성공 뒤 atomic state, repository snapshot fallback/source

## Quant correctness gate

- 데이터 기간, 종목 유니버스, 출처와 버전을 표시한다.
- 거래 시간, 휴장일, 시간대와 통화를 명시한다.
- 수수료, 슬리피지, 체결 가정과 포지션 제약을 표시한다.
- 결측치, 기업행위, 생존편향과 look-ahead bias를 검토한다.
- 결정론적 fixture와 독립 계산 예제로 결과를 대조한다.
- indicator seed/warm-up, rolling session 범위와 분봉 signal→next-open을 unit test로 고정한다.
- KOSPI와 NASDAQ fixture는 시장 달력, 시간대, 통화와 휴장일을 독립적으로 검증한다.
- 교차 시장 포트폴리오를 계산할 때 기준 통화, 환율 시점과 환율 데이터 출처를 표시한다.

## Accessibility and responsive gate

- WCAG 2.2 AA를 목표로 semantic HTML, label, 오류 연결, 명도 대비를 확인한다.
- 키보드만으로 흐름을 완료하고 visible focus가 유지되어야 한다.
- 최소 360px, 390px, 768px, 1440px와 모바일 safe area/가상 키보드를 확인한다.
- 차트는 색 외에 라벨, 선형, 마커 또는 패턴을 함께 제공한다.
- BUY/SELL chart는 서로 다른 도형·문자·색과 동일 정보의 표 대안을 제공한다.
- `prefers-reduced-motion: reduce`에서 비필수 이동·줌·패럴랙스를 제거한다.

## Performance gate

- 2026-08-23 production/로컬 Chromium 1440px에서 첫 화면은 resource 12개, transfer
  227,527 bytes(약 222KiB), decoded 838,221 bytes였다. 첫 화면 250KiB transfer 예산 안이다.
- mocked TOSS 종목 선택과 KLineChart 120 candle 표시 뒤 누적 resource 18개, transfer
  309,062 bytes, decoded 1,097,805 bytes였다. chart와 fixture 응답의 추가 transfer는 약
  79KiB이며 KLineChart는 종목 선택 전에는 load하지 않는다.
- 2026-08-25 105종 catalog build의 production 1440px mock smoke는 catalog를 연 뒤 resource
  19개, transfer 337,603 bytes, decoded 1,183,747 bytes, document overflow 0이었다. chart
  runtime은 여전히 종목 선택 전 initial route에서 분리된다.
- Strategy v2 기본 8-run과 최대 12-run/24 EMA 선 API fixture payload는 integration test에서
  800KB 미만으로 제한한다.
- 실제 사용자 p75 목표: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1.
- 로컬 lab 수치는 실제 사용자 p75나 INP 달성을 증명하지 않는다. 공개 배포와 RUM 환경이
  없으므로 실제 사용자 Core Web Vitals는 미측정 상태다.
- chart는 Canvas를 사용하지만 exact OHLCV와 BUY/SELL HTML 표를 함께 제공한다. WebGL은
  사용하지 않는다.

## Security and trading gate

- 입력 schema, 권한, 비밀의 서버 보관과 로그 마스킹을 검토한다.
- 외부 API timeout, 제한된 retry/backoff, rate limit과 안전한 실패를 테스트한다.
- LLM 출력과 사용자 전략을 임의 코드로 실행하지 않는다.
- live trading은 `AGENTS.md`의 모든 안전 조건과 별도 승인 전에는 품질 게이트를
  충족한 것으로 간주하지 않는다.
- `.env.local`/`.qos`는 Git에서 제외하고 파일 mode `0600`, export secret 제외와 redacted
  structured log를 검증한다.
- Supabase secret/service-role은 server-only로 유지하고 RLS를 활성화한 table의 anon/authenticated
  권한과 policy를 열지 않는다. 인증 없는 현재 API는 localhost 단일 사용자 범위 밖에 공개하지 않는다.

## Definition of Done

요구사항과 관련 테스트, lint/format/typecheck, production build, 실제 브라우저,
모바일, 접근성, 성능, 보안, 문서와 diff 리뷰가 모두 끝나야 한다. 실행 불가능한
게이트는 명령·이유·위험을 보고하고 미완료로 남긴다.

## Standards references

- [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [WCAG 2.2 — Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
