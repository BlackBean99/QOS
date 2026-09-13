# Spec: Quant Strategy Engine v3 and Strategy Builder

Status: Approved scope — full user requirement, 2026-09-01

## Objective

QOS 사용자가 고점 돌파나 이동평균 두 종류에 갇히지 않고, 수십 개의 진입·필터 Rule을
AND/OR/NOT으로 중첩하고 독립적인 청산·Risk·Position·Execution 설정과 결합해 저장, 백테스트,
비교, 설명 가능한 paper signal 검토를 할 수 있게 한다.

모든 preset은 실행 코드 이름이 아니라 같은 Strategy v3 DSL을 만드는 editable factory다.
사용자는 preset으로 즉시 시작하거나 Rule Chain을 펼쳐 operand, operator, parameter, timeframe을
수정하고 다른 rule을 계속 추가한다. LLM도 임의 코드를 생성하지 않고 같은 schema만 반환한다.

## Tech Stack

- npm, Node.js 20.9+, Next.js 16.3.5 App Router, React 19.2.8, TypeScript 6
- Zod 4.4 strict runtime validation
- 기존 `@ixjb94/indicators` 1.2.6과 검토된 pure TypeScript 보조 계산
- TOSS adjusted 1m/1d candles, session-aligned local aggregation
- KLineChart 10, Supabase Data API + local JSON fallback
- Vitest 4, Playwright 1.62, axe-core
- 새 production dependency와 별도 Python/Kafka/Spark/Flink service는 추가하지 않는다.

## Commands

- Install: `npm install`
- Develop: `npm run dev`
- Format: `npm run format:check`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit/integration: `npm run test`
- Browser/accessibility: `npm run test:e2e`
- Production build/start: `npm run build`, `npm run start`
- Database: `npm run db:migrations`, `npm run db:push`
- Paper monitor: `npm run monitor`

## Project Structure

- `src/domain/strategy-v3/`: schema, catalog, compiler-facing contracts
- `src/domain/strategy-runtime/`: timeframe, indicators, rule evaluation, traces
- `src/domain/backtest-v3/`: position, execution, ledger, metrics, comparison
- `app/api/strategy-engine/`: v3 validation, backtest, compile/catalog endpoints
- `src/components/strategy-engine/`: builder, rule editor, comparison, explainability
- `tests/unit/strategy-v3/`: deterministic math, rule, position and bias tests
- `tests/integration/strategy-v3/`: API, persistence and compiler boundaries
- `e2e/`: 360/390/768/1440 Strategy Builder critical flows

기존 v1/v2 파일은 import/history 호환용으로 유지하며 신규 기능의 조건 분기를 추가하지 않는다.

## Strategy v3 Contract

최상위 Strategy는 다음 독립 책임을 가진다.

```typescript
interface StrategyDefinitionV3 {
  version: 3;
  identity: { name: string; instrumentId: string; market: Market; side: "LONG" | "SHORT" };
  timeframe: StrategyTimeframe;
  entry: RuleGroup;
  filters: RuleGroup;
  exits: ExitRule[];
  positionSizing: PositionSizing;
  risk: RiskControls;
  execution: ExecutionPolicy;
  overlays: OverlaySelection[];
}
```

`RuleGroup`은 `AND | OR | NOT`과 child group/condition을 재귀적으로 포함한다. 기본 보안·성능
한도는 leaf 64개, depth 8, group children 32개다. Builder는 이 한도까지 rule을 임의 조합한다.

Condition은 stable id, left operand, operator, right operand 또는 BETWEEN bounds, 선택 tolerance를
가진다. Operand는 constant 또는 timeframe이 명시된 indicator output과 non-negative historical
offset이다. 음수 offset과 centered rolling은 schema에서 거부한다.

지원 operator:

- `GT`, `GTE`, `LT`, `LTE`, `EQ`
- `CROSS_ABOVE`, `CROSS_BELOW`
- `TOUCH`, `BREAK_ABOVE`, `BREAK_BELOW`, `BETWEEN`

Cross/Break는 T와 T-1 값만 사용한다. Rule 결과는 input/output 값, threshold, pass/fail, source
timeframe과 source candle timestamp가 포함된 `DecisionTrace`를 만든다.

## Indicator and Operand Runtime

모든 indicator는 named output series와 parameter metadata를 갖는다.

