# Worklog

검토 가능한 사실과 결과만 기록한다. 상세 계획은 `.agent/execplans/`, 장기 결정은
`docs/decisions/`에 둔다.

## 2026-09-13 — 15-minute VWAP Telegram monitor and explicit inverse paper hedge

- Strategy v3에 `PRICE(open)`과 Session VWAP의 completed 15분봉 상향 Entry/하향 Exit preset을
  추가했다. 동일 DSL·indicator runtime을 backtest와 monitor가 공유하며 자연어의 “15분봉 시가
  VWAP 돌파/이탈”도 paired Entry/Exit으로만 compile한다. catalog는 Entry 43·Filter 8·Exit 21이다.
- `monitor.targetControls`를 optional additive field로 추가해 최대 50개 target의 개별 ON/OFF와
  사용자가 명시한 inverse instrument snapshot을 저장한다. 기존 field가 없는 v1/v2/v3는 모두 ON인
  기존 의미로 실행한다.
- WAITING/LONG_PRIMARY/LONG_HEDGE paper state를 local monitor state에 보존한다. primary SELL은
  primary SELL+hedge BUY, 다음 primary BUY는 hedge SELL+primary BUY action을 한 Telegram 메시지로
  전송하며, 전송 성공 뒤 delivery와 paper leg를 atomic write한다. position key는 revision과 분리하고
  실제 paper 보유 instrument snapshot을 저장해 전략 수정·hedge 교체 뒤에도 이전 leg를 잘못 매도하지
  않는다. 실제 주문은 없다.
- 정상 repository list를 private atomic monitor snapshot으로 저장하고 원격 조회 실패에는 감시 read에만
  마지막 정상본을 사용한다. UI/status/log가 PRIMARY/SNAPSHOT source와 시각을 표시하고 CRUD write는
  장애를 local로 숨기지 않는다.
- 종목 catalog는 concurrent cold resolution을 single-flight로 합치고 STOCK_ALL endpoint 내부 retry를
  제거했다. 일반 요청의 missing Retry-After는 250/500ms backoff로 수정했으며 cache origin과 기준
  시각, directory 0700/file 0600을 검증한다.
- Next.js/@next/env/eslint-config-next를 보안 패치 16.3.5로 맞추고 transitive sharp 0.35.4,
  js-yaml 4.3.2를 lock했다. `npm audit`와 production-only audit 모두 0 vulnerabilities다.
- focused unit/integration 74개와 추가 v1/v2 compatibility test가 통과했다. 360/390/768/1440에서
  Rule Chain·Telegram·다종목/inverse·15분 VWAP browser 16건이 통과했고 발견된 OFF 행 대비 결함을
  수정했다. full clean-tree gate, Git push와 loopback release 결과는 최종 검증 뒤 갱신한다.

## 2026-09-01 — Persistent all-security catalog and strategy-first multi-target tracking

- TOSS `/stocks/all` 요청에서 STOCK/common-share 제한을 제거하고 ACTIVE market master의
  security type을 그대로 보존한다. 현재 공식 stock master가 반환하는 주식·해외주식·DR·인프라
  펀드·REIT·ETF·해외 ETF·ETN·신주인수권을 이름/티커로 검색하며 옵션·채권·선물을 합성하지 않는다.
- 시장별 master는 `.qos/data/instrument-catalog-v1.json`의 versioned strict envelope에 atomic
  `0600`으로 저장한다. fresh TTL 24시간, transient/auth provider 실패에 한한 bounded stale 7일,
  같은 market in-flight 병합과 `STOCK_ALL` 1 TPS를 위한 1.1초 refresh queue를 적용했다. API/UI는
  HIT/REFRESHED/STALE, 기준 시각과 수동 갱신을 표시한다.
- 저장 전략에 optional `monitor.targets`를 최대 50개 unique instrument snapshot으로 추가했다.
  field가 없는 v1/v2/v3 전략은 대표 종목 하나로 호환된다. monitor는 target별 runtime을 strict
  schema로 materialize하며 dataset/subscription은 instrument+timeframe으로 공유하고 평가·전송
  dedupe key에는 target instrumentId를 포함한다.
- Strategy Library detail에 종목·ETF 검색, 추가/제거, 대상만 저장, 저장+감시 ON을 한 흐름으로
  제공한다. Telegram 상태는 저장 전략 수와 실제 감시 종목 수를 구분한다. 모든 신호는 완료 봉
  paper alert이고 계좌·주문 API는 추가하지 않았다.
- focused 증거: unit 180, integration 51, 전체 Vitest 231개가 통과했고 주식+ETF 다종목 저장/ON
  시나리오는 360/390/768/1440 Playwright와 axe에서 통과했다. 전체 release gate, provider smoke,
  Git commit/push와 loopback 재배포 결과는 최종 검증 뒤 이 항목에 갱신한다.

## 2026-09-01 — All-entry recommendation, custom periods and efficient tracking

- 종목 선택 시 당시 Strategy v3 Entry preset 42개 전체를 한 TOSS dataset, 동일 비용·next-open 정책과
  baseline ATR 2x stop + 2R target으로 평가한다. 거래가 있는 후보를 과거 총수익률, MDD, Sharpe,
  preset id 순으로 결정론적으로 정렬하며 결과는 편집 가능한 v3 DSL이다. in-sample·생존편향·기본
  parameter 한계를 UI에 모두 표시한다.
