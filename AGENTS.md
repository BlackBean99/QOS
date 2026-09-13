# QOS repository instructions

이 파일은 저장소 전체에 적용한다. 더 하위 경로에 `AGENTS.md` 또는
`AGENTS.override.md`가 생기면 그 범위에서는 더 가까운 지침이 우선한다.

## 현재 저장소 상태

- npm + Node.js 20.9 이상 + 단일 Next.js/TypeScript 앱으로 실제 TOSS 국내·미국 전체 stock
  master의 persistent 검색/시세, KLineChart, Strategy v3 Rule Chain, Supabase/로컬 JSON 저장과
  다종목 Telegram monitor가 구현되었다. 결정은 `docs/decisions/ADR-0001-*.md`부터
  `ADR-0013-*.md`에 있다.
- Supabase는 optional primary persistence, OpenAI compiler는 optional이며 실제 시장 공급자는
  TOSS로 정했다. 인증은 아직 없다.
- MVP는 로컬 중심 단일 사용자다. 회원가입, 인증과 공개 시장 배포는 범위 밖이다.
- 핵심 흐름은 TOSS 실제 종목 검색→전략 구성/저장→paper backtest 또는 실시간 감시→
  KLineChart BUY/SELL 검토와 Telegram 알림이다.
- 확정되지 않은 선택을 현재 구조인 것처럼 문서화하거나 코드로 고정하지 않는다.

## 구조

- `README.md`: 진입점과 현재 상태
- `docs/PRODUCT.md`: 제품 목표, 범위, 핵심 사용자 흐름
- `docs/ARCHITECTURE.md`: 구현된 구조와 미결정 경계
- `docs/QUALITY_GATES.md`: 변경 유형별 완료 기준
- `DESIGN.md`: 첫 화면, 컴포넌트와 시각 언어 규칙
- `docs/design/REFERENCES.md`: 검증한 디자인 근거
- `docs/decisions/`: 채택된 장기 결정의 ADR 위치
- `.agent/PLANS.md`: ExecPlan 작성 규칙
- `.agent/execplans/`: 장기 작업의 살아 있는 계획

## 현재 사용 가능한 명령

- 저장소 상태: `git status --short --branch`
- 변경 검토: `git diff -- . ':(exclude)LICENSE'`
- 공백 오류: `git diff --check`
- 설치: `npm install`
- 개발: `npm run dev`
- format 검사: `npm run format:check`
- lint: `npm run lint`
- typecheck: `npm run typecheck`
- unit/integration test: `npm run test`
- browser/accessibility test: `npm run test:e2e`
- production build: `npm run build`
- production 실행: `npm run start`
- format부터 audit까지 core release gate: `npm run verify`
- 최신 source 로컬 production 배포: `npm run deploy:local`
- 로컬 production 상태 확인: `npm run deploy:local:status`
- 로컬 production 안전 종료: `npm run deploy:local:stop`
- 전체 gate 후 로컬 production release: `npm run release:local`
- 실시간 신호 감시: `npm run monitor`
- Supabase project 연결: `npm run db:link`
- Supabase migration 적용: `npm run db:push`
- Supabase migration 확인: `npm run db:migrations`

새 명령이나 도구 체인을 추가하면 이 파일과 README 및 `docs/QUALITY_GATES.md`에 동시에
기록한다.

## 작업 절차

1. 루트, 적용되는 AGENTS 문서, README, 패키지 매니저, 명령, Git 상태를 확인한다.
2. 기존 사용자 변경을 보존하고 관련 없는 파일을 수정하거나 되돌리지 않는다.
3. 작업에 직접 필요한 Skill과 저장소 문서만 읽는다.
4. 두 계층 이상, DB·인증·전략 DSL·백테스트·주문 실행, 마이그레이션 또는 복구가
   필요한 변경은 구현 전에 ExecPlan을 작성하거나 갱신한다.
