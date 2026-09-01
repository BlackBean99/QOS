# QOS design system

QOS는 설명형 금융 랜딩이 아니라 바로 조작하는 로컬 리서치 도구다. 화면은 기능과
상태가 스스로 사용법을 드러내게 설계한다.

## First-screen contract

- 첫 뷰포트는 TOSS 실제 종목 검색과 Telegram/monitor 상태를 하나의 command 영역으로
  시작한다. 데스크톱은 나란히, 태블릿·모바일은 검색→자동화 순서로 쌓는다.
- 검색 전에는 실제 종목을 고르거나 저장 전략을 복구하는 두 경로만 강조한다. 프리셋과
  새 전략 저장 폼은 종목을 선택한 뒤에만 노출한다.
- 기본 경로는 실제 종목 검색·선택→진입 신호→기간→거래량→청산 조건을 선택하는
  `빠른 조립`이다. 사용자가 지원 문법을 먼저 배울 필요가 없어야 한다.
- 조작 결과는 같은 화면의 구조도에 즉시 반영한다. 설명문 대신 입력과 결과의 연결로
  기능을 보여준다.
- 자연어는 보조 입력 방식이다. 해석 실패 시 금지 문법을 나열하는 데서 끝내지 않고,
  실행 가능한 완성 예시와 `빠른 조립` 복귀 동작을 제공한다.
- provider·paper 신호·체결 가정은 구조 확인 및 결과 가까이에 둔다. 첫 화면을 긴 면책 문구로
  채우지 않는다.

## Visual language

- Canvas: warm gray paper 위에 off-white panel과 1px structural rule을 사용한다. 짙은 ink는
  global header, automation과 live structure처럼 운용 상태가 집중되는 영역에 제한한다.
- Market chart: 흰 바탕의 옅은 grid를 사용해 고밀도 candle/indicator 판독성을 확보하고,
  surrounding research workspace와 border/type scale로 연결한다.
- Accent: 짙은 teal은 선택, 실행과 구조 연결에만 쓰고 amber는 paper mode, red/blue는
  오류와 시장 방향에 사용한다.
- Type: sans는 한국어 제목/본문, mono는 숫자·상태·시장·단위에 쓴다.
- Shape: 0~2px의 거의 직각인 모서리를 쓴다. 장식적 gradient, 과도한 shadow와 pill card를
  쓰지 않는다.
- Density: 데스크톱은 입력과 live structure를 나란히, 모바일은 같은 순서로 수직 배치한다.
- Motion: hover/focus의 짧은 상태 변화만 허용하고 reduced-motion을 존중한다.

## Components and states

- 선택지는 native radio를 label card로 확장해 키보드와 터치에서 같은 동작을 보장한다.
- 숫자 입력은 값과 단위를 한 덩어리로 보여주고 schema 범위를 벗어나지 않게 제한한다.
- 색만으로 선택·손익·위험을 전달하지 않고 표시, 부호, 텍스트와 패턴을 병용한다.
- 오류는 문제→즉시 가능한 복구 순서로 보여준다. 서버 실패는 입력 오류와 분리한다.
- chart에는 표 대안과 명시적인 단위가 있어야 한다. BUY/SELL은 삼각형 방향, 문자와
  색을 함께 사용하고 표에서 정확한 신호일·체결일·체결가를 읽을 수 있어야 한다.
- 모든 시장 가격 chart는 KLineChart OHLC candle을 기본으로 한다. 상승은 적색, 하락은
  청색이며 범례·정확한 OHLCV와 BUY/SELL 문자/방향을 병용한다. 지표는 검색 dialog에서
  추가하고 같은 종류도 복수 instance로 유지하며 활성 목록에서 설정·개별 삭제한다.
- 지표 설정 dialog는 계산 기간, 지원되는 OHLC/HL2/HLC3/OHLC4 source, 현재 chart/직전
  완료 일봉, 색과 굵기를 제공한다. 설정값은 visible label과 전략 JSON에 그대로 반영한다.
- 추세선, ray/segment/channel, 수평/수직선, price line, 브러시, box, Fibonacci,
  pitchfork, fan과 annotation/tag는 아이콘과 이름이 있는 같은 drawing toolbar에 두고
  저장/복원한다. 확대·축소·화면 맞춤·최신 봉·PNG 저장·전체 화면도 키보드 버튼으로 제공한다.
- 비기본 LLM 파라미터는 모든 실행값을 포함한 고유 이름과 선택 청산선으로 표시한다.
  화면의 run 개수는 Strategy JSON의 실제 exit 개수를 따른다.
- Strategy v3는 검색형 catalog→Preset→Customize→Advanced DSL의 progressive disclosure를
  사용한다. Catalog는 42 Entry·8 Filter·20 Exit의 역할/category/데이터/목적/parameter를
  표시하며 선택한 preset은 별도 엔진이 아니라 editable Rule Group을 추가한다.
- Entry와 Filter는 AND/OR/NOT 중첩, operand output/timeframe/offset/숫자 parameter를 화면에서
  편집하고 64개 중 현재 개수를 계속 표시한다. Exit는 priority·unit·time mode·partial trigger를,
  Risk/Execution은 sizing·circuit breaker·order/cost/tick/intrabar를 같은 흐름에서 편집한다.
- Backtest 뒤 chart marker, stop/target/trailing guide, trade row와 Decision Trace를 연결해
  “왜 진입/청산됐는지”를 값·연산자·PASS/FAIL로 읽을 수 있어야 한다.
- 자연어 연구는 `문장→Strategy JSON 후보→사용자 확인→백테스트` 순서를 건너뛸 수 없다.
  LLM 연결 여부와 reference fallback을 같은 기능처럼 위장하지 않는다.
- 검색 결과 없음, 종목 변경, 실행 중 잠금과 오래된 결과 폐기가 화면 상태로 드러나야 한다.
- 시장이나 검색어가 바뀌면 진행 중인 이전 조회 결과를 폐기한다. 검색 실패는 공급자 메시지와
  시장·티커 확인 또는 TOSS 서버·허용 IP 확인 행동을 함께 보여준다.
- 전략 라이브러리는 목록→read-only JSON view→불러오기/backtest/감시/수정/삭제 순서를
  유지하고 import/export action을 명시적으로 구분한다. 검색 전 recovery mode와 종목 선택 후
  authoring mode를 섞지 않는다.
- Telegram과 monitor는 설정 완료, 연결, running/error와 마지막 heartbeat를 텍스트로
  표시하며 색만으로 동작 여부를 전달하지 않는다. 오류에는 safe code와 별도 monitor process
  재시작 명령을 제공한다.

## Responsive and accessibility

- 최소 360px, 390px, 768px, 1440px에서 가로 overflow 없이 동작해야 한다.
- WCAG 2.2 AA 대비, visible focus, semantic fieldset/legend/label, 44px touch target을 유지한다.
- 첫 화면, 자연어 복구, 구조 확인, 백테스트 결과를 각각 keyboard-only와 axe로 확인한다.
