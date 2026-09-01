"use client";

import { useState, type FormEvent } from "react";

import type { InstrumentSummary } from "@/src/domain/instruments";
import type { Strategy } from "@/src/domain/strategy";

type PriceKind = Strategy["entry"]["price"]["kind"];

interface StrategyBuilderProps {
  instrument: InstrumentSummary;
  onConfirm: (strategy: Strategy) => void;
  onDirty: () => void;
  isBusy: boolean;
}

function boundedNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : minimum;
}

export function StrategyBuilder({ instrument, onConfirm, onDirty, isBusy }: StrategyBuilderProps) {
  const [priceKind, setPriceKind] = useState<PriceKind>("rolling_high_breakout");
  const [period, setPeriod] = useState(20);
  const [volumeRatio, setVolumeRatio] = useState(2);
  const [stopPercent, setStopPercent] = useState(5);

  const priceLabel = priceKind === "rolling_high_breakout" ? "HIGH" : "SMA";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm({
      version: 1,
      name: `${instrument.symbol} ${priceLabel} ${period}`,
      market: instrument.market,
      instrumentId: instrument.instrumentId,
      timeframe: "1d",
      entry: {
        price: { kind: priceKind, period },
        volume: { kind: "volume_ratio_above", period, ratio: volumeRatio },
      },
      exit: { kind: "trailing_stop", percent: stopPercent },
      assumptions: {
        signalAt: "session_close",
        fillAt: "next_session_open",
        positionSizing: "all_in_single_asset",
      },
    });
  }

  return (
    <form className="builder-layout" onSubmit={handleSubmit} aria-busy={isBusy}>
      <div className="mobile-logic-summary" aria-hidden="true">
        <span>{instrument.market}</span>
        <strong>
          {instrument.symbol} · {period}D {priceLabel}
        </strong>
        <span>{volumeRatio}× VOL</span>
        <span>−{stopPercent}% PEAK</span>
      </div>
      <div className="builder-controls">
        <fieldset className="builder-group signal-picker">
          <legend>
            <span>02</span> 진입 신호
          </legend>
          <div className="choice-grid">
            <label className="choice-card">
              <input
                type="radio"
                name="price-rule"
                checked={priceKind === "rolling_high_breakout"}
                disabled={isBusy}
                onChange={() => {
                  onDirty();
                  setPriceKind("rolling_high_breakout");
                }}
              />
              <span className="choice-indicator" aria-hidden="true" />
              <strong>고점 돌파</strong>
              <small>HIGH</small>
            </label>
            <label className="choice-card">
              <input
                type="radio"
                name="price-rule"
                checked={priceKind === "sma_cross_above"}
                disabled={isBusy}
                onChange={() => {
                  onDirty();
                  setPriceKind("sma_cross_above");
                }}
              />
              <span className="choice-indicator" aria-hidden="true" />
              <strong>이동평균 돌파</strong>
              <small>SMA</small>
            </label>
          </div>
        </fieldset>

        <div className="numeric-grid">
          <label className="number-control">
            <span>
              <b>03</b> 기준 기간
            </span>
            <span className="number-input">
              <input
                type="number"
                min="2"
                max="60"
                value={period}
                disabled={isBusy}
                onChange={(event) => {
                  onDirty();
                  setPeriod(boundedNumber(event.target.value, 2, 60));
                }}
              />
              <small>일</small>
            </span>
          </label>
          <label className="number-control">
            <span>
              <b>04</b> 거래량
            </span>
            <span className="number-input">
              <input
                type="number"
                min="1"
                max="5"
                step="0.1"
                value={volumeRatio}
                disabled={isBusy}
                onChange={(event) => {
                  onDirty();
                  setVolumeRatio(boundedNumber(event.target.value, 1, 5));
                }}
              />
              <small>×</small>
            </span>
          </label>
          <label className="number-control">
            <span>
              <b>05</b> 추적 손절
            </span>
            <span className="number-input">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.5"
                value={stopPercent}
                disabled={isBusy}
                onChange={(event) => {
                  onDirty();
                  setStopPercent(boundedNumber(event.target.value, 0.5, 30));
                }}
              />
              <small>%</small>
            </span>
          </label>
        </div>
      </div>

      <aside className="strategy-map" aria-label="전략 구조 미리보기" aria-live="polite">
        <div className="map-topline">
          <span>LIVE STRUCTURE</span>
          <span>1D</span>
        </div>
        <div className="map-symbol">
          <span>
            {instrument.market} · {instrument.synthetic ? "SYNTHETIC FIXTURE" : "TOSS REAL DATA"}
          </span>
          <strong>{instrument.symbol}</strong>
          <small>{instrument.currency}</small>
        </div>
        <ol className="logic-flow">
          <li>
            <span>IF</span>
            <strong>
              {period}D {priceLabel}
            </strong>
          </li>
          <li>
            <span>AND</span>
            <strong>{volumeRatio}× VOL</strong>
          </li>
          <li className="logic-action">
            <span>THEN</span>
            <strong>BUY ↗</strong>
          </li>
          <li className="logic-exit">
            <span>EXIT</span>
            <strong>−{stopPercent}% PEAK</strong>
          </li>
        </ol>
        <div className="map-execution">
          <span>CLOSE SIGNAL</span>
          <span aria-hidden="true">→</span>
          <span>NEXT OPEN</span>
        </div>
        <button className="primary-button builder-submit" type="submit" disabled={isBusy}>
          <span>구조 확인</span>
          <span aria-hidden="true">→</span>
        </button>
      </aside>
    </form>
  );
}