- backtest 기간은 종목 timezone 기준 inclusive date다. 빈 값은 분봉 30일·일봉 2년·주봉 5년이고,
  직접 설정 분봉은 TOSS 보존 범위에 맞춰 최근 31일·최대 31일로 fail closed한다. 일반 v3/저장
  전략/recommendation이 같은 계약을 쓰고 요청 기간과 실제 완료 candle 기간을 구분한다.
- 추천 API는 instrument/timeframe/window/catalog key의 최대 100개 TTL cache와 in-flight
  coalescing을 사용한다. UI에서 timeframe이나 날짜를 바꾸면 이전 추천의 적용·저장 action을 즉시
  무효화하여 새 조건 설명으로 오래된 전략을 tracking하는 race를 막는다.
- monitor는 전략 목록을 60초마다 갱신하고 `instrumentId + timeframe` dataset과 동시 load를 공유한다.
  PRE/장중 bar/POST fetch window, bounded gap recovery, provider 실패 30초~5분 exponential backoff,
  session-close partial bar 완료 판정과 일/주봉 5분 확정 여유를 적용한다. REST page 수, cache hit와
  마지막 sync/refresh를 상태와 구조화 로그에 기록한다.
- local release는 Next와 monitor worker를 함께 관리한다. repository-scoped PID lease가 manual/
  managed 중복 worker와 중복 Telegram 전송을 fail closed하며 health는 fresh heartbeat뿐 아니라
  non-error status를 요구한다. 실제 deploy→healthy status→두 번째 monitor 거부→owned stop에서
  server와 child worker 정리를 확인했다.
- 검증: format/lint/typecheck, 39개 Vitest 파일의 220개 test, Playwright 75 pass와 9 intentional
  desktop-only skip, production build, `npm audit --omit=dev` 0 vulnerabilities가 통과했다. 1440px와
  390px production screenshot에서 loopback UI의 overflow 없는 레이아웃을 확인했다.
- 외부 경계: configured TOSS 검색 smoke는 `rate_limited` 응답이라 실제 recommendation 호출까지
  진행하지 않았다. historical constituent/delisted와 early-close calendar, Mac reboot/crash 자동
  재시작, live order는 구현 범위 밖이다.

## 2026-09-01 — Verified local MVP release automation

- MVP 완료 전 release target을 이 Mac의 `127.0.0.1`로 고정하고, npm registry publication과
  공개 hosting은 하지 않는 결정을 ADR-0010에 기록했다.
- `npm run verify`는 format/lint/typecheck/Vitest/build/production audit를 직렬 실행한다.
  `release:local`은 관리 서버를 안전하게 종료한 뒤 이 gate와 Chromium E2E를 통과한 build만
  로컬 production으로 시작한다. 개발 중 빠른 재배포는 `deploy:local`, 상태/종료는
  `deploy:local:status`와 `deploy:local:stop`을 사용한다.
- 서버는 loopback에만 bind한다. `.qos/runtime`의 mode `0600` state/log에 PID, process 시작 시각,
  Git commit과 dirty 여부를 기록한다. 종료 전 repository root, process cwd/name, 시작 시각과
  실제 listener를 모두 대조하며 확인할 수 없는 PID는 종료하거나 state에서 지우지 않는다.
- health gate는 home 응답뿐 아니라 Entry 42·Filter 8·Exit 20 전체 catalog와 세 Entry/한 Filter/
  ATR·Time Exit를 합성한 deterministic compiler 결과까지 검사한다.
- test-first로 port/state/process ownership와 health contract 단위 테스트 5개를 추가했다. 실제
  lifecycle에서 deploy→healthy status→owned stop→stopped를 확인했고, 공식 `release:local`은 unit
  161, integration 44, 전체 Vitest 205, Playwright 71 pass와 9 intentional skip, production build,
  audit 0 known production vulnerabilities 후 `http://127.0.0.1:3000` healthy를 기록했다.
- rollback은 관리 서버를 중지하거나 알려진 정상 commit을 별도 worktree에서 같은 release
  명령으로 build하는 방식이다. 부팅 자동 시작, crash restart, 로그 회전과 원격 배포는 아직
  제공하지 않는다.

## 2026-09-01 — Quant Strategy Engine v3

- v1/v2 저장 문서를 보존하면서 strict v3 DSL을 추가했다. Entry와 Filter는 AND/OR/NOT 중첩,
  depth 8, 각 64 leaf 조건을 지원하고 27종 typed indicator operand, 11개 비교 operator, 명시적
  6종 VWAP variant와 1m~1w timeframe을 사용한다. 이름 기반 strategy dispatch는 없다.
- 검색 가능한 catalog는 Entry 42·Filter 8·Exit 20 preset이다. Trend, momentum, breakout,
  mean reversion, volatility, volume, VWAP, Ichimoku, market structure, MTF와 독립 risk/exit을
  preset factory가 editable rule/exit document로 만든다. 여러 Entry preset과 수십 조건을 같은
  Rule Chain에 계속 추가하며 nested group과 parameter/operand/timeframe을 UI에서 수정한다.