- Price/volume: OHLC, typical price, volume, relative volume, volume SMA
- Trend: SMA, EMA, MACD line/signal/histogram, ADX, +DI/-DI, Ichimoku
- Momentum: RSI, Stochastic %K/%D, ROC, Momentum
- Volatility/channel: ATR, ATRP, Bollinger, width/percentile, Donchian, Keltner
- VWAP: session, weekly, monthly, anchored, rolling bar/day; standard-deviation bands
- Mean reversion: Z-score, MA percentage deviation
- Volume flow: OBV, CMF
- Structure: previous high/low, confirmed swing high/low, pivot/support/resistance
- Intraday: opening-range high/low
- Exit: Parabolic SAR
- Regime operands: ADX, ATRP, MA slope, Bollinger width classification inputs

Multi-output 지표는 output key를 반드시 지정한다. UI chart 계산기의 첫 값을 암묵적으로 사용하지
않는다. 각 series는 전체 dataset당 한 번 계산하고 cache한다.

## Entry and Filter Presets

다음 preset은 모두 실제 Strategy v3 rule tree를 생성하며 Customize 후 모든 rule과 parameter를
수정할 수 있다.

Required Entry 24종과 아래 확장 template를 포함한 실제 Entry 43종:

1. EMA/SMA Crossover
2. EMA Trend Pullback
3. MACD Crossover
4. ADX + DMI Trend
5. Ichimoku Trend
6. RSI Momentum
7. RSI Oversold Rebound
8. Stochastic Rebound
9. N-Bar Breakout
10. Bollinger Breakout
11. Bollinger Squeeze
12. Keltner Breakout
13. ATR Volatility Breakout
14. Session VWAP Breakout
15. VWAP Reclaim
16. VWAP Pullback
17. VWAP Mean Reversion
18. Rolling VWAP Breakout
19. Volume Confirmed Breakout
20. Opening Range Breakout
21. Z-Score Mean Reversion
22. Bollinger Mean Reversion/Re-entry
23. Market Structure Breakout
24. Multi-Timeframe Trend Entry

Trend filter용 Price Above MA와 단독/조합 Rule, ROC/Momentum, Weekly/Monthly/Anchored VWAP,
VWAP standard-deviation bands, OBV/CMF, previous high/low와 confirmed swing/pivot도 catalog의
editable rule template로 제공한다.

Filter 8종:

1. ADX Trend Filter
2. EMA Trend Filter
3. Higher Timeframe Trend
4. Volume Filter
5. Relative Volume
6. ATR Volatility Filter
7. Bollinger Band Width
8. Market Regime Filter

필터는 Entry와 같은 RuleGroup이므로 단독 진입, confirmation 또는 nested NOT/OR 어느 위치에도
재사용할 수 있다.

## Exit, Position and Risk

Exit는 declaration order와 별도 `priority`를 가진다. 같은 priority는 declaration order로
결정한다. 기본 priority preset은 hard risk → portfolio risk → scale-out/take-profit → trailing →
indicator → time이지만 사용자가 수정할 수 있다.

실행 가능한 Exit preset 20종:

1. Fixed Stop Loss (percent/absolute/tick)
2. Fixed Take Profit
3. Risk Reward Exit
4. ATR Stop
5. monotonic ATR Trailing
6. Chandelier Exit
7. Percentage Trailing
8. Break Even Stop with offset
9. Partial Take Profit
10. Multi-Level Scale Out
11. EMA Breakdown
12. MACD Reversal
13. RSI Reversal
14. VWAP Breakdown
15. Kijun Breakdown
16. Ichimoku Cloud Exit
17. Parabolic SAR
18. Time Stop (bars/days/clock)
19. End Of Session / no overnight
20. Opposite Signal Exit

추가 indicator exit condition은 같은 Rule evaluator를 사용한다. ATR/percentage/chandelier trailing은
Long에서 절대 하락하지 않고 Short에서 절대 상승하지 않는다. Partial level의 초기 quantity 합은
100%를 초과할 수 없고 각 level은 한 번만 실행된다. 잔여 quantity는 후속 trailing/indicator/time
exit가 관리한다.

Position sizing:

- Fixed notional
- Equity percentage
- Risk amount
- Risk percentage: account risk / absolute(entry - initial stop)

Risk control:

