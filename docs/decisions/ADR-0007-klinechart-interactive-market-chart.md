# ADR-0007: KLineChart 10 for the interactive market chart

## Status

Accepted — 2026-08-23

## Context

Upbit와 유사한 candle/indicator/drawing 경험이 필요하다. TradingView Advanced Charts는
승인된 repository access와 라이선스가 필요한 proprietary 제품이라 현재 비공개 개인 MVP에
사용 승인이 없다. 기존 수제 SVG는 pan/zoom, 지표와 drawing 확장 요구를 감당하지 못한다.

## Decision

Apache-2.0 KLineChart 10을 client-only lazy-loaded market chart runtime으로 채택한다. built-in
indicator와 overlay를 우선 사용하고 rectangle, pitchfork와 fan처럼 부족한 도구만 custom
overlay로 등록한다. Upbit 자체 코드를 복제하지 않고 흰 배경·밝은 grid와 한국식 적색 상승/
청색 하락 visual language만 독립 구현한다. exact value와 signal table을 접근성 대안으로 둔다.

2026-08-25 지표 manager 확장에서 KLineChart built-in 27개와 QOS custom 4개 외 계산은
MIT `@ixjb94/indicators` 1.2.6을 exact pin해 사용한다. catalog는 105개로 제한하고 모든 항목을
실제 KLineChart indicator instance로 생성한다. 저장 계약은 library 내부 이름이 아니라 QOS의
stable instance id/파라미터/source/timeframe/style을 소유한다.

## Alternatives considered

- TradingView Advanced Charts는 기능 범위가 가장 가깝지만 승인된 repository access와
  라이선스가 없어 채택할 수 없다.
- Lightweight Charts는 작고 안정적이지만 요청된 indicator/drawing surface를 대부분 직접
  구현해야 한다.
- 기존 SVG chart 확장은 접근성 표에는 유리하나 pan/zoom/overlay 생태계 요구에 비해
  유지보수 비용이 크다.

## Consequences and risks

- chart runtime은 별도 browser chunk가 되며 bundle/performance gate를 다시 측정한다.
- 확장 계산 dependency는 chart lazy chunk에만 포함하고 upgrade 시 105종 계산·정렬 regression과
  npm audit를 다시 통과해야 한다.
- TradingView와 pixel-identical 또는 proprietary tool parity를 주장하지 않는다.
- KLineChart major upgrade는 saved overlay schema compatibility 검증이 필요하다.

## Revisit when

TradingView 사용 승인을 받거나 KLineChart가 모바일/접근성/성능 예산을 넘거나 필요한
indicator/drawing API를 중단할 때 공식 migration/저장 schema 호환 계획과 함께 재검토한다.