- 자연어 v3 compiler는 알려진 전략을 로컬 사전으로 다중 Entry/Filter/Exit chain에 합성한다.
  사전 밖 문장은 사용자가 별도 `OPENAI_API_KEY`를 설정한 경우에만 strict structured-output
  preset intent로 보완한다. 선택 종목과 실행 DSL은 서버가 재구성하며 코드·도구·URL을 생성하거나
  실행하지 않는다.
- runtime은 Session/Weekly/Monthly/Anchored/Rolling VWAP, SMA/EMA, MACD, ADX/DMI,
  Ichimoku, RSI/Stochastic/ROC/Momentum, ATR/ATRP, Bollinger/Donchian/Keltner, opening range,
  RVOL/OBV/CMF, Z-score, market structure와 SAR를 계산한다. MTF는 거래소 세션에 정렬하고
  완료된 higher-timeframe candle만 as-of 투영하며 prefix-invariance로 미래 참조를 검사한다.
- stateful Exit/Position engine은 fixed/ATR stop, R target, monotonic ATR/percentage trailing,
  Chandelier, break-even, partial/multi-level scale-out, indicator/time/opposite exits와 priority를
  처리한다. fixed/equity/risk sizing, allocation/daily loss/drawdown/consecutive-loss control을
  적용하고 공급자에 sector metadata가 없다는 한계는 그대로 표시한다.
- backtest 기본은 T close signal→T+1 open market fill, non-zero commission/slippage/spread/tick,
  conservative intrabar다. trade ledger, MFE/MAE/R/partial fills, 20개 성과 metric, comparison,
  Decision Trace와 chart entry/exit/stop/target/trailing 설명을 저장·표시한다.
- v3 전략·history·monitor 호환과 additive `20260901000100_strategy_engine_v3.sql` migration을
  적용했다. 원격 migration version이 정렬됐고 임시 v3 row의 create/read/delete smoke 후 잔여 row가
  없음을 확인했다.
- 검증: format/lint/typecheck, unit 156, integration 44, 전체 Vitest 200, Playwright 71 pass와
  desktop-only matrix 9 intentional skips, production build/start, npm audit 0 vulnerabilities가
  통과했다. 다중 자연어 Entry chain은 360/390/768/1440에서 axe violation과 overflow 없이
  동작했다.
- Git: 검증된 application release를 commit `fa2b6d8`로 만들고 GitHub `origin/main`에 push했다.
  push 직후 GitHub Actions workflow와 deployment record는 없었고 Vercel CLI 59.10.0은 logged out
  상태였다.
- 경계: historical constituent/delisted/sector 자료는 TOSS 공급 범위 밖이므로 해결했다고
  주장하지 않는다. TOSS production OAuth의 기존 HTTP 403은 별도 provider 권한 문제다. live
  broker 주문은 추가하지 않았다. 인증 없는 mutation API를 공개하지 않기 위해 원격 server
  deployment는 보호된 hosting credential이 확인될 때까지 release blocker로 유지한다.

## 2026-09-01 — Workspace UX audit and research desk redesign

- 실제 브라우저에서 검색 전·종목 선택 후·전략 저장·monitor 오류 흐름을 감사하고, 검색·자동화·
  저장 복구가 한 우선순위로 길게 이어지던 화면을 `검색→차트→전략→라이브러리` 구조로 다시
  배치했다. warm paper/ink/teal 시각 체계, sticky navigation과 360/390/768/1440 반응형을
  적용했으며 KLineChart 내부 동작과 trading safety 경계는 유지했다.
- 실제 TOSS 종목의 잘못된 `SYNTHETIC` 표기와 parse 복구 문구, 백테스트의 고정
  `Synthetic fixture`/`unadjusted` 표시를 실제 source와 `adjustedPrices` 계약에 맞췄다.
- 시장 또는 검색어가 바뀌면 진행 중인 이전 요청을 무효화해 늦은 응답이 다른 시장 결과로
  되살아나지 않게 했다. 검색 결과 없음과 provider 장애에는 각각 시장·티커 확인, TOSS 서버·
  허용 IP 확인 행동을 제공한다.
- Telegram panel은 monitor의 한국어 상태, 전략·전송·실패 수, 마지막 heartbeat, safe error
  code와 `npm run monitor` 복구 명령을 표시한다. 전략 라이브러리는 종목 선택 전 recovery와
  선택 후 preset/save authoring을 분리하고 설명을 multi-line 입력으로 바꿨다.
- React Strict Mode가 최초 전략 목록 effect를 재실행할 때 호출 순서에 의존하던 E2E gate를
  release 전/후 상태 의미로 수정했다. 검색 요청 경합, provider 복구, monitor 오류와 실제 data
  label 회귀를 추가했다.
- 검증: format/lint/typecheck, unit 110, integration 39, 전체 Vitest 149, Playwright 63 pass와
  desktop-only matrix 9 intentional skips, production build/start, npm audit 0 vulnerabilities가
  통과했다. production bundle의 mocked selected flow는 390/768/1440에서 console/page error 0,
  overflow 0, axe violation 0, 첫 Tab의 skip link focus를 확인했다.
