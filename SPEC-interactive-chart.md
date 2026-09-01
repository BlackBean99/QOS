# SPEC: interactive-chart

## 2026-08-25 parity correction

실제 Upbit 공개 거래화면의 TradingView chart를 기준으로 현재 delivery를 다시 검증한다.
브랜드·proprietary code의 복제는 범위가 아니며, QOS의 주식 데이터 경계 안에서 다음
상호작용을 기능 동등성 기준으로 삼는다.

- 과거 candle은 왼쪽으로만 추가되고 최신 candle 뒤에 과거 page가 붙지 않는다.
- upstream이 inclusive boundary나 같은 page/cursor를 반복해도 timestamp가 중복되지 않고
  no-progress page에서 추가 조회를 중단한다.
- VWAP·Ichimoku Cloud는 가격 pane, Stochastic RSI는 별도 pane에서 실제 계산·표시된다.
- MA/SMA/EMA/BOLL/Fractal/VOL/RSI/MACD와 함께 지표를 독립적으로 toggle할 수 있다.
- trend/ray/horizontal/vertical/brush/rectangle/Fibonacci/pitchfork/fan은 버튼 노출이 아니라
  chart point 생성, 전체 삭제, JSON 저장·복원까지 동작한다.
- 확대/축소, 최신 봉, 화면 맞춤, crosshair와 keyboard toolbar가 실제 chart state를 바꾼다.

Upbit가 제공하는 모든 TradingView proprietary indicator/script·pattern·object tree를
pixel-identical하게 복제한다고 주장하지 않는다. 현재 acceptance는 사용자 전략 검증에 직접
필요한 candle navigation, 핵심 지표와 drawing surface의 동작 동등성이다.

## 2026-08-25 indicator manager amendment

지표는 고정 toggle 묶음이 아니라 instance lifecycle로 관리한다. KLineChart 10이 제공하는
27개 KLineChart built-in, QOS custom Fractal·VWAP·Ichimoku·Stochastic RSI와 검증된 확장
지표 74종을 합친 105종을 검색 가능한 catalog에서 추가한다. 추가한 instance는 활성 목록에서
설정하거나 개별 삭제할 수 있다.

- 설정 dialog는 계산 파라미터, 지원되는 경우 OHLC/HL2/HLC3/OHLC4 source, chart/1D
  timeframe, 대표 색과 선 굵기를 제공한다.
- parameter arity·정수/소수 범위·순서와 source 지원은 indicator별 schema로 검증한다.
- intraday chart의 1D indicator는 별도 bounded 일봉 이력을 preload하고 미래정보가 섞이지
  않도록 해당 날짜보다 앞선 직전 완료 일봉 결과만 표시한다. 단일 기간뿐 아니라 다단 EMA,
  ROC/평균, Fractal radius 같은 compound warm-up도 최대 400봉 예산 안에서 검증하며 이력이
  부족하면 ready로 위장하지 않고 오류를 표시한다. 미래 봉을 확인하는 Fractal과 과거 값을
  재도색하는 ZigZag는 1D 선택을 지원하지 않는다.
- 같은 종류의 지표도 서로 다른 id와 파라미터로 여러 번 추가할 수 있다.
- legacy `mainIndicators`/`subIndicators` 저장값은 기본 설정 instance로 읽고, 첫 편집부터
  versioned `indicatorInstances`와 함께 저장한다.
- drawing catalog는 KLineChart가 제공하는 선·ray·segment·channel·price·annotation 도구와
  QOS rectangle/pitchfork/fan을 아이콘과 accessible name으로 노출한다.

## Contract

KLineChart 10을 client-only로 lazy load한다. 기본은 흰 배경과 밝은 격자, 한국식 상승 적색·
하락 청색 candle이며, crosshair·wheel/pinch zoom·drag pan·scroll·fit을 제공한다.

indicator는 `INDICATOR_CATALOG`의 105종을 지원한다. MA/EMA/BOLL/VWAP/Ichimoku,
ATR/Donchian/Keltner/Supertrend, RSI/Stochastic RSI/MFI/KST/Vortex/GMMA 등 가격·추세·
모멘텀·변동성·거래량 범주를 검색해 실제 pane에 추가한다. overlay는 19개 선/ray/segment/
channel/price/brush/rectangle/Fibonacci/pitchfork/fan/annotation 도구를 지원하고 JSON point로
복원한다. BUY/SELL은 서로 다른 marker와 text로 표시한다.

## Accessibility and performance

- toolbar는 semantic button, visible focus, pressed state와 한국어 accessible name을 갖는다.
- 차트 아래에 현재 OHLCV와 BUY/SELL 신호의 표 대안을 제공한다.
- 360/390/768/1440에서 document overflow가 없고 touch target은 최소 44px다.
- chart chunk는 초기 페이지에서 분리하고 데이터/overlay 변경 시 전체 앱을 rerender하지 않는다.

## Acceptance criteria

지원 도구·지표의 생성/삭제/toggle, 설정 저장·복원, 실시간 candle update, 모바일 pan/zoom과
신호 marker를 실제 브라우저에서 검증한다. `forward` pagination은 오직 더 오래된 timestamp를
반환하고 `backward`는 최신 방향으로만 사용한다. 반복 page fixture에서 요청 횟수가 유한하고
chart의 전체 timestamp가 unique·strictly ascending임을 자동화한다.

지표 catalog의 105종이 모두 추가 가능하고, MA를 두 번 추가해 서로 다른 기간/source/timeframe을
설정해도 독립 instance로 남는다. 설정 dialog의 저장·취소·삭제와 keyboard focus return을
검증한다. 모든 drawing control은 아이콘, visible label/tooltip과 44px target을 가지며 실제
overlay point를 생성한다.
