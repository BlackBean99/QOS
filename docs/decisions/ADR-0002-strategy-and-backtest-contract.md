# ADR-0002: Use a bounded strategy contract and next-session fills

## Status

Accepted

## Date

2026-08-22

## Context

자연어와 LLM 출력은 신뢰할 수 없고 임의 코드를 실행해서는 안 된다. historical
backtest는 신호 시점, 체결 시점, 시장 가정과 비용이 명시되지 않으면 재현할 수 없고
look-ahead bias를 숨길 수 있다.

## Decision

- 첫 strategy schema는 `version: 1`, 단일 시장(`KOSPI` 또는 `NASDAQ`), `1d`
  timeframe, 허용된 entry 규칙과 trailing-stop exit만 받는다.
- 제한된 자연어 parser는 문장 전체가 지원 template와 일치할 때만 schema로 변환하고
  부정·미만·OR·별도 청산 기준, 누락·모호함과 분봉 요청은 구조화 전에 오류로 반환한다.
  입력이나 생성 코드를 평가하지 않는다.
- Strategy와 모든 nested object는 strict allowlist이며 알려지지 않은 field를 제거하지
  않고 요청 자체를 거부한다.
- signal은 세션 종가에 계산하고 주문은 다음 fixture 세션 시가에 commission과
  slippage를 반영해 체결한다.
- KOSPI와 NASDAQ은 별도 fixture manifest에 calendar, timezone, currency, symbol,
  기간과 source version을 둔다. 교차 시장 합산은 환율 계약 전까지 금지한다.
- 모든 결과에 synthetic fixture임을 표시하고 진입 조건과 trailing-stop의 peak,
  threshold, signal close와 next-session fill은 실제 engine evaluation audit reason으로
  설명한다. internal ledger는 반올림하지 않고 표시 단계에서만 통화 형식을 적용한다.

## Alternatives considered

### LLM이 생성한 Python 실행

표현력은 높지만 원격 코드 실행, 재현성, 권한과 감사 위험 때문에 금지한다.

### 동일 봉 종가 체결

구현은 간단하지만 종가 신호가 확정되기 전에 같은 가격으로 체결되는 미래정보 편향을
만들 수 있어 채택하지 않는다.

### 다중 시장 포트폴리오

환율 시점·데이터 출처·휴장일 정렬 계약이 없으므로 첫 슬라이스에서 지원하지 않는다.

## Consequences and risks

- 지원 범위는 좁지만 입력과 실행의 경계가 검증 가능하고 결정론적이다.
- fixture는 교육·기능 검증용이며 실제 시장 성과나 최신 세금/브로커 비용을 의미하지 않는다.
- trailing stop은 일봉 기준이므로 장중 gap과 정확한 stop 체결을 모델링하지 않는다.

## Revisit when

- 새 indicator나 timeframe을 acceptance criteria에 추가할 때
- 실제 시장 데이터 provider와 adjusted price/corporate action 정책을 채택할 때
- 분봉 또는 live/paper execution을 설계할 때