- 외부 경계: configured TOSS 실제 provider의 기존 HTTP 403(IP/앱 권한)은 미해결이다. DB/
  migration, 실제 Telegram 전송, monitor supervisor, 인증·배포와 live order는 변경하지 않았다.

## 2026-08-26 — 진입 지표 조합 조건

- Strategy v2 연구 진입에 RSI 상·하한, EMA 골든크로스, MACD 상향·하향 교차 필터를 추가하고
  `all/any` 조합 계약을 검증한다.
- 연구 화면에서 RSI(14)와 MACD(12,26,9)를 선택해 JSON에 포함하고 동일 조건으로 5분봉 백테스트한다.
- 검증: unit 110, lint, typecheck, production build, `git diff --check` 통과.
- 연구 화면에 카탈로그 전체 지표를 비교 조건으로 선택하는 generic indicator 필터를 추가했다.

## 2026-08-26 — 전략 저장 진행 상태와 timeout

- 저장 중 자연어 변환, JSON 저장, 목록 동기화 단계를 status 영역과 버튼 라벨로 표시한다.
- 자연어 변환·전략 POST·목록 재조회에 8초 제한시간을 적용해 네트워크가 멈춰도 무한 로딩 대신
  재시도 가능한 오류를 보여준다.
- 검증: `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`(147/147),
  `npm run build`, `npm audit --omit=dev`, `git diff --check`, Playwright 자연어 저장 흐름 통과.

## 2026-08-25 — Persist strategy management and backtest history in Supabase

- 요청: 재시작·프로세스 경계를 넘어 전략 JSON을 저장하고 CRUD/import/export, 저장 전략 관리와
  paper backtest 결과 이력을 제공한다. `.env.local`의 Supabase credential은 출력·client bundle·
  export에 포함하지 않는다.
- DB: `qos_strategies`와 `qos_backtest_runs` additive migration, index, RLS, browser role revoke,
  service-role server access와 원자적 500개/5MiB counter를 추가했다. 기존 원격 migration 11개는
  삭제/repair하지 않고 no-op history marker로 보존했다. 이는 타 앱 schema baseline이 아니며
  QOS `00100`~`00700`은 dry-run 후 remote와 정렬했다. `00400/00500/00600/00700`은 DB 내부 중복 열이 아니라
  compact portable 전략 객체와 export envelope를 계산해 local/export/import 한도와 맞춘다. `00600`은
  기존 counter를 재계산·검증한 뒤 export-safe 하한 CHECK를 적용한다. `00700`은 재계산 중 전략 쓰기를
  잠가 동시 trigger 증분이 stale 값으로 덮이지 않도록 한다.
- 서버: local JSON/Supabase repository boundary, strict Data API response validation, 8초 timeout,
  read-only bounded retry/backoff, mutation 비재시도, id+revision optimistic update/delete를 구현했다.
  Supabase가 구성된 장애를 divergent local fallback으로 숨기지 않는다.
- 관리: 저장된 현재 revision을 TOSS paper backtest로 실행한 뒤 전략·종목·engine·summary·full result
  snapshot을 저장한다. 전략별/전체 summary, full 단건 조회와 삭제 API를 제공하며 전략 삭제 뒤
  FK가 null이 된 이력도 전체 목록에서 계속 발견할 수 있다. 전역 목록은 ID-only 전략 조회와
  직렬화된 단일 history reconciliation을 사용해 페이지 밖 orphan도 안전하게 정리한다.
- UI: provider 종목 선택 전에도 전략 library/import/export/전체 이력을 제공하고 snapshot으로
  workspace를 복원한다. mutation commit과 refresh 실패를 구분하며 삭제 focus, orphan 식별,
  stale detail 차단과 360px single-column layout을 제공한다. 저장 폼의 설명 칸에 지원되는
  자연어 조건을 입력하면 동일한 parser로 Strategy JSON을 만든 뒤 검증된 문서만 저장한다.
- 원격 smoke: 임시 전략 create/read/revision update, history create/list/get, 전략 삭제 후 snapshot
  보존, history delete를 확인하고 테스트 row를 모두 정리했다. API 전략/전체 이력 목록은 200이고
  임시 service-role row에 대한 anon Data API 접근은 HTTP 401로 거부됐다.
- 검증: format/lint warning 0/typecheck, Vitest 147개(unit 108 + integration 39), Playwright 51 pass
  - desktop-only matrix 9 intentional skips, production build/start, 실제 390/1440px HTTP 200·console/
    page error 0·overflow 0을 통과했다. production API remote list/create/update/history/delete는
    200/201/200/200/204였고 `npm audit`은 0 vulnerabilities다.
- 경계: 인증 없는 localhost 단일 사용자다. 공개 배포 전에는 Supabase Auth와 owner-scoped RLS가
  필요하며 live order와 OpenAI API 호출은 이번 변경에 추가하지 않았다.

## 2026-08-25 — Replace fixed chart toggles with a configurable indicator manager

- 공개 Upbit 거래 화면의 `지표 및 전략` catalog를 실제 Chromium에서 다시 확인하고, 기존
  소수 toggle로는 요구 범위를 충족하지 못한다는 점을 기준으로 105종 검색형 catalog를 만들었다.
  KLineChart built-in 27종, QOS custom 4종과 MIT `@ixjb94/indicators` 1.2.6 기반 확장 74종은
  전부 실제 계산 결과를 KLineChart indicator instance로 연결한다.
