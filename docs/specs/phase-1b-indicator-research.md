# Capability Map and Spec: Phase 1B indicator research

## Capability map

| Module id          | Responsibility                                             | Depends on                        |
| ------------------ | ---------------------------------------------------------- | --------------------------------- |
| `strategy-v2`      | Versioned indicator/entry/exit JSON contract               | —                                 |
| `intraday-engine`  | 5-minute fixture, indicators, fills and metrics            | `strategy-v2`                     |
| `llm-compiler`     | Natural language to strictly validated Strategy v2         | `strategy-v2`                     |
| `candle-workbench` | Candle-first chart, overlays, oscillator and comparison UI | `intraday-engine`, `llm-compiler` |

Build order: `strategy-v2` → `intraday-engine` → `llm-compiler` → `candle-workbench`.

## Objective

사용자가 5분봉과 15-session VWAP 돌파 진입을 구성하고 여러 청산 기준을 동일 synthetic
데이터에서 비교한다. 자연어는 서버의 optional LLM compiler를 거쳐 Strategy JSON 후보가
되며 strict runtime validation과 사용자 확인을 통과한 뒤에만 백테스트한다.

## Tech stack and commands

기존 Next.js/React/TypeScript/Zod 단일 앱을 유지한다. chart/indicator dependency를 추가하지
않고 순수 TypeScript 계산과 접근 가능한 SVG를 사용한다.

- Focused: `npm run test:unit -- indicators advanced-strategy advanced-backtest`
- Integration: `npm run test:integration`
- Full: `npm run format:check && npm run lint && npm run typecheck && npm run test`
- Browser/build: `npm run test:e2e && npm run build && npm run start`

## Project structure

- `src/domain/advanced-strategy.ts`: Strategy v2 allowlist
- `src/domain/indicators.ts`: VWAP, EMA, ATR, Ichimoku, Stochastic RSI
- `src/domain/advanced-backtest.ts`: 5-minute signal/fill and exit comparison
- `src/domain/llm-strategy.ts`: optional OpenAI Responses adapter and output validation
- `src/fixtures/intraday.ts`: deterministic 5-minute synthetic candles
- `src/components/advanced-*.tsx`: builder, candle chart, overlays and result comparison
- `app/api/research/*`: parse and backtest boundaries

## Code style

Discriminated unions describe every executable rule. Exhaustive switches operate only on parsed
types; no user or model text becomes code.

```ts
type ExitRule =
  | { kind: "atr_trailing"; period: number; multiplier: number }
  | { kind: "chandelier"; period: number; multiplier: number; initialMultiplier: number };
```

## Testing strategy

- Unit: indicator reference values, warm-up, cross detection, each exit, look-ahead and metrics.
- Integration: request size, missing provider, mocked LLM strict output and rejected model output.
- E2E: reference prompt → JSON confirmation → comparison → candle/overlay/oscillator at four widths.
- Browser: keyboard, axe, horizontal overflow, console/network and production smoke.

## Indicator and execution definitions

- ATR: true range의 첫 full-period SMA로 seed한 뒤 Wilder recursive smoothing을 사용한다.
- RSI/Stochastic RSI: RSI는 첫 period 평균 gain/loss 뒤 Wilder smoothing, Stochastic RSI는
  RSI window의 0–100 위치를 계산하고 3-period SMA로 smoothing한다.
- Ichimoku: Tenkan/Kijun은 rolling high-low midpoint이며 Senkou A/B는 계산 시점에서 26개
  5분봉 앞으로 배치한다. 청산용 Kijun은 현재 bar의 비선행 기준선이다.
- Rolling session VWAP: 선택한 최근 session들의 현재 bar까지 typical price × volume을
  누적하며 미래 bar를 포함하지 않는다.
- Signal은 5분봉 close에서 확정하고 다음 fixture bar open에 slippage와 commission을 적용한다.
- Profit factor는 closed trade의 gross realized currency P&L 합으로 계산한다. 손실 거래가
  없으면 JSON은 `null`이며 UI는 이익 거래가 있을 때만 `∞`, 거래가 없으면 `—`로 표시한다.

## Boundaries

- Always: synthetic/source/version/calendar/timezone/currency/cost visible; next-bar-open fills;
  LLM output revalidated.
- Ask first: real provider, another LLM vendor, stored prompts, arbitrary formula DSL, new dependency.
- Never: `eval`, model-generated code, live order, secret in client/log, actual-return wording.

## Success criteria

- Default result chart is OHLC candles.
- VWAP, EMA and Ichimoku can be toggled on the price chart; Stochastic RSI is a synchronized
  oscillator panel with a table fallback.
- The supplied 5-minute/15-session VWAP entry compares Ichimoku Kijun, immediate/three-bar VWAP
  confirmation, ATR ×2/×3 trailing, initial-ATR + Chandelier, EMA cross and fixed trailing exits.
  Distinct parameter configurations of the same exit kind are allowed up to 12 runs; exact duplicates
  are rejected. Count, accessible label and selected exit overlay use the candidate's actual values.
- Results include return, MDD, Sharpe, profit factor, win rate, average win/loss, average holding,
  MFE and MAE.
- With `OPENAI_API_KEY`, a bounded server call returns strict Strategy v2 JSON; without a key the UI
  exposes the unavailable state and retains a deterministic reference-template path.

## Open questions

- Real intraday data provider, adjusted-price policy and exchange calendar.
- LLM model/cost policy beyond the configurable initial OpenAI adapter.
- Portfolio sizing, partial exits and parameter sweep persistence.
