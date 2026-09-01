# Q-OS

## AI Quant Trading Simulator & Trading Assistant

### Product vision and staged MVP requirements

**Version:** MVP v1.2
**Primary Client:** Responsive Web
**Current Delivery Horizon:** 실제 종목 workspace + configurable indicator manager
**Current Delivery Markets:** TOSS 국내·미국 주식; deterministic fixtures는 계산 회귀 전용
**Development Target:** paper research와 실시간 완성 봉 감시
**Core Principle:** Simple First, Expand Later

## 현재 구현 기준 — Phase 1A walking slice

이 문서는 장기 제품 비전과 후속 phase를 함께 설명한다. 2026-08-22에 착수한 첫
완료 단위는 아래 범위이며, 뒤의 넓은 시장·분봉·Agent·지속 paper trading·live
trading 설명은 해당 기능의 구현 완료를 뜻하지 않는다.

```text
KOSPI/NASDAQ synthetic 종목 검색·선택
  → 선택형 전략 조립 또는 제한된 자연어 입력
  → 동일한 version 1 Strategy JSON 구조화 및 사용자 확인
  → 다음 세션 시가 체결의 historical paper backtest
  → 종가/BUY·SELL 체결, 수익·위험지표, 거래 이유와 가정 검토
```

첫 화면은 설명형 hero나 제품 소개 문단이 아니라 실제 전략 조립기를 제공한다. 종목,
진입 신호, 기간, 거래량과 추적 손절을 선택하면 같은 화면의 구조도가 즉시 갱신되어야
한다. 자연어 해석 실패는 문법 설명으로 끝내지 않고 클릭 가능한 완성 예시와 선택형
조립기로 돌아가는 동작을 제공한다. 결과의 종가와 BUY/SELL 시점은 차트와 표로 함께
제공한다. 세부 원칙은 루트 `DESIGN.md`를 따른다.

현재 비범위:

- 실제 시장 데이터 공급자와 OpenAI 외 LLM provider
- KOSDAQ, BTC, index, 5분 외 분봉과 교차 시장 포트폴리오
- DB 영속성, 인증, 공개 배포와 다중 사용자
- Agent review, scheduler 기반 지속 paper trading, broker와 live trading
- PWA 설치와 push notification

### Phase 1B indicator research

- 가격 chart의 기본 표현은 OHLC candle이다.
- VWAP, EMA, 일목균형표는 가격 overlay, Stochastic RSI는 별도 oscillator panel이다.
- 첫 advanced strategy는 5분봉의 15-session rolling VWAP 상향 돌파 진입이다.
- 일목 기준선, VWAP 즉시/3봉 하향 확인, ATR ×2/×3 trailing, 초기 1.5 ATR 손절을 포함한
  Chandelier, EMA 9/21, 고정 % trailing의 여덟 설정을 동일 synthetic fixture에서 비교한다.
- Strategy v2는 같은 종류의 서로 다른 파라미터를 최대 12개까지 허용하며, UI의 개수·이름과
  선택 청산 overlay는 JSON의 실제 실행 파라미터를 그대로 반영한다.
- Return/MDD/Sharpe/win rate 외에 annualized return, profit factor, 평균 보유시간,
  평균 이익/손실과 MFE/MAE를 계산한다.
- optional OpenAI compiler는 자연어를 Strategy v2 후보로 변환하되 strict schema 재검증과
  사용자 확인 없이는 실행하지 않는다. 기본은 API key가 없는 로컬 reference 변환이며 외부
  호출과 API 비용이 없다. Codex/ChatGPT 로그인은 앱 credential로 재사용하지 않으며, 사용자가
  별도 과금되는 API key를 명시적으로 설정한 경우에만 OpenAI adapter를 사용한다.

### Current implementation contract

- Runtime/package manager: Node.js 20.9 이상과 npm
- Application: 단일 Next.js App Router + TypeScript
- Validation: Zod를 통과한 허용 목록 기반 strategy contract
- Tests: Vitest unit/integration + Playwright browser/accessibility
- Styling/charts: CSS + client-only KLineChart canvas와 accessible HTML 수치/신호 표
- Chart research: 검색 가능한 105종 실제 indicator, 복수 instance 추가·설정·삭제,
  OHLC/composite source·chart/직전 완료 일봉·style 설정과 19개 icon drawing 저장/복원
- Commands: `npm install`, `npm run dev`, `npm run format:check`, `npm run lint`,
  `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run build`,
  `npm run start`

코드는 `app/`의 화면·route handler, `src/domain/`의 framework 독립 전략/백테스트,
`src/fixtures/`의 시장별 synthetic data, `src/components/`의 사용자 UI와 `tests/`,
`e2e/`의 검증으로 나눈다. public API 입력은 runtime schema로 검증하고 사용자 입력이나
모델 생성 코드를 평가하지 않는다. DB, 공급자, 인증, live 주문과 새 production
dependency는 별도 승인과 ADR 전에는 추가하지 않는다.

---

# 1. Product Vision

Q-OS는 사용자가 자연어로 투자 전략을 설명하면 이를 정형화된 Quant Strategy로 변환하고,

