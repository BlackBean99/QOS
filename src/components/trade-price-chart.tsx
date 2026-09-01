"use client";

import { useId } from "react";

import type { BacktestTrade, PricePoint } from "@/src/domain/backtest";

interface TradePriceChartProps {
  points: PricePoint[];
  trades: BacktestTrade[];
  symbol: string;
  currency: string;
}

interface TradeMarker {
  key: string;
  side: "BUY" | "SELL";
  signalDate: string;
  fillDate: string;
  price: number;
  reason: string;
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
}

function createMarkers(trades: BacktestTrade[]): TradeMarker[] {
  return trades.flatMap((trade, index) => {
    const markers: TradeMarker[] = [
      {
        key: `${index}-buy-${trade.entryDate}`,
        side: "BUY",
        signalDate: trade.signalDate,
        fillDate: trade.entryDate,
        price: trade.entryPrice,
        reason: trade.reasons.join(" · "),
      },
    ];

    if (trade.exitDate && trade.exitPrice !== undefined) {
      markers.push({
        key: `${index}-sell-${trade.exitDate}`,
        side: "SELL",
        signalDate: trade.exitSignalDate ?? trade.exitDate,
        fillDate: trade.exitDate,
        price: trade.exitPrice,
        reason: "Trailing stop · 다음 fixture 세션 시가 체결",
      });
    }

    return markers;
  });
}

export function TradePriceChart({ points, trades, symbol, currency }: TradePriceChartProps) {
  const id = useId().replace(/:/g, "");
  const markers = createMarkers(trades);
  const width = 960;
  const height = 320;
  const paddingX = 34;
  const paddingY = 42;
  const dates = new Map(points.map((point, index) => [point.date, index]));
  const values = [
    ...points.flatMap((point) => [point.low, point.high]),
    ...markers.map((marker) => marker.price),
  ];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const xForDate = (date: string) => {
    const index = dates.get(date) ?? 0;
    return paddingX + (index / Math.max(points.length - 1, 1)) * (width - paddingX * 2);
  };
  const yForPrice = (price: number) =>
    height - paddingY - ((price - minimum) / range) * (height - paddingY * 2);
  const candleWidth = Math.max(2, (width - paddingX * 2) / points.length - 1);

  return (
    <>
      <figure
        className="chart trade-price-chart"
        aria-label={`${symbol} 가격 차트 가로 스크롤 영역`}
        tabIndex={0}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${id}-title ${id}-desc`}
        >
          <title id={`${id}-title`}>{symbol} synthetic OHLC 캔들과 매수·매도 시점</title>
          <desc id={`${id}-desc`}>
            {points[0]?.date}부터 {points.at(-1)?.date}까지의 synthetic OHLC 캔들에 BUY 삼각형과
            SELL 역삼각형으로 {markers.length}개 체결을 표시합니다. 정확한 날짜와 가격은 아래 표에서
            확인할 수 있습니다.
          </desc>
          <g className="chart-grid" aria-hidden="true">
            <line x1={paddingX} x2={width - paddingX} y1={paddingY} y2={paddingY} />
            <line x1={paddingX} x2={width - paddingX} y1={height / 2} y2={height / 2} />
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={height - paddingY}
              y2={height - paddingY}
            />
          </g>
          <g className="candles" aria-hidden="true">
            {points.map((point) => {
              const x = xForDate(point.date);
              const openY = yForPrice(point.open);
              const closeY = yForPrice(point.close);
              const rising = point.close >= point.open;
              return (
                <g className={rising ? "candle-up" : "candle-down"} key={point.date}>
                  <line x1={x} x2={x} y1={yForPrice(point.high)} y2={yForPrice(point.low)} />
                  <rect
                    x={x - candleWidth / 2}
                    y={Math.min(openY, closeY)}
                    width={candleWidth}
                    height={Math.max(1.5, Math.abs(openY - closeY))}
                  />
                </g>
              );
            })}
          </g>
          {markers.map((marker) => {
            const x = xForDate(marker.fillDate);
            const y = yForPrice(marker.price);
            const pointsAttribute =
              marker.side === "BUY"
                ? `${x},${y - 11} ${x - 9},${y + 6} ${x + 9},${y + 6}`
                : `${x},${y + 11} ${x - 9},${y - 6} ${x + 9},${y - 6}`;

            return (
              <g
                className={`trade-marker trade-marker-${marker.side.toLowerCase()}`}
                data-trade-marker={marker.side}
                key={marker.key}
                aria-hidden="true"
              >
                <polygon points={pointsAttribute} />
                <text x={x} y={marker.side === "BUY" ? y + 21 : y - 13} textAnchor="middle">
                  {marker.side === "BUY" ? "B" : "S"}
                </text>
              </g>
            );
          })}
        </svg>
        <figcaption className="trade-chart-caption">
          <span>{points[0]?.date}</span>
          <strong>OHLC CANDLE · ▲ BUY · ▼ SELL</strong>
          <span>{points.at(-1)?.date}</span>
        </figcaption>
      </figure>

      <div className="trade-chart-legend" aria-hidden="true">
        <span className="legend-close">▯ OHLC</span>
        <span className="legend-buy">▲ BUY</span>
        <span className="legend-sell">▼ SELL</span>
      </div>

      <div
        className="table-scroll trade-marker-table-wrap"
        role="region"
        aria-label="매수·매도 시점 표 가로 스크롤 영역"
        tabIndex={0}
      >
        <table className="trade-marker-table" aria-label="매수·매도 시점">
          <thead>
            <tr>
              <th scope="col">구분</th>
              <th scope="col">신호일</th>
              <th scope="col">체결일</th>
              <th scope="col">체결가</th>
              <th scope="col">근거</th>
            </tr>
          </thead>
          <tbody>
            {markers.length === 0 ? (
              <tr>
                <td colSpan={5}>이 전략에서 식별된 매수·매도 체결이 없습니다.</td>
              </tr>
            ) : (
              markers.map((marker) => (
                <tr key={marker.key}>
                  <td>
                    <strong className={`trade-side trade-side-${marker.side.toLowerCase()}`}>
                      {marker.side === "BUY" ? "▲ BUY" : "▼ SELL"}
                    </strong>
                  </td>
                  <td>{marker.signalDate}</td>
                  <td>{marker.fillDate}</td>
                  <td>{formatCurrency(marker.price, currency)}</td>
                  <td>{marker.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
