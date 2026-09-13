# 백테스트 거래 감사·추천 선택·TOSS 인증 복구

## 목적과 사용자 결과

- 상태: Complete (2026-09-14)
- 사용자는 0%로 뭉개진 결과 대신 거래 없음/실제 미미한 손익/손익 발생을 구분한다.
- 각 거래에서 신호 시점, 다음 봉 체결, 분할·최종 청산, 가격·수량·수수료·슬리피지·순손익·수익률과 Decision Trace를 확인한다.
- 티커별 추천 결과의 상위 후보를 직접 선택해 전략 편집기와 트래킹에 적용한다.
- 회전된 TOSS 서버 자격 증명을 값 노출 없이 다시 읽고, 만료·무효 access token은 요청 중 한 번 갱신한다.

## 현재 구현과 근거

- `src/domain/backtest-v3/engine.ts`는 거래와 trace를 만들지만 원시 가격 기준 손익과 체결 비용의 대사가 맞지 않고, 거래가 없는 이유를 집계하지 않는다.
- `src/components/strategy-engine/strategy-engine-workbench.tsx`는 최대 30개의 요약 카드만 표시하고 분할 체결과 누적 손익을 한눈에 보여주지 않는다.
- `app/api/strategy-recommendations/route.ts`는 모든 진입 preset을 timeframe 호환성 없이 평가하고 상위 5개를 표시 전용으로 반환한다.
- `src/server/toss/client.ts`는 stock master 요청의 제한된 시도 안에서 401 토큰 재발급이 보장되지 않는다.

## 범위

- 포함: 백테스트 비용 회계 대사, 거래 lifecycle 이벤트·조건 진단, timeframe 호환 추천, 추천 후보 선택, 거래 감사 UI, TOSS 401 재인증, 관련 테스트·문서·로컬 production 배포.
- 비범위: 실제 주문, 새 데이터 공급자, 자동 parameter 최적화, 공개 배포, 시크릿 저장·출력·커밋.

## 단계와 Acceptance Criteria

1. 회귀 테스트를 먼저 추가한다.
   - 비용이 있는 거래에서 `gross - fee - slippage = net`이고 ending equity와 합계가 일치한다.
   - 거래가 없을 때 entry/filter/warm-up 집계와 명시적 원인이 반환된다.
   - 일봉 추천에서 session 전용 전략이 제외되고 상위 후보가 선택 가능한 계약으로 반환된다.
   - 401 뒤 새 access token으로 동일 요청을 한 번 재시도한다.
2. 엔진·API를 수정한다.
   - 신호→진입 체결→부분/최종 청산 이벤트가 결정적으로 기록된다.
   - 분할 청산 비용을 포함한 거래·fill 단위 손익이 합산된다.
   - preset의 지원 timeframe이 typed metadata이고 API가 호환 후보 수와 제외 수를 알린다.
3. UI를 수정한다.
   - 0.00% 대신 거래 없음 또는 4자리까지의 작은 실손익을 구분한다.
   - 후보를 키보드로 선택하고 선택한 전략을 적용·저장·트래킹한다.
   - 거래 타임라인, fill 표, 누적 손익, 진입·청산 trace를 모바일과 데스크톱에서 확인한다.
4. 검증·배포한다.
   - `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run build`, `npm audit`를 실행한다.
   - 실제 TOSS 데이터로 추천/백테스트와 stock master 갱신을 확인한다.
   - 브라우저 390/768/1440px에서 핵심 흐름과 접근성을 확인한다.
   - 커밋·push 후 `npm run deploy:local`과 상태 확인을 수행한다.

## 검증 명령

- `npm run test -- tests/unit/strategy-v3/backtest.test.ts tests/unit/strategy-recommendations.test.ts`
- `npm run verify`
- `npm run test:e2e`
- `npm run build`
- `npm audit`
- `npm run deploy:local`
- `npm run deploy:local:status`

## 롤백·복구

- 기능 변경은 하나의 커밋으로 되돌릴 수 있다. 시크릿 파일은 Git에 넣지 않는다.
- 로컬 배포 실패 시 기존 `.next-production` release를 유지하고 `npm run deploy:local:status`로 확인한다.
- 사용자의 별도 3분봉 변경은 특정 파일만 임시 stash하고 검증 직후 복원한다.

## 진행상황

- [x] 2026-09-13: 삼성전자 일봉 추천에서 session VWAP 후보가 동일한 비정상 성과로 상위에 오르는 현상을 재현했다.
- [x] 2026-09-13: 로컬 회전 자격 증명으로 TOSS OAuth와 개별 stock master 호출이 성공함을 값 노출 없이 확인했다.
- [x] 2026-09-13: 회계·진단·timeframe 호환성·TOSS 401 회귀 테스트와 구현을 완료했다.
- [x] 2026-09-13: 360/390/768/1440 브라우저·접근성 매트릭스와 전체 품질 게이트를 통과했다.
- [x] 2026-09-14: 실 TOSS stock master·추천·백테스트와 local production HTTP/monitor를 확인했다.
- [x] 2026-09-14: 기능 commit `f332dcc`를 origin/main에 push하고 commit 기준 local release를 확인했다.

## 발견 사실과 남은 위험

- Session VWAP은 일봉에서 세션당 한 봉이라 비교 지표로 퇴화하므로 일봉 추천 후보가 될 수 없다.
- 현재 gross PnL은 이미 체결 슬리피지를 반영한 가격으로 계산하면서 slippage cost도 별도 노출하여 수치 의미가 불명확하다.
- TOSS는 서버 프로세스와 monitor가 각각 토큰을 갖는다. 401 단일 재인증으로 복구되는지 실제 동시 실행에서도 확인해야 한다.
- 상장폐지 종목과 historical constituent 데이터 미지원에 따른 survivorship bias는 해결하지 못하며 계속 명시한다.

## 결정 로그

- 기존 실행·추천 정책: `docs/decisions/ADR-0009-strategy-v3-rule-chain-and-execution.md`, `ADR-0011-historical-recommendation-and-efficient-tracking.md`
- 이번 회계·진단·호환성 결정은 `docs/decisions/ADR-0014-backtest-accounting-diagnostics-and-preset-compatibility.md`에 기록한다.

## 결과 요약

- clean gate: format/lint/typecheck, 44 Vitest files·255 tests, production build, production audit
  0 vulnerabilities.
- browser gate: 84 pass, viewport 전용 12 skip, 실패 0.
- 실 TOSS: KOSPI master 2,474개와 삼성전자 005930을 확인했다. 일봉 추천은 34개를 평가하고
  session 계열 비호환 9개를 제외했다.
- local production HTTP: 종목 검색 HIT, 추천 HIT, 실제 기간 백테스트 2 trades·6 events,
  손익 대사 차이 0.00005 이내. Next와 monitor 상태는 healthy/connected다.
- 자체 리뷰에서 SAME_BAR_CLOSE 거절 event 누락과 숏 전략 BUY/SELL 표기 오류를 발견해 배포 전에
  공통 체결 경로와 방향별 action 표기로 수정했다.
- commit 기준 cold deploy에서 36개 provider page warm-up이 10초를 넘는 것을 확인해 monitor startup
  health window를 bounded 30초로 조정했다. 개별 요청 timeout과 실패 cleanup은 유지한다.
- final executable local release는 `http://127.0.0.1:3000`, commit `6810291`, Next+monitor
  `healthy`다.
  monitor API는 connected·PRIMARY·2 strategies/2 targets·last error 없음이다.