**전략 작성 → 백테스트 → 반대 의견 검토 → 포트폴리오 구성 → 모의투자 → 자동매매**

까지 하나의 웹 서비스에서 수행할 수 있도록 하는 AI 기반 매매 시뮬레이터다.

사용자는 Python 코드나 TradingView Pine Script를 직접 작성할 필요가 없다.

예를 들어:

> “15일 VWAP 위로 돌파하면서 거래량이 최근 평균보다 50% 이상 증가하면 매수하고, 고점 대비 4% 하락하거나 VWAP 아래로 다시 내려오면 매도해.”

라고 입력하면 시스템은 이를 프로그램이 실행할 수 있는 전략으로 변환한다.

```text
사용자 자연어
      ↓
LLM Strategy Parser
      ↓
Strategy JSON
      ↓
Backtest Engine
      ↓
Portfolio Engine
      ↓
Agent Review
      ↓
Simulation / Paper / Live
```

---

# 2. MVP 개발 철학

Q-OS MVP는 Institutional Trading Infrastructure를 만드는 프로젝트가 아니다.

목표는:

> **한 명 또는 소수 사용자가 자신의 단기 투자 전략을 빠르게 만들고 검증하고 실제 시장에서 운영할 수 있는 Web Quant Tool**

을 만드는 것이다.

따라서 처음부터 다음 기술은 사용하지 않는다.

## MVP에서 사용하지 않는 기술

- Kafka
- Kubernetes
- Microservice Architecture
- Elasticsearch
- TimescaleDB
- Spark
- Airflow
- Celery
- RabbitMQ
- Redis Cluster
- Vector Database
- 별도 Agent Framework
- 복잡한 Event Sourcing
- HFT Infrastructure

필요해질 때 추가한다.

---

# 3. Target Trading Frequency

Q-OS는 극초단타/HFT를 지원하지 않는다.

목표 매매 주기:

```text
1분
5분
15분
30분
1시간
4시간
1일
```

주 사용 영역:

```text
Intraday
     ↓
Short Swing
     ↓
Several Days
```

밀리초 단위 주문 처리나 Tick 단위 Arbitrage는 고려하지 않는다.

따라서 시스템 목표 Latency는

```text
Milliseconds
```

가 아니라

```text
Seconds
```

수준이다.

---

# 4. Core User Scenario

가장 중요한 User Journey는 다음과 같다.

## STEP 1

사용자가 전략을 입력한다.

> “NASDAQ 종목 중 15일 VWAP을 상향 돌파하고 거래량이 평균 150% 이상이면 매수한다.”

---

## STEP 2

AI가 전략을 구조화한다.

```json
{
  "name": "VWAP Momentum",
  "market": ["NASDAQ"],
  "timeframe": "15m",

  "entry": [
    {
      "indicator": "VWAP",
      "period": 15,
      "operator": "cross_above"
    },
    {
      "indicator": "volume_ratio",
      "period": 20,
      "operator": ">",
      "value": 1.5
    }
  ],

  "exit": [
    {
      "type": "trailing_stop",
      "value": 0.04
    }
  ]
}
```

---

# 5. 핵심 설계 원칙

## LLM은 주문을 직접 생성하지 않는다.

잘못된 구조:

```text
LLM
 ↓
BUY NVDA
```

Q-OS 구조:

```text
LLM
 ↓
Strategy JSON
 ↓
Signal Engine
 ↓
Portfolio
 ↓
Risk Check
 ↓
Order
```

LLM은 전략을 정의하고 분석한다.

실제 매수/매도 여부는 **정해진 Algorithm Code가 판단한다.**

---

# 6. Strategy DSL

MVP에서는 별도의 Programming Language를 만들지 않는다.

**JSON 기반 Strategy Schema**를 사용한다.

장점:

- LLM 생성 용이
- Pydantic Validation 가능
- DB 저장 용이
- UI 수정 가능
- 버전 관리 쉬움
- Codex 구현 난이도 낮음

예:

```json
{
  "name": "Breakout V2",

  "universe": {
    "market": "NASDAQ",
    "min_volume": 1000000
  },

  "timeframe": "15m",

  "entry": {
    "all": [
      {
        "indicator": "rolling_high",
        "period": 20,
        "condition": "close_cross_above"
      },

      {
        "indicator": "volume_sma_ratio",
        "period": 20,
        "condition": ">",
        "value": 2
      }
    ]
  },

  "exit": {
    "any": [
      {
        "type": "trailing_stop",
        "percent": 5
      },

      {
        "indicator": "ema",
        "period": 20,
        "condition": "close_cross_below"
      }
    ]
  }
}
```

---

# 7. Strategy Creation

화면:

```text
┌───────────────────────────────────────────────┐
│ CREATE STRATEGY                               │
│                                               │
│ 투자 전략을 설명하세요                        │
│                                               │
│ ┌───────────────────────────────────────────┐ │
│ │ 15일 VWAP 돌파 + 거래량 증가 시 매수... │ │
│ │                                           │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│                  Generate Strategy            │
└───────────────────────────────────────────────┘
```

LLM 결과:

