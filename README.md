# QOS

QOS(Quant Operation Management System)는 실제 국내·미국 주식을 조회하고 전략을 paper
backtest/실시간 감시하는 로컬 단일 사용자 Quant 웹앱입니다. 실제 주문은 하지 않습니다.

## 현재 구현

- TOSS OpenAPI 국내·미국 상장 종목 검색, 수정주가 일봉·1분봉과 실시간 체결 연결
- KLineChart 10 기반 한국식 적색 상승/청색 하락 캔들, 중복 없는 왼쪽 과거 탐색,
  이동·확대·화면 맞춤·십자선·PNG 저장·전체 화면
- 검색 가능한 105종 지표 catalog와 복수 instance 관리: 추가·개별 삭제, 계산 기간,
  OHLC/HL2/HLC3/OHLC4 source, 현재 chart/직전 완료 일봉, 색·굵기 설정 dialog
- VOL, MA/SMA/EMA/BOLL, Williams Fractal, RSI, MACD, VWAP, 일목균형표, Stochastic RSI,
  ATR, Donchian/Keltner, MFI, Supertrend, HMA, GMMA 등 실제 계산 지표
- 아이콘이 있는 19개 drawing: 추세선·ray·segment·channel·price line·브러시·박스·
  피보나치·피치포크·팬·annotation/tag와 전체 삭제·전략 저장/복원
- Strategy v3 Rule Chain: AND/OR/NOT 중첩, Entry·Filter 각 64개 조건, 42개 진입·8개 필터·
  20개 청산 preset, Long/Short, 1m~1w와 완료된 higher-timeframe filter
- Session/Weekly/Monthly/Anchored/Rolling VWAP, trend·momentum·breakout·mean reversion·
  volatility·volume·Ichimoku·market structure operand와 독립 Exit/Risk/Position/Execution
- T close→T+1 open 기본 체결, 비용·spread·tick·conservative intrabar, partial exit와 전체
  trade/metric/Decision Trace 및 동일 Entry/Exit 비교
- Supabase의 versioned 전략 JSON CRUD/import/export와 저장 전략별 백테스트 snapshot 이력
- Supabase 미구성 개발·테스트 환경을 위한 `.qos/data` local JSON 호환 adapter
- 별도 monitor process의 완성 봉 신호 감지, 영속 중복 방지와 Telegram private-chat 알림

TOSS 또는 Telegram 장애를 synthetic 데이터로 숨기지 않습니다. 기존 synthetic fixture는 계산
회귀 테스트에만 남아 있으며 사용자 종목 검색에는 노출되지 않습니다.

지표와 drawing은 공개 Upbit 화면에서 확인한 표준 연구 흐름을 기준으로 독립 구현했습니다.
TradingView의 라이선스 전용 source, proprietary community script, Volume Profile/object tree를
그대로 복제한 것은 아니며 pixel-identical parity를 주장하지 않습니다.

`OPENAI_API_KEY`는 기본적으로 비워 둡니다. 이 상태에서도 Strategy v3의 알려진 전략명은 여러
Entry·Filter·Exit preset을 외부 호출 없이 하나의 strict Rule Chain으로 합성합니다. 사전 밖 자유
문장만 사용자가 key를 명시적으로 설정한 경우 allowlisted preset intent로 보완하며, 모델이 실행
코드나 종목을 결정하지 못합니다. Codex/ChatGPT 로그인은 앱 API credential로 재사용하지 않습니다.

## Quick start