- maximum positions, symbol allocation
- daily loss, strategy drawdown, portfolio drawdown
- consecutive-loss circuit breaker
- sector exposure는 instrument sector data가 있을 때만 집행하며 없으면 명시적 unsupported trace를
  반환하고 해결됐다고 표시하지 않는다.

## Timeframe and VWAP Semantics

지원 timeframe: `1m`, `5m`, `15m`, `30m`, `60m`, `4h`, `1d`, `1w`. Intraday aggregation은
거래소 timezone의 regular-session open을 기준으로 bucket을 만든다.

Higher timeframe rule은 primary bar T 시점보다 종료 시각이 이른, 완료된 candle만 사용한다.
진행 중 daily/4h candle을 역사적 bar에 투영하지 않는다.

VWAP variant는 다음 strict union으로 구분한다.

- `SESSION`: 거래소 정규 세션 시작부터 현재 완료 bar
- `WEEKLY`, `MONTHLY`: 거래소 timezone calendar period 시작부터 현재 완료 bar
- `ANCHORED`: 명시 anchor timestamp 이후
- `ROLLING_BARS`: 최근 N completed bars
- `ROLLING_DAYS`: 최근 N session/day window; “15일 VWAP”의 기본 의미

Session VWAP에 `15일` 같은 window를 넣지 않는다. Standard deviation distance/bands와 percentage,
ATR, Z-score distance는 별도 parameter로 표현한다.

## Backtest and Execution Policy

- Indicator signal 기본: bar T close 확정 → T+1 open market fill.
- Same-close fill은 명시적 non-default setting과 결과 경고가 있을 때만 허용한다.
- Market/limit/stop order를 지원하고 order type·fill reason을 ledger에 기록한다.
- Commission, slippage, spread, minimum tick은 실행 설정이며 0으로 고정하지 않는다.
- Default intrabar policy는 `CONSERVATIVE`: Long의 같은 candle TP/SL 충돌은 stop을 먼저, Short는
  불리한 fill을 먼저 적용한다. `OPTIMISTIC`, explicit OHLC path, higher-resolution policy는 선택값이다.
- Session, timezone, adjusted-price policy, warm-up, missing candles와 data provenance를 결과에 남긴다.
- 현재 공급자가 historical constituents/delisted universe를 보장하지 않으므로 survivorship bias
  한계를 결과에 표시한다.

Trade ledger는 entry/exit time·price·reason·trace, position size, gross/fee/slippage/net PnL,
return, R multiple, holding, MFE/MAE와 모든 partial fill을 포함한다.

Metrics:

- Total Return, CAGR, MDD, Sharpe, Sortino, Calmar
- win/loss rate, Profit Factor, Expectancy, average win/loss, payoff, average R
- trade count, average holding, max consecutive wins/losses
- exposure, turnover, commission/slippage cost
- 가능한 경우 동일 dataset benchmark

## Strategy Comparison and Explainability

Comparison request는 공통 strategy와 variation patch 목록을 받아 동일 Entry/다른 Exit 또는 동일
Exit/다른 Entry를 같은 dataset·비용·기간으로 실행한다. 각 variation은 독립 strategy snapshot과
metrics를 반환한다.

Chart는 selected strategy가 사용한 Entry/Exit indicator, entry/partial/exit marker와 stop/target/
trailing guide를 표시한다. Marker와 trade row는 Decision Trace를 열어 각 rule 값과 pass/fail을
보여 준다. 색만으로 BUY/SELL/pass/fail을 구분하지 않는다.

## Natural Language Compiler

문장 → Strategy v3 후보 → strict Zod + semantic validation → 사용자 review → 실행 순서다.
LLM output은 코드, 함수명, SQL, URL이나 arbitrary expression을 포함할 수 없고 schema 밖이면 실행을
거부한다. API key가 없을 때 알려진 전략명은 deterministic local compiler가 여러 Entry/Filter/Exit
preset을 AND/OR Rule Chain으로 합성한다. 사전 밖 입력에만 optional OpenAI structured output을
사용하며 모델은 allowlisted preset id와 논리 operator만 고른다. 서버가 선택 종목에 맞는 최종 v3
document를 재구성하고 다시 검증한다.

특히 “15일 VWAP”은 `ROLLING_DAYS: 15`로, “세션 VWAP”은 `SESSION`으로 분리한다.