```text
VWAP Momentum Strategy

MARKET
NASDAQ

TIMEFRAME
15 MIN

ENTRY
✓ Price > VWAP15
✓ Volume > Avg Volume × 1.5

EXIT
✓ Trailing Stop 4%

[Edit]

[Run Backtest]
```

---

# 8. Strategy Library

생성된 전략은 저장한다.

```text
STRATEGIES

VWAP Momentum V3
+18.4%
MDD -7.1%
Sharpe 1.44

Momentum Breakout
+27.8%
MDD -14.2%
Sharpe 1.28

BTC Trend
+41.2%
MDD -22.8%
Sharpe 1.19
```

전략 상태:

```text
DRAFT

BACKTESTED

PAPER

LIVE

PAUSED
```

---

# 9. Strategy Versioning

복잡한 Git 시스템을 구현하지 않는다.

Strategy를 수정하면 새로운 Version row를 생성한다.

예:

```text
VWAP Momentum

V1
VWAP Breakout

V2
+ Volume Filter

V3
+ Trailing Stop

V4
+ RSI Filter
```

DB:

```text
strategy

strategy_version
```

관계로만 관리한다.

---

# 10. Strategy Editor

LLM 결과를 그대로 사용할 필요는 없다.

UI에서 다음 값을 직접 수정할 수 있어야 한다.

```text
VWAP Period
15

Volume Ratio
1.5

Trailing Stop
4%

Timeframe
15m

Max Position
10%
```

수정 후:

```text
SAVE AS V4
```

---

# 11. Automatic Universe Selection

사용자가 전략만 입력하고 종목을 지정하지 않아도 된다.

예:

> “NASDAQ에서 Momentum이 좋은 종목을 매매해.”

Q-OS가 Universe를 생성한다.

MVP 조건:

```text
Market

KOSPI
KOSDAQ
NASDAQ
BTC
```

필터:

```text
거래량

가격

시가총액

변동성

Momentum
```

---

# 12. Portfolio Auto Construction

전략에서 여러 종목 Signal이 발생하면 투자 비중을 자동 결정한다.

MVP에서는 복잡한 Optimization을 구현하지 않는다.

지원:

## Equal Weight

```text
4 종목 선택

각각
25%
```

---

## Score Weight

Signal Score에 따라 비중을 결정한다.

```text
NVDA     90 Score → 35%

AMD      78 Score → 28%

MSFT     70 Score → 22%

META     51 Score → 15%
```

---

## Volatility Weight

변동성이 높은 종목의 비중을 낮춘다.

---

# 13. Portfolio Constraints

사용자가 설정한다.

```text
Seed

₩10,000,000


Maximum Stocks

5


Maximum Position

25%


Minimum Cash

10%


Crypto Maximum

20%
```

---

# 14. Backtest Engine

MVP Backtester는 자체 Python Engine으로 만든다.

대형 Quant Framework를 의존하지 않는다.

사용:

```text
pandas

numpy
```

핵심 기능:

```text
OHLCV 입력

Indicator 계산

Signal 계산

Position 생성

PnL 계산

Fee 계산

Slippage 계산
```

---

# 15. Supported Orders

MVP:

```text
Market

Limit

Stop Loss

Trailing Stop
```

초기에는 복잡한 Order Book Simulation은 하지 않는다.

---

# 16. Trading Cost

Backtest 설정:

```text
Commission

0.015%


Slippage

0.05%


Tax

Market별 설정
```

---

# 17. Backtest Metrics

최소 제공:

```text
Total Return

CAGR

Maximum Drawdown

Sharpe Ratio

Sortino Ratio

Win Rate

Profit Factor

Average Profit

Average Loss

Number of Trades

Average Holding Time
```

---

# 18. Benchmark

전략 결과를 Benchmark와 비교한다.

예:

```text
VWAP Strategy

+31.4%


NASDAQ

+19.8%


Alpha

+11.6%
```

---

# 19. Equity Curve

가장 중요한 Dashboard Chart다.

```text
Portfolio

120 ┤             ╭─────
    │        ╭────╯
110 ┤    ╭───╯
    │ ╭──╯
100 ┼─╯

     JAN      JUN      DEC
```

동시에 Benchmark 표시.

---

# 20. Drawdown Chart

```text
0%

──────────────

      ╲
-5%    ╲____

           ╲

-10%        ╲____
```

---

# 21. Trade History

```text
NVDA

BUY
184.20

SELL
193.12

RETURN
+4.84%

HOLD
2 Days
```

Trade를 클릭하면 왜 거래했는지도 보여준다.

---

# 22. Explainable Trade

예:

```text
NVDA BUY

2026-08-21 10:45

ENTRY CONDITIONS

✓ VWAP15 Breakout

✓ Volume Ratio > 1.5

✓ Momentum Score > 70

Portfolio Position

18%
```

LLM의 설명이 아니라 **실제 Strategy Engine에서 사용된 조건**을 표시한다.

---

# 23. Multi-Agent Review

MVP에서는 10개의 Agent를 만들지 않는다.

최소 4개 Agent만 사용한다.

```text
QUANT

LONG

SHORT

RISK
```

---

# 24. Quant Agent