5. 프레임워크·DB·데이터 공급자·API 계약·권한·주문 안전 정책처럼 되돌리기 어려운
   결정은 `docs/decisions/ADR-XXXX-*.md`로 남긴다.
6. 최소 변경을 구현하고 변경 유형에 맞는 테스트와 런타임 검증을 수행한다.
7. `docs/WORKLOG.md`, 관련 ExecPlan·ADR 및 현재 상태 문서를 갱신한다.
8. 종료 전에 Git 상태, 관련 diff, `git diff --check`를 확인한다.

## 구현 규칙

- 경량 단일 애플리케이션을 기본으로 하며 필요가 입증되기 전에는 서비스 분리,
  메시지 브로커, 추측성 추상화와 새 production dependency를 추가하지 않는다.
- 정확성, 거래 안전성, 사용성, 성능, 시각적 화려함 순으로 판단한다.
- 시간대, 시장 달력, 통화, 수수료, 슬리피지, 결측치, 기업행위와 데이터 출처를
  암묵적으로 처리하지 않는다.
- KOSPI와 NASDAQ 데이터·계산은 시장별 달력, 시간대, 통화와 거래 가능 상태를
  명시적으로 분리하고, 교차 시장 결과의 환율 가정을 표시한다.
- 외부 API에는 timeout, 제한된 retry/backoff, rate-limit 처리와 관측 가능한 실패
  상태를 둔다. 사용자 메시지와 비밀이 마스킹된 운영 로그를 분리한다.
- 시크릿은 서버 측 환경에서만 사용하고 저장소, 클라이언트 번들, 로그, fixture,
  문서에 기록하지 않는다.
- 실제 거래는 별도 승인과 안전 설계 전까지 범위 밖이다. 주문 기능의 기본은 paper
  trading이며 멱등성, 한도, kill switch, reconciliation, 감사 로그와 수동 복구가
  없으면 live trading으로 확장하지 않는다.

## UX 규칙

- 데스크톱과 최소 360px 모바일을 함께 설계한다. 390px, 768px, 1440px를 확인한다.
- WCAG 2.2 AA, 키보드 탐색, visible focus, semantic HTML, 오류 연결을 기본으로 한다.
- 차트는 색만으로 상태를 전달하지 않는다. 숫자는 비교 가능한 정렬과 형식을 쓴다.
- 모션은 의미 있는 상태 변화에만 사용하고 `prefers-reduced-motion`을 존중한다.
- 핵심 거래 흐름에는 장시간 애니메이션, WebGL, 스크롤 가로채기와 자동재생을 쓰지 않는다.

## 금지사항

- `git reset --hard`, 강제 push, 광범위 checkout, 무단 rebase·삭제
- 관련 없는 정리, 대규모 포맷 변경, 사용자 변경 덮어쓰기
- 검증하지 않은 테스트 통과 주장
- 민감정보나 대화 전문, 숨겨진 사고과정의 문서화
- 사용자 승인 없는 commit, push, PR 생성, 배포 또는 실제 주문

## Definition of Done

- acceptance criteria와 오류 경로를 포함한 요구사항을 충족한다.
- 변경 행동을 관련 테스트와 실제 런타임에서 검증하고 회귀가 없다.
- lint, format, typecheck, 관련 test, production build가 통과한다.
- 사용자 UI는 키보드와 모바일 viewport에서 확인하고 접근성·성능 영향을 검토한다.
- 보안, 관측성, 호환성, 롤백 경로를 변경 위험에 비례해 확인한다.
- 문서, ExecPlan, ADR, WORKLOG가 실제 상태와 일치한다.
- 관련 diff와 `git diff --check`를 자체 리뷰하고 사용자가 검토할 수 있게 요약한다.

명령이 아직 없거나 환경 제약으로 실행할 수 없는 게이트는 통과로 표시하지 않는다.
실행하지 못한 명령, 이유와 남은 위험을 명시한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