- 각 지표는 stable id를 가진 독립 instance다. 같은 지표를 여러 번 추가하고 기간, 지원되는
  OHLC/HL2/HLC3/OHLC4 source, 현재 chart/직전 완료 1D, 색과 굵기를 dialog에서 수정하거나
  개별 삭제할 수 있다. 분봉의 1D 지표는 진행 중인 당일이 아니라 직전 완료 일봉을 사용한다.
- 초기 분봉 200개만으로는 직전 완료 일봉이 없어 1D 지표가 비는 독립 리뷰 finding을
  수정했다. 필요한 길이까지 최대 400개 일봉을 별도 bounded preload하고 해당 intraday
  날짜보다 앞선 완료 일봉만 투영하며 loading/error를 화면에 표시한다.
- indicator별 parameter 개수·정수/소수 범위·빠른/느린 순서와 source 지원을 strict schema와
  dialog inline 오류로 검증한다. 설정 색·굵기는 custom/확장 line뿐 아니라 built-in bar/circle의
  실제 KLine style에 적용하고, 삭제 뒤 focus는 다음/이전 instance 또는 추가 버튼으로 복원한다.
  1D 정수 기간과 다단 계산의 실제 compound warm-up은 bounded preload와 같은 400봉 예산으로
  제한하고 부족 이력은 오류 상태로 남긴다. 미래 봉 확인이 필요한 Fractal과 재도색하는 ZigZag는
  no-look-ahead를 보장할 수 없어 1D 투영을 명시적으로 차단한다.
- ADX/HMA/SMI/선형회귀/RVI/ZLEMA처럼 1봉 또는 2봉에서 수학적으로 계산할 수 없는 공식은
  indicator·parameter별 최소 기간을 설정 dialog와 schema가 동일하게 거부한다.
- 기존 추세선/Fibonacci/brush 범위를 19개 icon drawing으로 확장했다. ray/segment/channel,
  price line, rectangle, pitchfork, fan, annotation과 tag가 실제 point를 만들고 삭제·전략
  JSON 저장/복원된다. legacy main/sub indicator 설정은 기본 instance로 읽는다.
- 검증: 74개 확장 계산의 400-candle finite/alignment, 105개 catalog 고유성, 중복 instance,
  저장 restart와 1D no-lookahead를 unit test로 고정했다. 순거래량 보합=0, Connors RSI의
  percentage-return rank와 Supertrend의 이전 band recurrence는 독립 reference로 보강했다.
  74개 확장 지표 기본값은 각 지표가 선언한 최소 이력만으로 finite 값을 내는지 전수 검증하고,
  계산 민감 공식은 허용 최소값의 finite 결과와 바로 아래 값의 거부를 함께 고정했다.
  Playwright는 105종 실제 instance
  생성과 19개 drawing anchor를 desktop 전체 matrix로, lifecycle/dialog/axe/overflow를
  360/390/768/1440에서 검증한다.
- 경계: 공개 Upbit의 표준 연구 흐름을 독립 구현한 것이며 라이선스 전용 TradingView source,
  proprietary community script, Volume Profile/object tree 또는 pixel-identical UI를 동일
  구현했다고 주장하지 않는다.

## 2026-08-25 — Correct interactive chart pagination and verify Upbit-core interactions

- 실제 공개 Upbit 거래화면을 독립 Chromium에서 확인했다. 해당 화면은 TradingView chart로
  기간·지표 dialog·Fibonacci·brush·drawing toolbar·snapshot/fullscreen을 제공한다. proprietary
  TradingView 전체 복제가 아니라 QOS 전략 검증에 필요한 candle 탐색·핵심 지표·drawing의
  동작 동등성을 correction 범위로 고정했다.
- 공식 KLineChart v10에서 `forward=older/left`, `backward=newer/right`인데 기존 loader가 이를
  반대로 연결한 것이 과거 page가 최신 뒤에 붙고 반복되는 원인이었다. pagination을 순수
  reducer로 분리해 inclusive boundary/중복 timestamp/반복 cursor/no-progress를 제거하고 유한
  종료하도록 수정했다.
- 1분 provider page를 page-local 5분봉으로 먼저 집계하면 경계 bucket OHLCV가 손실되는 독립
  리뷰 finding을 재현했다. 가장 오래된 raw 1분 bucket을 다음 older page까지 보류·병합하고
  raw time/cursor가 전진하지 않으면 확정해 종료하도록 수정했으며 misaligned 200-row inclusive
  two-page reference에서 완전한 open/high/low/close/volume을 검증했다.
- interactive chart에 15-session VWAP, Ichimoku 9·26·52, Stochastic RSI 14·14·3·3을 실제
  indicator instance로 연결했다. Fibonacci와 brush를 360/390/768/1440에서 실제 point로
  생성·저장·기간 전환 복원했고, 나머지 추세선/ray/수평·수직/box/pitchfork/fan도 실제 anchor
  matrix로 검증했다. 활성 drawing 안내·pressed state, 44px 도구, PNG 저장과 전체 화면을 추가했다.