질문:

> 이 전략의 통계적 약점은 무엇인가?

분석:

```text
거래 횟수

Drawdown

Outlier dependence

Parameter sensitivity

시장 의존성
```

---

# 25. Long Agent

질문:

> 이 전략이 성공할 가능성이 있는 이유는 무엇인가?

Bull Case를 작성한다.

---

# 26. Short Agent

질문:

> 이 전략이 실패할 가능성이 있는 이유는 무엇인가?

Bear Case를 작성한다.

---

# 27. Risk Agent

질문:

> 실제 Seed를 투입할 경우 가장 위험한 부분은 무엇인가?

Risk를 평가한다.

---

# 28. Agent Independence

Agent들은 서로의 결과를 먼저 보지 않는다.

```text
          Strategy

             │

 ┌───────────┼─────────────┐

 │           │             │

Quant       Long          Short

 │           │             │

 └───────────┼─────────────┘

             │

           Risk

             │

         Summary
```

Long Agent가 먼저 말하고 Short Agent가 반박하는 구조는 사용하지 않는다.

---

# 29. Agent 구현 방식

별도의 Agent Framework는 사용하지 않는다.

다음과 같이 단순하게 구현한다.

```python
quant_review(strategy, result)

long_review(strategy, result)

short_review(strategy, result)

risk_review(strategy, result)
```

각 함수 내부에서 LLM 호출.

Agent 결과는 JSON으로 반환한다.

```json
{
  "position": "SHORT",
  "confidence": 72,

  "reasons": ["High drawdown", "Performance concentrated in bull regime"]
}
```

---

# 30. Agent Dashboard

```text
AI REVIEW

LONG

72%


SHORT

64%


QUANT

58 / 100


RISK

HIGH
```

하단:

```text
Bull Case

Bear Case

Quant Concerns

Risk Factors
```

모두 같은 화면에 표시한다.

---

# 31. Groupthink 방지

최종 Consensus만 크게 보여주지 않는다.

예:

```text
Overall

NEUTRAL


LONG

Strong Momentum


SHORT

Poor Bear Market Performance


RISK

Drawdown Risk
```

반대 의견을 항상 같은 수준으로 노출한다.

---

# 32. Backtest Validation

MVP에서도 최소한 다음 두 개는 지원한다.

## Train/Test Split

예:

```text
2020 ───── 2024 │ 2025 ───── 2026

     BACKTEST    │ OUT OF SAMPLE
```

---

## Parameter Sensitivity

예:

```text
VWAP

10 → +14%

15 → +18%

20 → +17%

30 → +4%
```

특정 숫자에서만 성능이 지나치게 높으면 경고한다.

```text
Possible Overfitting
```

---

# 33. Paper Trading

Broker API가 없어도 사용할 수 있어야 한다.

사용자:

```text
Virtual Seed

₩10,000,000
```

선택:

```text
START PAPER TRADING
```

시스템:

```text
Market Data
      ↓
Strategy Engine
      ↓
Signal
      ↓
Virtual Order
      ↓
Virtual Position
      ↓
PnL
```

---

# 34. Paper Trading Frequency

초단타가 아니므로 실시간 Tick Stream이 필수는 아니다.

예:

15분 전략이면

```text
15분 Candle Close
      ↓
Strategy Evaluation
```

1시간 전략이면

```text
1시간 Candle Close
      ↓
Strategy Evaluation
```

만 수행한다.

---

# 35. Scheduler

Kafka나 Celery 대신 Python Scheduler를 사용한다.

MVP:

```text
APScheduler
```

예:

```text
09:00
Market Open

09:15
Strategy Run

09:30
Strategy Run

09:45
Strategy Run
```

---

# 36. Job Architecture

DB에 간단한 Job 상태를 저장한다.

```text
jobs

id

type

status

created_at

started_at

finished_at

result
```

Status:

```text
PENDING

RUNNING

DONE

FAILED
```

---

# 37. Backtest 실행

사용자:

```text
RUN BACKTEST
```

Backend:

```text
Create Job

↓

Background Task

↓

Backtest

↓

Save Result

↓

Frontend Polling
```

Frontend는:

```text
GET /jobs/{id}
```

를 몇 초마다 호출한다.

Kafka/WebSocket이 필요 없다.

---

# 38. Realtime UI

초기에는 WebSocket을 강제하지 않는다.

기본:

```text
Polling
```

예:

```text
Portfolio

5 sec

Orders

5 sec

Positions

5 sec

Strategy Status

10 sec
```

이 정도면 단기 매매 시스템에는 충분하다.

---

# 39. Live Trading

Live Trading은 MVP 다음 단계지만 처음부터 Adapter Interface를 준비한다.

```text
BrokerAdapter

get_balance()

get_positions()

place_order()

cancel_order()

get_orders()
```

---

# 40. Broker 구현

향후:

```text
BrokerAdapter

├ KoreanBrokerAdapter

├ USBrokerAdapter

└ CryptoExchangeAdapter
```

Strategy Engine은 Broker 종류를 몰라야 한다.

---

# 41. Simulation / Paper / Live

세 Mode는 같은 Strategy Engine을 사용한다.

