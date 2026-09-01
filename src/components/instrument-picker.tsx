"use client";

import { useState } from "react";

import type { InstrumentId, InstrumentSummary } from "@/src/domain/instruments";

interface InstrumentPickerProps {
  instruments: InstrumentSummary[];
  selectedInstrumentId: InstrumentId;
  isBusy: boolean;
  onSelect: (instrumentId: InstrumentId) => void;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._:-]+/g, "");
}

export function InstrumentPicker({
  instruments,
  selectedInstrumentId,
  isBusy,
  onSelect,
}: InstrumentPickerProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalize(query.trim());
  const results = instruments.filter((instrument) => {
    if (!normalizedQuery) return true;
    return [
      instrument.instrumentId,
      instrument.market,
      instrument.symbol,
      instrument.displayName,
      ...instrument.aliases,
    ]
      .map(normalize)
      .some((value) => value.includes(normalizedQuery));
  });
  const selectedInstrument = instruments.find(
    (instrument) => instrument.instrumentId === selectedInstrumentId,
  );

  return (
    <section className="instrument-studio" aria-labelledby="instrument-title">
      <div className="instrument-toolbar">
        <div>
          <p className="instrument-step">01 / INSTRUMENT</p>
          <h2 id="instrument-title">종목 선택</h2>
          {selectedInstrument ? (
            <p className="selected-instrument">
              현재 실행 종목
              <strong>
                {selectedInstrument.displayName} · {selectedInstrument.symbol}
              </strong>
            </p>
          ) : null}
        </div>
        <label className="instrument-search">
          <span>종목 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름 또는 티커"
            autoComplete="off"
            disabled={isBusy}
          />
        </label>
      </div>

      {results.length > 0 ? (
        <fieldset className="instrument-results">
          <legend className="sr-only">선택한 TOSS 종목</legend>
          {results.map((instrument) => (
            <label className="instrument-option" key={instrument.instrumentId}>
              <input
                type="radio"
                name="instrument"
                value={instrument.instrumentId}
                checked={selectedInstrumentId === instrument.instrumentId}
                disabled={isBusy}
                onChange={() => onSelect(instrument.instrumentId)}
              />
              <span className="choice-indicator" aria-hidden="true" />
              <span>
                <strong>{instrument.displayName}</strong>
                <small>
                  {instrument.symbol} · {instrument.market}
                </small>
              </span>
              <em>{instrument.synthetic ? "FIXTURE" : "TOSS"}</em>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="instrument-empty" role="status">
          선택한 종목이 없습니다. TOSS 종목 검색에서 이름이나 티커를 입력하세요.
        </p>
      )}

      <p className="instrument-notice">
        실제 종목 master와 과거 가격은 서버의 TOSS OpenAPI에서 가져옵니다.
      </p>
    </section>
  );
}