- Codex/ChatGPT 세션을 앱 credential로 재사용하지 않는다. `OPENAI_API_KEY`가 없는 기본 경로는
  외부 요청·과금이 없는 local reference compiler이며, 별도 과금 OpenAI API는 사용자가 key를
  직접 설정한 경우만 opt-in임을 UI, env example, PRD와 ADR-0004에 명시했다.
- 검증: format/lint/typecheck, Vitest 106/106(unit 77 + integration 29), Playwright 30 pass와
  데스크톱 전용 race/drawing matrix의 다른 viewport 6 intentional skips, production build/start,
  production 390px chart(VWAP/Ichimoku/Stochastic RSI + Fibonacci/brush 15 points), PNG 저장,
  axe 0, document overflow 0, console/page 오류 0, `npm audit --omit=dev` 0 vulnerabilities.
- 제한: TOSS configured real provider smoke의 기존 HTTP 403(IP/앱 권한)은 이번 chart correction으로
  해소할 수 없다. 공개 Upbit의 licensed TradingView proprietary script 전체를 동일 지원한다고
  주장하지 않는다.

## 2026-08-23 — Implement live TOSS market, KLineChart, JSON strategy library and Telegram monitor

- 요청: synthetic 4종목을 제거하고 TOSS 실제 국내·미국 주식을 검색해 Upbit 계열의
  캔들/지표/drawing에서 BUY/SELL을 확인하며, 전략 JSON CRUD와 실시간 Telegram 알림까지
  실제 구현한다.
- TOSS: dynamic market/instrument snapshot, server-only OAuth single-flight, 시장별 하루 stock
  master cache와 이름/ticker ranking, paged adjusted 1d/1m candle, local 5m aggregation 및
  `trade:kr/us` full-replace WebSocket/SSE를 구현했다. timeout, bounded retry/Retry-After,
  rate-limit/invalid payload와 redacted structured error를 테스트하고 provider 장애는 fixture로
  대체하지 않는다.
- Chart/UI: KLineChart 10 client-only chunk, 적색 상승/청색 하락과 밝은 grid, 1m/5m/1d,
  pan/zoom/fit/latest/crosshair, VOL/MA/SMA/EMA/BOLL/2+2 Williams Fractal/RSI/MACD,
  built-in/custom 추세선·ray·수평/수직선·브러시·box·Fibonacci·pitchfork·fan을 추가했다. 저장 drawing 복원과
  BUY/SELL 문자·방향·색 overlay/동일 HTML 표를 연결했다. KLineChart의 미등록 `ko-KR`
  locale과 양수 tabindex, signal 표 대비 및 360px file-input overflow를 브라우저 검증 중
  수정했다.
- 저장: `.qos/data/strategies.json` version 1 strict schema, atomic rename/backup, `0600`, mutex와
  optimistic revision으로 CRUD/import/export/read-only view를 구현했다. instrument/chart/drawing/
  monitor desired state를 저장하고 secret/chat/delivery state는 export하지 않는다.
- 알림: Bot API private chat 연결(`/start` 불필요), test delivery, 별도 `npm run monitor`, REST
  gap sync, 완성 봉 필터, strategy revision/side/bar dedupe와 최대 3회 delivery retry를 구현했다.
  코드 리뷰에서 첫 실패 뒤 process 내 재시도가 막히던 문제를 재현 테스트로 수정했다.
- 안전: 계좌·주문 channel과 실제 주문은 추가하지 않았다. `.env.local`과 `.qos`는 gitignored,
  credential은 client/export/log에 포함하지 않는다. Telegram 연결과 test message는 실제
  private chat에서 확인했고 production status API도 configured/connected를 반환했다.
- 검증: format, lint(경고 0), typecheck, Vitest 102개(unit 73 + integration 29), Playwright
  20개(360/390/768/1440, axe 0, keyboard/no-overflow), production build/start와 monitor
  start/stop, `npm audit --omit=dev` 취약점 0건이 통과했다. production 1440px first screen은
  transfer 227,527 bytes, Fractal을 켠 KLineChart 120-candle mock까지 누적 309,062 bytes였다.
- 미완료 외부 검증: configured TOSS real OAuth/master smoke는 secret 없이 재시도했으나 HTTP
  403(`forbidden`)이었다. 현재 실행 process의 public egress IP 등록 또는 TOSS 앱 권한을
  확인한 뒤 실제 master+candle smoke를 다시 실행해야 한다.
- 명시적 제한: realtime trade feed는 lossy이므로 REST candle을 authoritative로 사용하고,
  Strategy v2 monitor는 현재 첫 번째 청산 설정만 평가한다. 독립 exchange calendar/환율/
  기업행위 보강, process supervisor, 인증/DB와 live order는 후속 범위다.

## 2026-08-22 — Add candle-first indicator research and optional LLM compiler

- 요청: 모든 가격 차트를 캔들로 통일하고 VWAP·일목균형표·Stochastic RSI 등 다중 지표를
  함께 보며, 자연어를 LLM Strategy JSON으로 변환해 5분봉 VWAP 진입과 다양한 청산 전략을
  백테스트할 수 있게 한다.
- 구현: strict Strategy v2, synthetic 5분봉 fixture, 15-session VWAP entry와 일목 기준선,
  VWAP 즉시/3봉 확인, ATR ×2/×3 trailing, 초기 1.5 ATR + Chandelier, EMA 9/21, 고정 2%
  trailing의 8-run 비교를 추가했다. 같은 exit kind의 서로 다른 파라미터는 허용하고 완전히
  같은 설정만 거부한다.