```text
             Strategy Engine

                    │

         ┌──────────┼──────────┐

         │          │          │

       BACKTEST    PAPER       LIVE
```

다른 것은 Execution Adapter뿐이다.

---

# 42. Live Safety

실거래에서는 다음 설정을 반드시 적용한다.

```text
Daily Loss Limit

Maximum Position

Maximum Portfolio Exposure

Maximum Orders Per Strategy

Maximum Slippage

Strategy Kill Switch
```

---

# 43. Mobile Control

Q-OS는 별도 모바일 앱을 만들지 않는다.

**Responsive Web + PWA**

방식을 사용한다.

---

# 44. Mobile 핵심 화면

모바일에서는 모든 연구 기능을 보여주려고 하지 않는다.

핵심 Control 기능 중심이다.

```text
Q-OS

Portfolio
₩10,428,100

Today
+1.84%


ACTIVE STRATEGIES

VWAP Momentum
● PAPER

BTC Trend
● LIVE
```

---

# 45. Mobile Position

```text
NVDA

Position

₩1,820,000

PnL

+4.2%


[VIEW]

[CLOSE]
```

---

# 46. Mobile Strategy Control

```text
VWAP Momentum

● RUNNING


Current Position

NVDA

AMD


[P A U S E]
```

---

# 47. Emergency Button

모바일에서도 항상 접근 가능하게 한다.

```text
STOP LIVE TRADING
```

단순 UI 실수 방지를 위해 확인창:

```text
Stop all automated trading?

[Cancel]

[STOP]
```

---

# 48. PWA

Frontend는 Progressive Web App으로 구성한다.

사용자는 모바일 브라우저에서:

```text
홈 화면에 추가
```

하여 앱처럼 실행할 수 있다.

지원:

```text
Responsive UI

Standalone Mode

Push Notification — Later

Offline Shell — Optional
```

---

# 49. Main Dashboard

Desktop:

```text
┌──────────────────────────────────────────────────────────┐
│ Q-OS     KOSPI +1.2%  NASDAQ +0.8% BTC +2.1%    PAPER │
├───────────┬──────────────────────────┬───────────────────┤
│ Portfolio │ Equity Curve             │ Strategies        │
│           │                          │                   │
│ ₩12.4M    │       ╭────────          │ VWAP       +8.2% │
│ +12.4%    │ ──────╯                  │ BTC Trend +11.4% │
├───────────┼──────────────────────────┼───────────────────┤
│ Positions │ Recent Signals           │ AI Review         │
│           │                          │                   │
│ NVDA      │ NVDA BUY                 │ LONG 61%          │
│ BTC       │ BTC HOLD                 │ SHORT 39%         │
├───────────┴──────────────────────────┴───────────────────┤
│ Recent Trades                                             │
└──────────────────────────────────────────────────────────┘
```

---

# 50. Design Direction

키워드:

**Bloomberg Intelligence × Modern Fintech × Developer Tool**

Bloomberg처럼 많은 정보를 보여주되 UI를 복잡하게 만들지 않는다.

---

# 51. 디자인 원칙

## Dark First

Trading 화면 기본:

```text
Background

#090B0F


Surface

#11151B


Border

#242A33
```

---

## 의미 기반 색상

```text
Green
Profit / Long

Red
Loss / Short

Orange
Risk

Blue
Information

Purple
AI
```

---

# 52. Card UI

모든 정보를 하나의 거대한 Terminal Screen에 넣지 않는다.

```text
Portfolio Card

Strategy Card

Risk Card

Agent Card

Position Card
```

으로 구성한다.

---

# 53. Desktop / Mobile 동일 디자인 시스템

Desktop:

```text
3 Column Grid
```

Tablet:

```text
2 Column Grid
```

Mobile:

```text
1 Column
```

으로 자동 변경한다.

---

# 54. Technology Stack

Phase 1A는 다음 한 package로 제한한다.

```text
Next.js App Router
TypeScript
Zod
CSS
accessible SVG
```

Tailwind CSS, shadcn/ui, TanStack Query와 chart library는 첫 화면에 필요한 복잡성이
입증되지 않아 추가하지 않는다. 서버 상태는 한 화면의 명시적 request state로 관리한다.

---

# 55. Backend

Phase 1A의 HTTP 경계는 같은 Next.js process의 route handler다. 전략 해석과 backtest는
route에서 분리된 순수 TypeScript domain module이다. 실제 다종목 데이터에서 성능 또는
Python quant 생태계의 필요가 측정되면 FastAPI/pandas engine을 별도 ADR로 재검토한다.

---

# 56. Database

Phase 1A에는 DB가 없다. fixture와 실행 결과는 process/request 범위이며 영속 전략,
version row와 실행 history가 다음 acceptance criteria가 될 때 PostgreSQL과 migration
방식을 결정한다. Redis, TimescaleDB와 MongoDB는 현재 사용하지 않는다.

---

# 57. Scheduler

Historical backtest에는 scheduler를 사용하지 않는다. 지속 paper trading phase에서
캔들 마감 실행, 중복 방지, 복구 요구를 먼저 정한 뒤 선택한다.

