"use client";

import { useMemo, useState } from "react";

import type { ResearchComparisonResult, ResearchRun } from "../domain/advanced-backtest";

interface Props {
  result: ResearchComparisonResult;
  run: ResearchRun;
}

type OverlayKey = "vwap" | "ema" | "ichimoku" | "stochasticRsi";

function linePath(
  values: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    path += `${drawing ? " L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    drawing = true;
  });
  return path;
}

export function IndicatorCandleChart({ result, run }: Props) {
  const configuredOverlays = new Set(result.strategy.overlays);
  const [visible, setVisible] = useState<Record<OverlayKey, boolean>>({
    vwap: configuredOverlays.has("VWAP"),
    ema: configuredOverlays.has("EMA"),
    ichimoku: configuredOverlays.has("ICHIMOKU"),
    stochasticRsi: configuredOverlays.has("STOCH_RSI"),
  });
  const candles = result.chart.candles;
  const width = Math.max(960, candles.length * 3);
  const height = 430;
  const oscillatorHeight = 150;
  const padding = 34;
  const values = candles.flatMap((candle) => [candle.low, candle.high]);
  const addValues = (items: Array<number | null>) =>
    items.forEach((value) => value !== null && values.push(value));
  if (visible.vwap) addValues(result.chart.overlays.vwap.map((point) => point.value));
  if (visible.ema) {
    addValues(result.chart.overlays.emaFast.map((point) => point.value));
    addValues(result.chart.overlays.emaSlow.map((point) => point.value));
  }
  if (visible.ichimoku) {
    addValues(result.chart.overlays.ichimoku.flatMap((point) => [point.spanA, point.spanB]));
  }
  run.exitOverlays.forEach((overlay) => addValues(overlay.values));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const x = (index: number) =>
    padding + (index / Math.max(candles.length - 1, 1)) * (width - padding * 2);
  const y = (value: number) =>
    height - padding - ((value - minimum) / range) * (height - padding * 2);
  const candleWidth = Math.max(1.2, (width - padding * 2) / candles.length - 0.8);
  const timelineIndex = useMemo(
    () => new Map(candles.map((candle, index) => [candle.date, index])),
    [candles],
  );
  const markers = run.trades.flatMap((trade) => {
    const resultMarkers: Array<{ side: "BUY" | "SELL"; date: string; price: number }> = [
      { side: "BUY", date: trade.entryAt, price: trade.entryPrice },
    ];
    if (trade.exitAt && trade.exitPrice !== undefined) {
      resultMarkers.push({ side: "SELL" as const, date: trade.exitAt, price: trade.exitPrice });
    }
    return resultMarkers;
  });
  const cloudTop = result.chart.overlays.ichimoku
    .map((point, index) => (point.spanA === null ? null : `${x(index)},${y(point.spanA)}`))
    .filter(Boolean);
  const cloudBottom = result.chart.overlays.ichimoku
    .map((point, index) => (point.spanB === null ? null : `${x(index)},${y(point.spanB)}`))
    .filter(Boolean)
    .reverse();

  function toggle(key: OverlayKey) {
    setVisible((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className="indicator-chart-panel" aria-labelledby="indicator-chart-title">
      <div className="panel-heading indicator-chart-heading">
        <div>
          <span>OHLC / 5M</span>
          <h3 id="indicator-chart-title">캔들 · 지표 오버레이</h3>
        </div>
        <strong>{run.label}</strong>
      </div>

      <fieldset className="overlay-controls">
        <legend>표시할 지표</legend>
        {(
          [
            ["vwap", `VWAP ${result.strategy.entry.sessionLookback}D`, "VWAP"],
            ["ema", "EMA 9 / 21", "EMA"],
            ["ichimoku", "일목균형표", "ICHIMOKU"],
            ["stochasticRsi", "Stochastic RSI", "STOCH_RSI"],
          ] as const
        )
          .filter(([, , contractKey]) => configuredOverlays.has(contractKey))
          .map(([key, label]) => (
            <label key={key}>
              <input type="checkbox" checked={visible[key]} onChange={() => toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
      </fieldset>

      <ul className="overlay-legend" aria-label="선 모양별 지표 범례">
        <li>
          <span className="legend-candle legend-candle-up" aria-hidden="true" />
          상승 캔들 · 빈 몸통
        </li>
        <li>
          <span className="legend-candle legend-candle-down" aria-hidden="true" />
          하락 캔들 · 채운 몸통
        </li>
        {configuredOverlays.has("VWAP") ? (
          <li>
            <span className="legend-line legend-vwap" aria-hidden="true" />
            VWAP · 굵은 실선
          </li>
        ) : null}
        {configuredOverlays.has("EMA") ? (
          <>
            <li>
              <span className="legend-line legend-ema-fast" aria-hidden="true" />
              EMA 9 · 긴 점선
            </li>
            <li>
              <span className="legend-line legend-ema-slow" aria-hidden="true" />
              EMA 21 · 짧은 점선
            </li>
          </>
        ) : null}
        {configuredOverlays.has("ICHIMOKU") ? (
          <>
            <li>
              <span className="legend-line legend-kijun" aria-hidden="true" />
              일목 기준선 · 일점쇄선
            </li>
            <li>
              <span className="legend-line legend-tenkan" aria-hidden="true" />
              일목 전환선 · 파선
            </li>
          </>
        ) : null}
        {run.exitOverlays.map((overlay, index) => (
          <li key={overlay.label}>
            <span className={`legend-line legend-exit-${index}`} aria-hidden="true" />
            선택 청산 · {overlay.label}
          </li>
        ))}
      </ul>

      <div
        className="research-chart-scroll"
        role="region"
        aria-label="5분봉 캔들 및 지표 차트 가로 스크롤 영역"
        tabIndex={0}
      >
        <svg
          className="indicator-candle-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${result.market.symbol} synthetic 5분봉 OHLC 캔들과 선택 지표`}
        >
          <g className="chart-grid" aria-hidden="true">
            {[padding, height / 2, height - padding].map((lineY) => (
              <line key={lineY} x1={padding} x2={width - padding} y1={lineY} y2={lineY} />
            ))}
          </g>
          {visible.ichimoku && cloudTop.length > 1 && cloudBottom.length > 1 ? (
            <polygon
              className="ichimoku-cloud"
              points={[...cloudTop, ...cloudBottom].join(" ")}
              aria-hidden="true"
            />
          ) : null}
          <g className="candles" aria-hidden="true">
            {candles.map((candle, index) => {
              const openY = y(candle.open);
              const closeY = y(candle.close);
              return (
                <g
                  className={candle.close >= candle.open ? "candle-up" : "candle-down"}
                  key={candle.date}
                >
                  <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} />
                  <rect
                    x={x(index) - candleWidth / 2}
                    y={Math.min(openY, closeY)}
                    width={candleWidth}
                    height={Math.max(1, Math.abs(openY - closeY))}
                  />
                </g>
              );
            })}
          </g>
          {visible.vwap ? (
            <path
              className="overlay-line overlay-vwap"
              d={linePath(
                result.chart.overlays.vwap.map((point) => point.value),
                x,
                y,
              )}
            />
          ) : null}
          {visible.ema ? (
            <>
              <path
                className="overlay-line overlay-ema-fast"
                d={linePath(
                  result.chart.overlays.emaFast.map((point) => point.value),
                  x,
                  y,
                )}
              />
              <path
                className="overlay-line overlay-ema-slow"
                d={linePath(
                  result.chart.overlays.emaSlow.map((point) => point.value),
                  x,
                  y,
                )}
              />
            </>
          ) : null}
          {visible.ichimoku ? (
            <>
              <path
                className="overlay-line overlay-kijun"
                d={linePath(
                  result.chart.overlays.ichimoku.map((point) => point.kijun),
                  x,
                  y,
                )}
              />
              <path
                className="overlay-line overlay-tenkan"
                d={linePath(
                  result.chart.overlays.ichimoku.map((point) => point.tenkan),
                  x,
                  y,
                )}
              />
            </>
          ) : null}
          {run.exitOverlays.map((overlay, index) => (
            <path
              key={overlay.label}
              className={`overlay-line overlay-exit overlay-exit-${index}`}
              d={linePath(overlay.values, x, y)}
            />
          ))}
          {markers.map((marker, index) => {
            const candleIndex = timelineIndex.get(marker.date);
            if (candleIndex === undefined) return null;
            const markerX = x(candleIndex);
            const markerY = y(marker.price);
            return (
              <g
                key={`${marker.side}-${marker.date}-${index}`}
                className={`trade-marker trade-marker-${marker.side.toLowerCase()}`}
                data-research-marker={marker.side}
                aria-hidden="true"
              >
                <polygon
                  points={
                    marker.side === "BUY"
                      ? `${markerX},${markerY - 8} ${markerX - 7},${markerY + 6} ${markerX + 7},${markerY + 6}`
                      : `${markerX},${markerY + 8} ${markerX - 7},${markerY - 6} ${markerX + 7},${markerY - 6}`
                  }
                />
                <text
                  x={markerX}
                  y={marker.side === "BUY" ? markerY + 20 : markerY - 12}
                  textAnchor="middle"
                >
                  {marker.side === "BUY" ? "B" : "S"}
                </text>
              </g>
            );
          })}
        </svg>

        {visible.stochasticRsi ? (
          <svg
            className="oscillator-svg"
            viewBox={`0 0 ${width} ${oscillatorHeight}`}
            role="img"
            aria-label={`${result.market.symbol} Stochastic RSI 0에서 100`}
          >
            <g className="oscillator-guides" aria-hidden="true">
              <line x1={padding} x2={width - padding} y1="30" y2="30" />
              <line
                x1={padding}
                x2={width - padding}
                y1={oscillatorHeight - 30}
                y2={oscillatorHeight - 30}
              />
            </g>
            <path
              className="overlay-line overlay-stoch"
              d={linePath(
                result.chart.overlays.stochasticRsi.map((point) => point.value),
                x,
                (value) => oscillatorHeight - 18 - (value / 100) * (oscillatorHeight - 36),
              )}
            />
            <text x={padding} y="22">
              80
            </text>
            <text x={padding} y={oscillatorHeight - 18}>
              20
            </text>
          </svg>
        ) : null}
      </div>

      <div
        className="table-scroll research-trade-table-wrap"
        role="region"
        aria-label={`${run.label} 매수 매도 시점 표 가로 스크롤 영역`}
        tabIndex={0}
      >
        <table aria-label={`${run.label} 매수 매도 시점과 가격`}>
          <thead>
            <tr>
              <th scope="col">상태</th>
              <th scope="col">매수 신호</th>
              <th scope="col">매수 체결</th>
              <th scope="col">매수가</th>
              <th scope="col">매도 신호</th>
              <th scope="col">매도 체결</th>
              <th scope="col">매도가</th>
              <th scope="col">청산 이유</th>
            </tr>
          </thead>
          <tbody>
            {run.trades.length === 0 ? (
              <tr>
                <td colSpan={8}>이 청산 기준에서 체결된 거래가 없습니다.</td>
              </tr>
            ) : (
              run.trades.map((trade, index) => (
                <tr key={`${trade.entryAt}-${index}`}>
                  <td>{trade.status}</td>
                  <td>{trade.entrySignalAt.replace("T", " ")}</td>
                  <td>{trade.entryAt.replace("T", " ")}</td>
                  <td>{trade.entryPrice}</td>
                  <td>{trade.exitSignalAt?.replace("T", " ") ?? "—"}</td>
                  <td>{trade.exitAt?.replace("T", " ") ?? "—"}</td>
                  <td>{trade.exitPrice ?? "—"}</td>
                  <td>{trade.exitReason ?? "보유 중"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        className="table-scroll indicator-table-wrap"
        role="region"
        aria-label="최근 캔들 및 지표 값 표 가로 스크롤 영역"
        tabIndex={0}
      >
        <table aria-label="최근 5분봉 OHLC와 지표 값">
          <thead>
            <tr>
              <th scope="col">시간</th>
              <th scope="col">Open</th>
              <th scope="col">High</th>
              <th scope="col">Low</th>
              <th scope="col">Close</th>
              {configuredOverlays.has("VWAP") ? <th scope="col">VWAP</th> : null}
              {configuredOverlays.has("EMA") ? (
                <>
                  <th scope="col">EMA 9</th>
                  <th scope="col">EMA 21</th>
                </>
              ) : null}
              {configuredOverlays.has("ICHIMOKU") ? (
                <>
                  <th scope="col">일목 전환선</th>
                  <th scope="col">일목 기준선</th>
                  <th scope="col">선행스팬 A</th>
                  <th scope="col">선행스팬 B</th>
                </>
              ) : null}
              {configuredOverlays.has("STOCH_RSI") ? <th scope="col">Stoch RSI</th> : null}
              {run.exitOverlays.map((overlay) => (
                <th scope="col" key={overlay.label}>
                  선택 · {overlay.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candles.slice(-12).map((candle) => {
              const index = candles.indexOf(candle);
              return (
                <tr key={candle.date}>
                  <td>{candle.date.replace("T", " ")}</td>
                  <td>{candle.open}</td>
                  <td>{candle.high}</td>
                  <td>{candle.low}</td>
                  <td>{candle.close}</td>
                  {configuredOverlays.has("VWAP") ? (
                    <td>{result.chart.overlays.vwap[index].value?.toFixed(2) ?? "—"}</td>
                  ) : null}
                  {configuredOverlays.has("EMA") ? (
                    <>
                      <td>{result.chart.overlays.emaFast[index].value?.toFixed(2) ?? "—"}</td>
                      <td>{result.chart.overlays.emaSlow[index].value?.toFixed(2) ?? "—"}</td>
                    </>
                  ) : null}
                  {configuredOverlays.has("ICHIMOKU") ? (
                    <>
                      <td>{result.chart.overlays.ichimoku[index].tenkan?.toFixed(2) ?? "—"}</td>
                      <td>{result.chart.overlays.ichimoku[index].kijun?.toFixed(2) ?? "—"}</td>
                      <td>{result.chart.overlays.ichimoku[index].spanA?.toFixed(2) ?? "—"}</td>
                      <td>{result.chart.overlays.ichimoku[index].spanB?.toFixed(2) ?? "—"}</td>
                    </>
                  ) : null}
                  {configuredOverlays.has("STOCH_RSI") ? (
                    <td>{result.chart.overlays.stochasticRsi[index].value?.toFixed(1) ?? "—"}</td>
                  ) : null}
                  {run.exitOverlays.map((overlay) => (
                    <td key={overlay.label}>{overlay.values[index]?.toFixed(2) ?? "—"}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
