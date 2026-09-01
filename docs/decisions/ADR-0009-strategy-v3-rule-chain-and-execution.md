# ADR-0009: Strategy v3 rule chain and conservative execution

## Status

Accepted — 2026-09-01

## Context

Strategy v1은 일봉 진입 두 종류와 단일 trailing exit, v2는 5분봉 rolling VWAP 진입과 flat
filter/exit 비교에 고정되어 있다. 새 요구는 수십 Entry/Filter condition의 중첩, 독립 Exit/Risk,
부분 청산, 다중 timeframe, 명시적 VWAP variant와 설명 가능한 백테스트를 하나의 엔진에서 요구한다.
전략 이름별 switch-case를 늘리면 조합 수와 검증 표면이 폭발하고 같은 indicator 의미가 전략마다
달라진다.

## Decision

### Strategy DSL

- v1/v2는 immutable compatibility contract로 남기고 신규 작성은 strict `version: 3`을 사용한다.
- Entry와 Filter는 recursive `RuleGroup`과 typed `Condition`으로 표현한다. leaf 64, depth 8을
  bounded limit로 둔다.
- Operand는 constant 또는 named indicator output이고 timeframe과 과거 offset을 가진다. 미래
  offset과 centered window는 거부한다.
- preset은 v3 document factory이며 엔진은 preset id/name을 읽지 않는다.
- 자연어 compiler의 local path는 여러 preset factory 결과를 Rule Chain으로 합성한다. optional
  OpenAI path는 allowlisted preset intent까지만 생성하며 선택 종목과 최종 DSL은 서버가 재구성한다.

### Signal and execution timing

- 기본 indicator signal은 T close에 확정하고 T+1 open에 체결한다.
- hard stop/target처럼 이전 봉에 이미 유효한 주문은 다음 candle OHLC 범위에서 intrabar fill한다.
- 같은 candle에서 stop과 target을 모두 충족하면 기본 `CONSERVATIVE` policy가 불리한 fill을 먼저
  선택한다. 다른 policy는 실행 설정과 결과에 명시한다.

### VWAP and timeframe

- Session, Weekly, Monthly, Anchored, Rolling Bars, Rolling Days VWAP을 별도 variant로 저장한다.
- “15일 VWAP”은 Rolling Days 15이며 Session VWAP으로 해석하지 않는다.
- Higher timeframe 값은 primary bar 시점에 이미 닫힌 candle만 backward-as-of join한다.
- resample bucket은 exchange timezone의 regular-session open에 정렬한다.

### Costs and fills

- Commission, slippage, spread와 tick size는 versioned execution policy다. 0을 암묵적으로 적용하지
  않는다.
- Market, limit, stop fill은 order/fill ledger로 분리하고 적용 비용을 결과에 합산한다.

### Partial exit and position state

- Position은 entry price, initial/current stop, high/low since entry, initial risk, remaining/realized
  quantity, bars held와 fired exit ids를 가진다.
- scale-out 합은 초기 quantity의 100%를 넘지 않는다. trailing stop은 Long에서 감소, Short에서
  증가할 수 없다.
- Exit priority는 data field이며 안전한 default만 preset metadata로 제공한다.

### Position sizing and risk

- fixed notional, equity percentage, fixed risk amount와 equity risk percentage를 지원한다.
- risk sizing은 initial stop 없는 전략에서 fail closed한다.
- single-symbol MVP가 실제 집행할 수 있는 allocation/daily loss/drawdown/consecutive loss만
  적용한다. sector metadata가 없으면 sector exposure 해결을 주장하지 않는다.

### Look-ahead prevention

- breakout rolling high/low는 현재 bar를 제외한 previous N bars를 사용한다.
- 모든 indicator와 Rule에 prefix-invariance test를 적용한다.
- Swing/fractal은 right confirmation bars가 지난 시점에만 latest confirmed level로 노출한다.
- Ichimoku 표시 displacement와 signal-time source를 분리한다.

## Alternatives considered

### Strategy 이름별 handler

초기 구현은 빠르지만 조합을 지원하지 못하고 수십 switch-case가 필요해 기각한다.

### 자유 형식 expression 또는 생성 코드

표현력은 크지만 eval/exec, 비결정성, prompt injection과 감사 불가능성 때문에 기각한다.

### 기존 v2 schema 확장

VWAP 고정 진입과 flat filter 구조를 바꾸면 저장된 v2 의미가 깨지므로 additive v3를 선택한다.

### Same-bar close 기본 체결

종가를 보고 같은 종가에 체결하는 편향을 만들기 때문에 기본값으로 사용하지 않는다.

## Consequences and recovery

계약과 runtime 모듈 수는 늘지만 preset 조합 수와 실행 엔진 수는 분리된다. v3 history 저장을 위해
Supabase version/timeframe check를 additive migration한다. 롤백은 v3 작성/route를 비활성화하고
v1/v2 read path를 유지하는 방식이며 기존 strategy row는 변경하지 않는다. v3 JSON/history를
export한 뒤 migration constraint를 되돌릴 수 있으나 데이터 삭제는 자동화하지 않는다.

실제 주문은 여전히 금지하며 배포 서버는 backtest와 paper signal만 수행한다.