---

# 58. LLM Integration

Phase 1A는 외부 LLM을 호출하지 않고 지원된 한국어/영어 구문을 제한된 parser로
구조화한다. 향후 LLM을 추가해도 서버에서만 호출하고 결과는 같은 Strategy schema와
허용 목록 validation을 통과해야 한다. API key는 브라우저에 전달하지 않는다.

---

# 59. Overall Architecture

현재 구조:

```text
Responsive browser
  → Next.js page and route handlers
    → synthetic instrument catalog/search and bounded strategy validator
      → stable instrumentId
        → deterministic daily backtester
          → versioned KOSPI/NASDAQ synthetic instrument fixtures
```

후속 provider, persistence, Agent, paper scheduler와 broker는 현재 구조가 아니다.

---

# 60. Deployment Architecture

Phase 1A는 로컬 production build를 단일 Node.js process로 실행한다. 공개 배포 대상과
컨테이너 운영은 아직 선택하지 않는다.

---

# 61. Docker Compose

첫 슬라이스에는 Docker Compose가 필요하지 않다. 외부 DB나 별도 계산 process가 실제로
채택될 때 재현 가능한 개발 환경으로 추가한다.

---

# 62. Repository layout

```text
qos/
├ app/             # Next.js pages and HTTP route handlers
├ src/components/  # responsive user workflow and visualizations
├ src/domain/      # strategy and backtest contracts/calculation
├ src/fixtures/    # versioned synthetic market data
├ tests/           # unit and integration tests
├ e2e/             # browser and accessibility tests
└ docs/            # product, architecture and decisions
```

---

# 63. Application 내부 구조

Microservice가 아닌 한 애플리케이션 안에서 UI, HTTP boundary, strategy domain,
backtest domain과 fixture data를 module로 분리한다. 후속 module은 acceptance criteria가
생길 때 추가한다.

---

# 64. 주요 DB Entity

MVP에서는 다음 정도로 제한한다.

```text
User

Strategy

StrategyVersion

BacktestRun

Trade

Portfolio

Position

Order

AgentReview

PaperAccount

Job
```

---

# 65. Strategy

```text
Strategy

id

name

description

market

status

created_at
```

---

# 66. StrategyVersion

```text
StrategyVersion

id

strategy_id

version

strategy_json

prompt

created_at
```

---

# 67. BacktestRun

```text
BacktestRun

id

strategy_version_id

start_date

end_date

seed

total_return

mdd

sharpe

status
```

---

# 68. Trade

```text
Trade

id

backtest_id

symbol

entry_time

entry_price

exit_time

exit_price

quantity

pnl

pnl_percent
```

---

# 69. AgentReview

```text
AgentReview

id

strategy_version_id

backtest_id

role

position

confidence

analysis
```

---

# 70. Paper Account

```text
PaperAccount

id

cash

initial_seed

equity

created_at
```

---

# 71. API 설계

## Strategy

```text
POST
/api/strategies/generate

GET
/api/strategies

GET
/api/strategies/{id}

POST
/api/strategies/{id}/versions
```

---

# 72. Backtest

```text
POST
/api/backtests

GET
/api/backtests/{id}

GET
/api/backtests/{id}/trades
```

---

# 73. Agent

```text
POST
/api/backtests/{id}/review

GET
/api/backtests/{id}/reviews
```

---

# 74. Portfolio

```text
POST
/api/portfolio/build

GET
/api/portfolio
```

---

# 75. Paper Trading

```text
POST
/api/paper/start

POST
/api/paper/stop

GET
/api/paper/account

GET
/api/paper/positions

GET
/api/paper/orders
```

---

# 76. Mobile API

별도 모바일 API를 만들지 않는다.

Desktop Web과 같은 REST API를 사용한다.

---

# 77. MVP Screen

MVP에서는 화면도 최소화한다.

총 7개다.

```text
1 Dashboard

2 Strategies

3 Strategy Builder

4 Backtest Result

5 AI Review

6 Paper Trading

7 Settings
```

---

# 78. Dashboard

목표:

**현재 Portfolio 상태를 5초 안에 이해**

표시:

```text
Portfolio Value

Today PnL

Total PnL

Active Strategies

Current Positions

Recent Signals

Risk Status
```

---

# 79. Strategies

```text
Strategy

Return

MDD

Sharpe

Status
```

정렬:

```text
Return

Risk

Updated

Status
```

---

# 80. Strategy Detail

상단:

```text
VWAP Momentum V4

BACKTESTED
```

Tab:

```text
Overview

Rules

Backtest

AI Review

Versions
```

---

# 81. Backtest Screen

상단 KPI:

```text
Return

MDD

Sharpe

Win Rate

Trades
```

중앙:

```text
Equity Curve
```

하단:

```text
Drawdown

Monthly Return

Trade List
```

---

# 82. Paper Dashboard

```text
Virtual Portfolio

₩10,428,200

Today

+1.8%


Positions

NVDA      +4.2%

AMD       -0.7%

BTC       +1.4%
```

---

# 83. Market Data Layer

Market Data도 Adapter로 만든다.

