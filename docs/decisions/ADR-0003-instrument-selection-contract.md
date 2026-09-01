# ADR-0003: Select one stable instrument before backtesting

## Status

Accepted

## Date

2026-08-22

## Context

첫 walking slice는 KOSPI/NASDAQ 시장마다 하나의 synthetic fixture를 암묵적으로 선택한다.
사용자는 개별 종목을 조회하고 선택한 전략의 매수·매도 시점을 차트에서 확인하려고 한다.
실제 시장 데이터 공급자, 전체 종목 universe, symbol 변경·상장폐지 정책은 여전히 미결정이다.
시장만 있는 Strategy로는 어떤 가격 series를 실행했는지 재현하거나 감사할 수 없다.

## Decision

- 사용자는 전략을 구조화하기 전에 bundled synthetic catalog에서 하나의 instrument를 검색하고
  선택한다.
- Strategy version 1에 `instrumentId`를 필수로 추가한다. fixture 단계의 id는
  `MARKET:SYMBOL` 형식이며, display symbol/name과 분리해 execution identity로 사용한다.
- `market`과 `instrumentId`가 일치하지 않으면 route와 backtest 경계에서 요청을 거부한다.
- backtest는 선택 instrument의 versioned candles만 사용하고 결과에 id, symbol, display name,
  market, timezone, currency, calendar, source와 version을 반환한다.
- 실제 상장 symbol/name을 검색 편의에 사용하더라도 모든 데이터와 결과에는 synthetic임을
  표시한다. 이 catalog는 실제 가격이나 완전한 상장 종목 목록을 의미하지 않는다.
- 한 실행은 한 instrument만 지원한다. 다종목 portfolio와 cross-market aggregation은 환율과
  포트폴리오 계약 전까지 제외한다.

## Alternatives considered

### 시장만 선택하고 내부에서 대표 종목을 계속 암묵적으로 매핑

UI 변경은 작지만 어떤 instrument를 실행했는지 사용자 선택과 Strategy JSON에 남지 않아
재현성과 감사 가능성이 부족하다.

### 외부 symbol을 유일한 식별자로 사용

단순하지만 provider symbol 변경, 거래소 namespace 충돌과 상장폐지에 취약하다. 현재는
fixture namespace를 포함한 id를 사용하고 provider 영속 id는 공급자 결정 때 재검토한다.

### 실제 시장 데이터 검색 API를 먼저 도입

더 많은 종목을 제공하지만 공급자, 라이선스, timeout/rate limit, 조정주가와 장애 정책을
동시에 결정해야 한다. 현재 요청을 검증하는 데 불필요하게 큰 범위다.

## Consequences and risks

- 선택 종목이 Strategy와 결과에 명시되어 재현성과 UI 신뢰도가 높아진다.
- `market`과 `instrumentId`가 중복 정보를 가지므로 strict refinement가 필요하다.
- 현재 catalog는 작은 synthetic fixture이며 전체 universe, 현재 상장 상태나 실제 성과를
  나타내지 않는다.
- 저장된 version 1 전략이 아직 없어 migration은 없지만, 후속 persistence 도입 전에는 schema
  version 정책을 다시 검토해야 한다.

## Revisit when

- 실제 시장 데이터 provider와 instrument master를 채택할 때
- symbol 변경, 상장폐지, 기업행위와 adjusted price 정책을 구현할 때
- 다종목 portfolio나 cross-market 결과가 acceptance criteria가 될 때