요구사항은 Node.js 20.9 이상과 npm입니다. 원격 migration 명령에는 별도로 설치하고 로그인한
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)가 필요합니다.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`(legacy project는
`SUPABASE_SERVICE_ROLE_KEY`), `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`,
`TELEGRAM_BOT_TOKEN`을 저장하고 브라우저에서
[http://localhost:3000](http://localhost:3000)을 엽니다. 모든 시크릿은 서버에서만 사용되며
파일은 Git에서 제외됩니다. Supabase를 구성한 상태에서는 원격 장애를 local write로 숨기지
않습니다.

처음 한 번 Supabase project를 연결하고 versioned table migration을 적용합니다. project가
paused 상태라면 dashboard에서 먼저 Resume 해야 합니다.

```bash
npm run db:link -- --project-ref <project-ref>
npm run db:push
npm run db:migrations
```

`qos_strategies`와 `qos_backtest_runs`는 RLS를 켜고 browser role에는 policy를 열지 않습니다.
저장 전략의 `즉시 백테스트`는 현재 revision과 종목 snapshot, engine version, 결과를 이력에
저장하며 라이브러리에서 summary 조회·full JSON 확인·삭제가 가능합니다.
라이브러리와 전체 이력은 종목 검색 성공 여부와 무관하게 복구할 수 있습니다. portable JSON은
최대 5MiB, 저장 전략은 최대 500개이며 원격 DB가 동시 요청에서도 두 한도를 원자적으로 지킵니다.
공유 project의 migration marker 경계는
[`supabase/migrations/README.md`](supabase/migrations/README.md)에 설명합니다.

Telegram은 봇에게 private chat으로 아무 메시지나 한 번 보낸 뒤 앱의 `Telegram 연결`을
누릅니다. `/start` 명령은 필요하지 않습니다. 실시간 감시는 개발 서버와 별도 터미널에서
계속 실행해야 합니다.

```bash
npm run monitor
```

저장 전략 view에서 `실시간 감시 시작`을 선택하면 monitor가 지원 timeframe의 완성 봉
BUY/SELL 신호를 감지해 한 번만 전송합니다. v1/v2 호환은 유지되고 v3 monitor는 같은 strict
Rule/indicator runtime을 사용합니다.

Strategy v3 API는 `GET /api/strategy-engine/catalog`, `POST /api/strategy-engine/compile`,
`POST /api/strategy-engine/backtests`입니다. 비교는 동일 backtests endpoint에 최대 세 전략을
보내 같은 dataset과 비용 조건에서 실행합니다. 자연어 결과도 임의 코드를 실행하지 않고 검증된
v3 JSON만 반환합니다.

MVP 완료 전 production target은 이 Mac의 loopback interface뿐입니다. 최신 source를 build해
`127.0.0.1:3000`에 재배포하려면 다음 명령을 사용합니다.

```bash
npm run deploy:local
npm run deploy:local:status
```

전체 format/lint/typecheck/test/build/audit와 Chromium E2E를 먼저 통과시킨 뒤 배포하는 공식
로컬 release 명령은 `npm run release:local`입니다. 실패하면 기존 관리 서버를 다시 띄우지 않으며
오류를 반환합니다. `npm run deploy:local:stop`으로 스크립트가 소유한 서버만 종료합니다. 다른
포트는 `QOS_LOCAL_PORT=4310 npm run deploy:local`처럼 지정할 수 있습니다. 상태와 로그는 Git에서
제외된 `.qos/runtime`에 저장되며 npm registry publish와 공개 hosting은 수행하지 않습니다.

## 품질 명령

| 목적                    | 명령                          |
| ----------------------- | ----------------------------- |
| Format 확인             | `npm run format:check`        |
| Lint                    | `npm run lint`                |
| Typecheck               | `npm run typecheck`           |
| Unit + integration      | `npm run test`                |
| Unit만                  | `npm run test:unit`           |
| Integration만           | `npm run test:integration`    |
| Chromium E2E + 접근성   | `npm run test:e2e`            |
| Production build        | `npm run build`               |
| Core local release gate | `npm run verify`              |
| 최신 source 로컬 배포   | `npm run deploy:local`        |
| 로컬 배포 상태          | `npm run deploy:local:status` |
| 로컬 배포 종료          | `npm run deploy:local:stop`   |
| 검증 후 로컬 release    | `npm run release:local`       |
| 실시간 감시 process     | `npm run monitor`             |
| Supabase 연결           | `npm run db:link`             |
| DB migration 적용       | `npm run db:push`             |
| DB migration 확인       | `npm run db:migrations`       |

첫 E2E 실행 전 Chromium이 없다면 `npx playwright install chromium`을 한 번 실행합니다.

## 현재 구조

```text
app/                 Next.js 화면과 API route
src/components/      종목/전략/차트/저장/Telegram UI
src/domain/strategy-v3/      Rule Chain schema, preset catalog와 compiler
src/domain/strategy-runtime/ indicator/timeframe registry, rule evaluator와 trace
src/domain/backtest-v3/      position/exit/risk/execution/backtest/metrics
src/server/          Supabase/local repository, 관리 service와 외부 API adapter
src/server/toss/     TOSS OAuth, 종목 master, candle, WebSocket adapter
src/monitor/         완성 봉 평가, 중복 방지와 Telegram delivery
scripts/             live monitor와 안전한 local release entrypoint
supabase/            versioned Postgres migrations와 CLI config
.qos/data/           gitignored local fallback·설정·monitor 상태
.qos/runtime/        gitignored local production PID 상태와 redacted log
tests/               unit/integration tests
e2e/                 360/390/768/1440 browser/accessibility tests
```

## 프로젝트 문서

- [제품 범위](docs/PRODUCT.md)
- [현재 아키텍처](docs/ARCHITECTURE.md)
- [품질 게이트](docs/QUALITY_GATES.md)
- [제품 디자인 규칙](DESIGN.md)
- [기술 결정](docs/decisions/README.md)
- [실제 시장/전략 workspace ExecPlan](.agent/execplans/0004-live-market-strategy-workspace.md)
- [Supabase 전략 관리 ExecPlan](.agent/execplans/0005-supabase-strategy-management.md)
- [Workspace UX redesign ExecPlan](.agent/execplans/0006-workspace-ux-redesign.md)
- [Quant Strategy Engine v3 ExecPlan](.agent/execplans/0007-quant-strategy-engine-v3.md)
- [Strategy v3 specification](SPEC-strategy-engine-v3.md)
- [저장소 작업 규칙](AGENTS.md)