```text
MarketDataProvider

get_candles()

get_quote()

get_symbols()
```

Provider를 나중에 바꿀 수 있어야 한다.

---

# 84. Market Data Cache

초기에는 별도 Cache Server를 두지 않는다.

Backend:

```text
data/cache/
```

에 Parquet 또는 CSV로 저장할 수 있다.

예:

```text
NASDAQ_NVDA_15m.parquet
```

Historical Backtest마다 API를 다시 호출하지 않는다.

---

# 85. 데이터 저장 방식

Market Data:

```text
Parquet
```

Application Data:

```text
PostgreSQL
```

로 분리한다.

이렇게 하면 PostgreSQL에 수백만 개 Candle을 처음부터 넣을 필요가 없다.

---

# 86. Backtest Performance

MVP 목표는:

```text
수십 종목

수년 데이터

분봉 / 시간봉

1 Strategy
```

정도를 개인 서버에서 실행할 수 있는 수준이다.

대규모 Distributed Backtesting은 MVP 범위가 아니다.

---

# 87. Security

Broker API Key는 서버에만 저장한다.

절대로:

```text
Browser

LocalStorage

Strategy JSON

LLM Prompt
```

에 포함하지 않는다.

---

# 88. MVP Broker Secret

초기 개인용 환경에서는:

```text
.env
```

사용 가능.

Production 단계에서는 별도 Secret Management로 교체한다.

---

# 89. Live Trading Approval

LLM이나 Agent가 전략을 자동으로 LIVE로 전환할 수 없다.

반드시:

```text
USER APPROVAL
```

이 필요하다.

---

# 90. Live Trading Flow

```text
Strategy

↓

Signal

↓

Portfolio Calculation

↓

Risk Check

↓

Order Proposal

↓

Broker Adapter

↓

Order
```

---

# 91. Kill Switch

상태를 DB에 저장한다.

```text
trading_enabled = false
```

이면 어떤 Scheduler도 주문을 생성하지 않는다.

---

# 92. Risk Engine

MVP에서는 복잡한 VaR Engine 대신 단순하지만 강력한 Rule 기반으로 만든다.

```text
max_daily_loss

max_position_percent

max_total_exposure

max_strategy_exposure

max_drawdown

max_open_positions
```

---

# 93. Notification

MVP 초기에는 Dashboard 알림만 제공한다.

향후:

```text
Push

Telegram

Slack

Email
```

등을 추가한다.

---

# 94. Product roadmap scope

아래 항목은 전체 roadmap이며 Phase 1A의 동시 완료 조건이 아니다. 현재 반드시 구현할
항목은 Natural Language Strategy의 제한된 parser, Strategy JSON 확인, bundled
Historical Data, 단일 자산 Backtest, Performance Dashboard와 Mobile Web이다.

## 단계적으로 구현

```text
Natural Language Strategy

Strategy JSON

Strategy Save

Version

Historical Data

Backtest

Portfolio Construction

Performance Dashboard

Long Agent

Short Agent

Quant Agent

Risk Agent

Paper Trading

Mobile Web

PWA
```

---

# 95. MVP에서 제외

```text
HFT

Tick Trading

Options

Futures

Short Selling Execution

Margin

Leverage

Order Book Simulation

Machine Learning Training

Reinforcement Learning

Automatic Strategy Mining

Social Trading

Copy Trading

Multi User Organization

Complex IAM
```

---

# 96. Phase 1

## Quant Simulator

먼저 이것만 완성한다.

```text
Strategy Prompt

↓

Strategy JSON

↓

Historical Data

↓

Backtest

↓

Portfolio

↓

Dashboard
```

이 단계는 Broker가 없어도 완전히 동작한다.

---

# 97. Phase 2

## AI Review

추가:

```text
Quant

Long

Short

Risk
```

Agent Review.

---

# 98. Phase 3

## Paper Trading

```text
Scheduler

↓

Market Data

↓

Strategy

↓

Virtual Portfolio
```

---

# 99. Phase 4

## Live Trading

마지막에 Broker Adapter를 연결한다.

```text
PaperAdapter
      ↓

RealBrokerAdapter
```

로 교체한다.

---

# 100. Codex 개발 원칙

Codex에게 다음 원칙을 프로젝트 전체 Rule로 제공한다.

### Rule 1

**Do not introduce infrastructure unless required.**

---

### Rule 2

기본 Architecture는:

```text
Next.js

FastAPI

PostgreSQL
```

3개를 넘기지 않는다.

---

### Rule 3

새로운 라이브러리를 추가하기 전에 기존 코드로 구현 가능한지 확인한다.

---

### Rule 4

Microservice를 생성하지 않는다.

---

### Rule 5

MQ를 사용하지 않는다.

---

### Rule 6

복잡한 Abstract Layer를 만들지 않는다.

필요한 Interface만 만든다.

예:

```text
MarketDataProvider

BrokerAdapter
```

---

### Rule 7

Backtest / Paper / Live는 같은 Strategy Evaluation Code를 공유한다.

코드를 각각 다시 만들지 않는다.

---

### Rule 8

LLM 결과를 신뢰하지 않는다.