- 계산: ATR/RSI는 Wilder smoothing, 일목 선행스팬은 26봉 forward displacement로 고정했다.
  Strategy 기간·배수는 실제 지표 cache와 trigger에 반영하고 Profit Factor는 closed trade의
  gross realized currency P&L로 계산한다.
- LLM/보안: 서버 전용 OpenAI Responses strict structured output, `store:false`, output limit,
  attempt당 12초 timeout, 최대 2회 요청과 bounded `Retry-After` backoff를 구현했다. 출력은
  Zod strict validation과 종목 일치 검사를 다시 통과하며 임의 코드는 실행하지 않는다.
  현재 로컬에는 API key가 없어 실제 provider 호출은 수행하지 않았고 reference template
  경로와 mocked provider 성공/실패/timeout을 검증했다.
- UI/데이터: 기본 OHLC candle, 선 모양이 다른 VWAP/EMA/일목 overlay, 별도 Stochastic RSI,
  정확한 매수·매도 신호/체결 표, source/version/calendar/timezone/currency와 1.5bps commission,
  5bps slippage를 결과에 표시했다. KOSPI 09:00–15:30과 NASDAQ 09:30–16:00 sample session 및
  holiday set을 분리했다.
- 검증: format, lint, typecheck, Vitest 66개(unit 46 + integration 20), Playwright 20개
  (360/390/768/1440, axe/keyboard/오류 복구/KOSPI provenance), production build와 server
  smoke가 통과했다. production Chromium에서 console/page 오류와 document overflow는 0,
  44px run target을 확인했고 `npm audit --omit=dev`는 알려진 취약점 0건이다.
- 성능: 1440px production 초기 resource 8개/약 155KiB, research 결과까지 10개/약 607KiB였다.
  미사용 8-run equity curve를 응답에서 제거하기 전 약 1.59MiB였으며, 현재 API response
  budget은 선택 run의 실제 청산선을 포함해 기본 8-run과 최대 12-run/24 EMA 선 모두
  integration test에서 800KB 미만으로 고정한다. 청산선은 chart candle과 index로 정렬된
  숫자 배열로 전송해 중복 timestamp를 제거한다.
- 독립 리뷰 반영: 비기본·동종 파라미터의 모든 값을 고유 label에 포함하고 실제 선택
  VWAP/Kijun/EMA/stop series를 차트와 표에 연결했다. 상승/하락 candle은 빈/채운 몸통과
  텍스트 범례로 색 외에도 구분한다.
- 최종 독립 재검토: required finding 없음. production 최대 12-run/24 EMA 선 응답은
  707,033 bytes/107ms, 기본 8-run 응답은 448,459 bytes였고 두 경로 모두 200을 반환했다.
- 남은 범위: 실제 분봉 provider/exchange calendar/adjusted price, 거래량 진입 필터, 부분익절,
  저장·parameter sweep UI, 실제 주문은 구현하지 않았다.

## 2026-08-22 — Replace explanatory first screen with the working instrument builder

- 요청: 자연어 오류 문구만으로 입력법을 추측하게 만들지 않고, 첫 화면에서 설명문 없이
  실제 기능 조작으로 제품을 이해하도록 전체 UI를 수정한다.
- 구현: 마케팅 hero를 제거하고 종목 검색·선택→진입 규칙→기간→거래량→trailing stop을
  직접 조립하는 화면과 즉시 갱신되는 구조도를 첫 화면에 배치했다. 자연어는 보조 탭으로
  내리고, 오류에는 클릭 가능한 완성 예시와 조립기 복귀를 제공한다.
- 종목/결과: Apple, NVIDIA, 삼성전자, SK하이닉스의 bundled synthetic fixture, strict
  `instrumentId`/market 계약, 종목별 price series와 BUY/SELL SVG marker 및 표 대안을
  추가했다. 종목·조건 변경과 실행 중 요청 race가 오래된 결과를 남기지 않게 했다.
- 접근성/반응형: 44px 지속 제어, visible focus, 오류 focus, 명도 대비, reduced motion,
  모바일 live structure와 360/390/768/1440 overflow를 검증했다.
- 검증: format, lint, typecheck, Vitest 38개(unit 29 + integration 9), Playwright 16개
  (4개 viewport, 정상/검색 없음/오류 복구/keyboard/axe), production build와 production
  server smoke가 통과했다. `npm audit --omit=dev`는 알려진 취약점 0건이다.
- 성능: production Chromium 1440px에서 초기 resource 8개/약 150KiB, lab LCP 약 48ms,
  CLS 0을 확인했다. 검색→선택→실행 전체 흐름은 resource 10개/약 159KiB, LCP 약 52ms,
  CLS 약 0.017이었고 console/network 오류와 document overflow가 없었다. 공개 환경의 실제
  사용자 p75와 INP는 아직 측정하지 않았다.
- 범위: 실제 종목 가격/전체 universe/provider, 저장, 외부 LLM, 주문은 추가하지 않았다.
- 독립 재검토: 결과 화면 axe/키보드 스크롤, 시장별 자연어 예시 복구와 builder-first 문서
  일치를 재확인했으며 남은 required finding은 없었다.

