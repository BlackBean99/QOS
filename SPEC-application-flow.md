# SPEC: application-flow

## Primary flow

1. 사용자가 국내·미국 시장과 이름/티커를 입력해 실제 TOSS 종목을 선택한다.
2. 기간과 지표·drawing을 조정하며 실제 historical candle을 탐색한다.
3. 기존 builder/자연어 연구 전략을 확인하고 전략명과 함께 JSON으로 저장한다.
4. 라이브러리에서 저장 문서·차트 설정을 view로 확인하고 backtest 또는 감시를 실행한다.
5. backtest BUY/SELL 또는 live signal이 chart와 표에 표시되고 live signal은 연결된 Telegram으로
   중복 없이 전달된다.

## Failure and empty states

TOSS 미설정/인증 실패, 검색 결과 없음, candle 없음, JSON 충돌, monitor worker 미실행,
Telegram 미연결을 각각 복구 행동과 함께 표시한다. provider 실패 때 synthetic 데이터를
실제 데이터처럼 대체하지 않는다.

## Non-goals

실제 주문, 계좌/잔고 접근, 공개 호스팅, 다중 사용자, TradingView Advanced Charts와
TOSS 원본 데이터의 장기 재배포는 포함하지 않는다.