모든 Strategy JSON은:

```text
Pydantic
```

으로 Validate한다.

---

### Rule 9

LLM이 생성한 Python Code를 서버에서 직접 실행하지 않는다.

LLM은 허용된 Strategy JSON만 생성할 수 있다.

---

### Rule 10

모든 투자 결정에는 이유를 추적할 수 있어야 한다.

```text
Signal

↓

Condition

↓

Order
```

추적 가능해야 한다.

---

# 101. Codex 구현 우선순위

현재 delivery는 다음 순서로 구현한다. DB, 외부 LLM과 지속 paper trading은 acceptance
criteria와 공급자가 정해진 후 별도 phase에서 추가한다.

```text
1. Project Skeleton

2. Strategy Schema + Validation

3. Bounded Strategy Parser

4. Versioned Market Fixtures

5. Indicator / Signal Engine

6. Deterministic Backtest Engine

7. Backtest API Boundary

8. Accessible Responsive Dashboard

9. Browser / Accessibility / Production Verification

10. Persistence Decision

11. External Market Data / LLM Decision

12. Portfolio Engine

13. Agent Review

14. Persistent Paper Trading

15. PWA

16. Broker Adapter
```

Live Trading부터 구현하면 안 된다.

---

# 102. Definition of Done — Strategy

사용자가 다음 문장을 입력한다.

> “NASDAQ에서 20일 고점 돌파하고 거래량이 평균 2배 이상이면 매수, 5% trailing stop.”

시스템이:

```text
Strategy JSON 생성

↓

Validation

↓

저장

↓

UI 표시
```

하면 완료.

---

# 103. Definition of Done — Backtest

사용자가:

```text
Seed

₩10,000,000


Period

2023 → 2026
```

선택 후 실행.

결과:

```text
Return

MDD

Sharpe

Win Rate

Equity Curve

Trade History
```

가 표시되면 완료.

---

# 104. Definition of Done — AI Review

같은 Backtest 결과에 대해:

```text
Long

Short

Quant

Risk
```

4개의 독립 의견이 생성되고,

사용자가 각각의 의견을 확인할 수 있으면 완료.

---

# 105. Definition of Done — Paper Trading

사용자가:

```text
Virtual Seed

₩10,000,000
```

을 입력하고 Strategy를 시작한다.

Scheduler가 시장 데이터를 조회하고 Strategy를 평가한다.

Signal 발생 시:

```text
Virtual Order

↓

Position

↓

PnL
```

가 자동 변경되면 완료.

---

# 106. Definition of Done — Mobile

스마트폰 브라우저에서:

```text
Dashboard 확인

Strategy 상태 확인

Position 확인

Paper Start / Stop

Live Pause

Emergency Stop
```

이 가능하면 완료.

---

# 107. MVP 최종 구조

Q-OS MVP는 본질적으로 다음 시스템이다.

```text
┌──────────────────────────────┐
│      Next.js PWA             │
│                              │
│ Desktop + Mobile Web         │
└───────────────┬──────────────┘
                │
                │ REST
                │
┌───────────────▼──────────────┐
│        FastAPI               │
│                              │
│ Strategy                     │
│ Backtest                     │
│ Portfolio                    │
│ Agent                        │
│ Paper Trading                │
│ Risk                         │
│ Scheduler                    │
└──────┬───────────────┬───────┘
       │               │
       │               │
 PostgreSQL      Market/Broker API
```

추가 Infrastructure는 없다.

---

# 108. 핵심 제품 철학

Q-OS는 AI에게

> “오늘 무슨 주식을 살까?”

를 질문하는 제품이 아니다.

사용자가

> “나는 이런 조건에서 가격이 오를 것이라고 생각한다.”

라는 투자 가설을 제시하면,

Q-OS가 이를

```text
Hypothesis

↓

Executable Strategy

↓

Backtest

↓

Portfolio

↓

Bull Argument

↓

Bear Argument

↓

Risk Review

↓

Paper Trading

↓

Live Trading
```

으로 변환한다.

그리고 가장 중요한 원칙은:

> **AI는 전략을 제안하지만, 프로그램이 전략을 실행한다.**

이다.

---

# 109. MVP 한 줄 정의

> **자연어 투자 아이디어를 실행 가능한 Quant Strategy로 변환하고, 백테스트·반대 논리 검증·포트폴리오 구성·모의투자까지 수행하는 모바일 대응 경량 Web Quant Platform.**

---

# 110. 개발 방향 요약

Q-OS MVP의 기술적인 목표는 뛰어난 분산 시스템을 만드는 것이 아니다.

**Codex가 이해하기 쉽고, 수정하기 쉽고, 혼자서도 운영할 수 있는 코드베이스**를 만드는 것이다.

따라서 시작점은 반드시:

```text
Next.js
+
FastAPI
+
PostgreSQL
+
APScheduler
```

정도로 유지한다.

그리고 실제 사용자가 늘거나 처리량이 증가해 병목이 **실제로 관측되었을 때만**

```text
Redis

Queue

Worker

Streaming

Microservice
```

등을 도입한다.

**Scale before complexity가 아니라, Complexity only after scale.**