## 2026-08-22 — Implement daily backtest walking slice

- 요청: `docs/PRD.md`의 개발 세부사항을 실제 첫 범위에 맞게 조정하고 개발을 시작해,
  완료 후 production build와 앱 실행까지 검증한다.
- 구현: 단일 Next.js/TypeScript 앱, 제한된 한국어/영어 전략 parser, Zod version 1
  계약, KOSPI/NASDAQ 시장별 synthetic 일봉 fixture, 다음 세션 시가 체결 backtest,
  비용·Return/MDD/Sharpe/win rate·equity/drawdown·거래 이유 및 가정 UI를 추가했다.
- 범위: 외부 LLM/시장 데이터, DB, 인증, 지속 paper scheduler, PWA, broker와 live
  trading은 구현하지 않았다. PRD에서 현재 Phase 1A와 장기 roadmap을 분리했다.
- 결정: npm + Node.js 20.9 이상 + 단일 Next.js 앱과 bounded strategy/next-session fill
  계약을 `ADR-0001`, `ADR-0002`에 기록했다.
- 검증: format, lint, typecheck, Vitest 26개(unit 20 + integration 6), Playwright 12개
  (360/390/768/1440, 정상/오류/키보드/axe), production build와 production server 실제
  흐름이 통과했다. production Chromium에서 console/network 오류는 없었다.
- 성능/보안: 로컬 1440px baseline은 resource 7개, 전송 약 140KiB, lab LCP 약 60ms,
  CLS 0이었다. `npm audit --omit=dev`에서 알려진 production 취약점은 0건이었다. 이
  수치는 실제 사용자 p75/INP를 증명하지 않는다.
- 남은 위험: fixture는 synthetic/unadjusted이고 실제 달력·기업행위·생존편향·결측치,
  provider licensing과 환율을 모델링하지 않는다. 실제 데이터/LLM/저장은 후속 ADR과
  검증이 필요하다.
- 독립 리뷰: 부분 regex가 부정·미만·OR 문장을 반대로 확정하던 문제를 whole-string
  지원 template로 교체했다. nested unknown field 거부, trailing-stop exit audit 이유,
  exact trade/cash reconciliation과 관련 regression test를 추가했다.

## 2026-08-22 — Confirm initial MVP boundaries

- 요청: 첫 흐름을 자연어 전략→구조화 확인→일봉 paper backtest→결과로 확정하고,
  단일 사용자·무회원가입·비공개 사용과 KOSPI/NASDAQ 시작 범위를 반영한다.
- 변경 파일: `README.md`, `AGENTS.md`, `.agent/execplans/0001-mvp-foundation.md`,
  `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/QUALITY_GATES.md`,
  `docs/WORKLOG.md`.
- 결정: 첫 구현은 외부 공급자 없이 작은 KOSPI/NASDAQ fixture를 사용한다. 실제 종목
  유니버스, 데이터 공급자·라이선스와 LLM/전략 계약은 후속 결정으로 남긴다.
- 검증: `git diff --check`와 로컬 Markdown 링크 검사가 통과했다. trailing whitespace와
  이전 미결정 문구는 발견되지 않았다. 제품 코드가 없어 lint, typecheck, test,
  build와 브라우저 검증 대상은 없다.
- 남은 위험: 두 시장의 달력, 시간대, 통화, 휴장일, 기업행위와 환율을 독립적으로
  모델링해야 하며 정확한 종목 유니버스와 benchmark가 미정이다.

## 2026-08-22 — Repository discovery and development harness

- 요청: 현재 저장소와 Skills를 조사하고 최소 하네스, 첫 ExecPlan과 최신 디자인
  레퍼런스 후보를 준비한다. 제품 기능은 구현하지 않는다.
- 조사 결과: 초기 저장소에는 `README.md`와 `LICENSE`만 있었고, 패키지 매니저,
  애플리케이션, 테스트/빌드 명령과 하네스 문서는 없었다. Git `main`은
  `origin/main`을 추적했고 시작 시 작업 트리는 깨끗했다.
- 변경 파일: `README.md`, `.gitignore`, `AGENTS.md`, `.agent/PLANS.md`,
  `.agent/execplans/0001-mvp-foundation.md`, `docs/PRODUCT.md`,
  `docs/ARCHITECTURE.md`, `docs/QUALITY_GATES.md`, `docs/decisions/README.md`,
  `docs/design/REFERENCES.md`, `docs/WORKLOG.md`.
- 결정: 기술 스택이나 공급자를 추측해 ADR로 만들지 않았다. 첫 구현 후보를 고정
  fixture 기반 paper backtest 수직 슬라이스로 제한했으며 소유자 확인 전에는 Draft다.
- 검증: `git diff --check`가 통과했고 로컬 Markdown 링크가 모두 존재했다. trailing
  whitespace와 대표적인 private-key/API-key 형태는 발견되지 않았다. 제품 코드가 없어
  lint, typecheck, test, build와 브라우저 검증은 실행할 수 없다.
- 남은 위험: 첫 사용자 흐름, 사용자/인증 모델, 첫 시장과 데이터 공급자가 미정이다.
