# ExecPlan 0003: Indicator research and LLM strategy compiler

## Status

Complete — 2026-08-22.

## Purpose

`docs/specs/phase-1b-indicator-research.md`의 네 capability를 구현해 이동평균 중심의 일봉
walking slice를 5분봉 VWAP/다중 청산 비교 연구 흐름으로 확장한다.

## Milestones

1. Strategy v2와 indicator math를 테스트로 고정한다.
2. Synthetic 5-minute engine과 기본 8-run(후보 최대 12-run) 청산 비교 metrics를 구현한다.
3. Optional OpenAI compiler를 strict server boundary로 연결한다.
4. Candle-first chart와 overlay/oscillator UI를 제공한다.
5. 전체 gate, browser, production smoke와 문서를 동기화한다.

## Verification

- `npm run format:check`, `npm run lint`, `npm run typecheck`
- `npm run test`, `npm run test:e2e`, `npm run build`
- production 360/390/768/1440, keyboard, axe, console/network
- `npm audit --omit=dev`, `git diff --check`

## Risks

- Synthetic intraday series는 실제 미시구조·체결·기업행위를 나타내지 않는다.
- 15-session VWAP 정의는 session cumulative typical-price VWAP의 15-session rolling anchor로
  고정한다.
- Stochastic RSI는 가격 overlay가 아니라 별도 oscillator panel이다.
- LLM output은 strict schema여도 의미상 오류가 가능하므로 사용자 확인 전 실행하지 않는다.
- 실제 provider key가 없는 환경에서는 reference fallback과 mocked provider boundary만 검증한다.

## Progress

- [x] Capability map, assumptions and acceptance criteria recorded
- [x] Strategy v2 and indicator math
- [x] Intraday backtest and exit comparison
- [x] LLM compiler boundary
- [x] Candle/overlay UI and browser verification
- [x] Full gates, review and production run

## Outcome

Strategy v2, standard indicator math, market-separated 5-minute fixture, optional strict OpenAI
compiler, default 8-run/max 12-run comparison and candle-first accessible research UI are complete.
Final verification passed format, lint, typecheck, 66 Vitest, 20 Playwright tests, production build,
production smoke, dependency audit and independent review. The final production server remains on
`http://localhost:3000`. A real OpenAI call was not possible because no API key is configured; mocked
success, invalid output, instrument mismatch, 429/backoff and two-attempt timeout are covered.