## API Contract

- `GET /api/strategy-engine/catalog`: searchable metadata and default rule factories
- `POST /api/strategy-engine/compile`: prompt → validated Strategy v3 candidate
- `POST /api/strategy-engine/backtests`: one validated v3 strategy → result
- `POST /api/strategy-engine/backtests`: 1개 strategy 또는 최대 3개 validated strategy comparison

모든 오류는 `{ error: { code, message, issues? } }` 형태, no-store, strict size bounds를 사용한다.
기존 v1/v2 route는 호환을 위해 유지한다.

## UI and Accessibility

Builder 정보 구조:

1. Preset/search/category로 빠른 시작
2. Entry Rule Chain
3. Filters
4. Exit Rules and priority
5. Position Size and Risk
6. Execution and data assumptions
7. Review JSON → Backtest → Compare → Trace

Catalog 검색은 Trend, Momentum, Breakout, Mean Reversion, Volatility, Volume, VWAP, Ichimoku,
Market Structure, Risk, Exit category와 이름/설명을 검색한다. 카드에는 이름, 설명, category,
필요 데이터, 목적, 주요 parameter, Entry/Filter/Exit, Long/Short 지원 상태를 표시한다.

기본 화면은 preset 요약만 보이고 Customize와 Advanced Rules를 단계적으로 펼친다. 모든 parameter에
도움말, unit, range, default가 있다. 360/390/768/1440, keyboard, visible focus, semantic HTML,
linked errors, reduced motion, WCAG 2.2 AA를 만족한다.

## Code Style

Discriminated union과 exhaustive registry를 사용한다. preset 이름으로 백테스트 분기를 만들지 않는다.

```typescript
const indicatorEvaluators: IndicatorEvaluatorRegistry = {
  EMA: evaluateEma,
  ADX: evaluateAdx,
  VWAP: evaluateVwap,
};

const rule: ConditionRule = {
  type: "CONDITION",
  left: { type: "INDICATOR", indicator: { kind: "EMA", period: 20 }, output: "value" },
  operator: "CROSS_ABOVE",
  right: { type: "INDICATOR", indicator: { kind: "EMA", period: 60 }, output: "value" },
};
```

## Testing Strategy

- Unit: EMA, SMA, RSI, MACD, ATR, ADX/DMI, stochastic, VWAP variants/bands, Bollinger, Keltner,
  Ichimoku, breakout, structure, SAR and every comparator
- Prefix invariance: every indicator/rule result through T equals the same calculation on dataset prefix T
- MTF: only completed higher candle is visible
- Position: monotonic trailing, break-even, partial/scale-out, priority, risk sizing, circuit breakers
- Golden fixture: Strategy → Signals → Orders → Fills → Trades → Metrics snapshot
- Preset conformance: all 43/21/8 named presets validate and execute without name-based dispatch
- Integration: API invalid/oversize/code fields, persistence v1/v2/v3, migration/history
- E2E: user scenarios A–E, dozens of added rules, search, mobile, keyboard, axe and trace

## Boundaries

- Always: strict validation, deterministic result, explicit market/time/cost/data assumptions, tests first.
- Authorized: additive Supabase migration, commit/push, production deployment and smoke verification.
- Never: eval/exec, hidden future data, silent zero costs, unmarked unsupported data, actual broker orders,
  secrets in browser/log/export/repository.

## Success Criteria

- 모든 위 Entry 43·Exit 21·Filter 8 preset이 editable v3 rule/exit definition을 만들고 실행된다.
- 사용자가 최소 64개 leaf condition을 nested Rule Chain으로 저장·백테스트할 수 있다.
- 사용자 Scenario A–E가 실제 UI에서 실행되고 E는 세 Exit 결과를 같은 표에서 비교한다.
- 모든 요청 indicator, exit, sizing, MTF와 look-ahead deterministic tests가 통과한다.
- lint, format, typecheck, full tests, production build와 browser/accessibility gate가 통과한다.
- DB migration, Git remote 반영, 새 server deployment와 production critical-flow smoke가 완료된다.

## Open Questions

없음. 사용자가 전체 명시 범위 구현과 Git/배포를 확정했다. 실제 주문과 데이터 공급자가 제공하지
않는 sector/survivorship 정보만 정직한 비범위다.
