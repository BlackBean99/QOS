"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ResearchComparisonResult } from "../domain/advanced-backtest";
import type { ResearchEntryFilter, ResearchStrategy } from "../domain/advanced-strategy";
import { INDICATOR_CATALOG, type ChartIndicator } from "../domain/chart-indicators";
import type { InstrumentSummary } from "../domain/instruments";
import { createInstrumentSnapshot } from "../domain/stored-strategy";

interface CompileResponse {
  compiler: "openai" | "reference-template";
  strategy: ResearchStrategy;
  warnings: string[];
}

const referencePrompt = (symbol: string) =>
  `${symbol}를 5분봉에서 15일 VWAP 상향 돌파 시 매수하고, 일목균형표 기준선 하향, VWAP 즉시/3봉 확인, ATR 14 × 2/3 trailing, 초기 1.5 ATR 손절 + Chandelier 22 × 3, EMA 9/21 데드크로스, 고점 대비 2% trailing 청산을 비교해줘.`;

export function AdvancedResearch({
  instrument,
  onStrategyChange,
  onResult,
}: {
  instrument: InstrumentSummary;
  onStrategyChange?: (strategy: ResearchStrategy | null) => void;
  onResult?: (result: ResearchComparisonResult) => void;
}) {
  const [prompt, setPrompt] = useState(referencePrompt(instrument.symbol));
  const [strategy, setStrategy] = useState<ResearchStrategy | null>(null);
  const [compiler, setCompiler] = useState<CompileResponse["compiler"] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<ResearchComparisonResult | null>(null);
  const [selectedRun, setSelectedRun] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"compile" | "run" | null>(null);
  const [filterRsi, setFilterRsi] = useState(false);
  const [rsiThreshold, setRsiThreshold] = useState(70);
  const [filterMacd, setFilterMacd] = useState(false);
  const [genericIndicator, setGenericIndicator] = useState<ChartIndicator | "">("");
  const [genericOperator, setGenericOperator] = useState<"above" | "below">("above");
  const [genericValue, setGenericValue] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) requestAnimationFrame(() => errorRef.current?.focus());
  }, [error]);

  useEffect(() => {
    if (!strategy) return;
    onStrategyChange?.({
      ...strategy,
      entry: {
        ...strategy.entry,
        filterLogic: "all",
        filters: [
          ...(filterRsi ? [{ kind: "rsi_below", period: 14, value: rsiThreshold } as const] : []),
          ...(filterMacd
            ? [
                {
                  kind: "macd_cross_above",
                  fastPeriod: 12,
                  slowPeriod: 26,
                  signalPeriod: 9,
                } as const,
              ]
            : []),
          ...(genericIndicator
            ? [
                {
                  kind: genericOperator === "above" ? "indicator_above" : "indicator_below",
                  indicator: genericIndicator,
                  params:
                    INDICATOR_CATALOG.find((item) => item.name === genericIndicator)
                      ?.defaultParams ?? [],
                  source: "close",
                  value: genericValue,
                } as const,
              ]
            : []),
        ],
      },
    });
  }, [
    filterMacd,
    filterRsi,
    genericIndicator,
    genericOperator,
    genericValue,
    onStrategyChange,
    rsiThreshold,
    strategy,
  ]);

  function resetAfterEdit() {
    setStrategy(null);
    setCompiler(null);
    setWarnings([]);
    setResult(null);
    setError(null);
    setFilterRsi(false);
    setFilterMacd(false);
    setGenericIndicator("");
    onStrategyChange?.(null);
  }

  async function compile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("compile");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/research/strategies/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          instrumentId: instrument.instrumentId,
          instrument: createInstrumentSnapshot(instrument),
        }),
      });
      const body = (await response.json()) as
        CompileResponse | { error?: { code?: string; message?: string } };
      if (!response.ok || !("strategy" in body)) {
        setError(
          "error" in body && body.error?.message
            ? body.error.message
            : "전략 JSON 변환을 완료하지 못했습니다.",
        );
        return;
      }
      setStrategy(body.strategy);
      setCompiler(body.compiler);
      setWarnings(body.warnings);
      onStrategyChange?.(body.strategy);
    } catch {
      setError("로컬 전략 변환 서버 응답을 확인해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!strategy || busy) return;
    setBusy("run");
    setError(null);
    try {
      const response = await fetch("/api/research/backtests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy: {
            ...strategy,
            entry: {
              ...strategy.entry,
              filterLogic: "all",
              filters: [
                ...(filterRsi
                  ? ([
                      { kind: "rsi_below", period: 14, value: rsiThreshold },
                    ] as ResearchEntryFilter[])
                  : []),
                ...(filterMacd
                  ? ([
                      { kind: "macd_cross_above", fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
                    ] as ResearchEntryFilter[])
                  : []),
                ...(genericIndicator
                  ? [
                      {
                        kind: genericOperator === "above" ? "indicator_above" : "indicator_below",
                        indicator: genericIndicator,
                        params:
                          INDICATOR_CATALOG.find((item) => item.name === genericIndicator)
                            ?.defaultParams ?? [],
                        source: "close",
                        value: genericValue,
                      } as ResearchEntryFilter,
                    ]
                  : []),
              ],
            },
          },
          instrument: createInstrumentSnapshot(instrument),
        }),
      });
      const body = (await response.json()) as
        ResearchComparisonResult | { error?: { message?: string } };
      if (!response.ok || !("runs" in body)) {
        setError("검증된 Strategy v2를 실행하지 못했습니다.");
        return;
      }
      setResult(body);
      onResult?.(body);
      setSelectedRun(0);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>("#research-results")?.focus(),
      );
    } catch {
      setError("5분봉 백테스트 응답을 확인할 수 없습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="advanced-research" aria-busy={busy !== null}>
      <form className="research-prompt" onSubmit={compile}>
        <div className="research-prompt-heading">
          <div>
            <span>02 / STRATEGY JSON COMPILER</span>
            <h2>가설을 JSON 전략으로</h2>
          </div>
          <span className="provider-state">LOCAL DEFAULT · NO API COST</span>
        </div>
        <label htmlFor="research-prompt">투자 전략 가설</label>
        <textarea
          id="research-prompt"
          value={prompt}
          readOnly={busy !== null}
          maxLength={4_000}
          rows={6}
          onChange={(event) => {
            setPrompt(event.target.value);
            resetAfterEdit();
          }}
        />
        <div className="research-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy !== null}
            onClick={() => {
              setPrompt(referencePrompt(instrument.symbol));
              resetAfterEdit();
            }}
          >
            VWAP 청산 비교 예시
          </button>
          <button className="primary-button" type="submit" disabled={busy !== null}>
            {busy === "compile" ? "변환 중" : "검증된 JSON 후보 만들기"}
          </button>
        </div>
      </form>

      {error ? (
        <div ref={errorRef} className="error-panel" role="alert" tabIndex={-1}>
          <strong>전략을 준비하지 못했습니다.</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {strategy ? (
        <section className="research-contract" aria-labelledby="research-contract-title">
          <div>
            <span>03 / REVIEW JSON</span>
            <h2 id="research-contract-title">실행 전 전략 계약</h2>
            <p>
              {compiler === "openai"
                ? "PAID OPENAI API · STRUCTURED OUTPUT"
                : "LOCAL REFERENCE · API 비용 없음"}{" "}
              · 사용자 확인 필요
            </p>
          </div>
          <pre aria-label="Strategy v2 JSON" tabIndex={0}>
            {JSON.stringify(
              {
                ...strategy,
                entry: {
                  ...strategy.entry,
                  filterLogic: "all",
                  filters: [
                    ...(filterRsi ? [{ kind: "rsi_below", period: 14, value: rsiThreshold }] : []),
                    ...(filterMacd
                      ? [
                          {
                            kind: "macd_cross_above",
                            fastPeriod: 12,
                            slowPeriod: 26,
                            signalPeriod: 9,
                          },
                        ]
                      : []),
                    ...(genericIndicator
                      ? [
                          {
                            kind:
                              genericOperator === "above" ? "indicator_above" : "indicator_below",
                            indicator: genericIndicator,
                            params:
                              INDICATOR_CATALOG.find((item) => item.name === genericIndicator)
                                ?.defaultParams ?? [],
                            source: "close",
                            value: genericValue,
                          },
                        ]
                      : []),
                  ],
                },
              },
              null,
              2,
            )}
          </pre>
          <fieldset className="research-filters">
            <legend>진입 보조조건 (선택)</legend>
            <label>
              <input
                type="checkbox"
                checked={filterRsi}
                onChange={(event) => setFilterRsi(event.target.checked)}
              />
              RSI(14) 미만
              <input
                type="number"
                min={1}
                max={99}
                value={rsiThreshold}
                disabled={!filterRsi}
                onChange={(event) => setRsiThreshold(Number(event.target.value))}
                aria-label="RSI 임계값"
              />
            </label>
            <label>
              전체 지표 조건
              <select
                value={genericIndicator}
                onChange={(event) => setGenericIndicator(event.target.value as ChartIndicator | "")}
                aria-label="전체 지표 선택"
              >
                <option value="">사용 안 함</option>
                {INDICATOR_CATALOG.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.label} ({item.name})
                  </option>
                ))}
              </select>
              <select
                value={genericOperator}
                onChange={(event) => setGenericOperator(event.target.value as "above" | "below")}
                aria-label="지표 비교 방식"
                disabled={!genericIndicator}
              >
                <option value="above">기준값 이상</option>
                <option value="below">기준값 이하</option>
              </select>
              <input
                type="number"
                value={genericValue}
                onChange={(event) => setGenericValue(Number(event.target.value))}
                aria-label="지표 기준값"
                disabled={!genericIndicator}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterMacd}
                onChange={(event) => setFilterMacd(event.target.checked)}
              />
              MACD(12,26,9) 상향교차
            </label>
            <p>체크한 조건은 JSON에 포함되고 백테스트 진입 시 모두 적용됩니다.</p>
          </fieldset>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <button className="primary-button" type="button" disabled={busy !== null} onClick={run}>
            {busy === "run"
              ? `${strategy.exits.length}개 청산법 계산 중`
              : `${strategy.exits.length}개 청산 전략 비교`}
          </button>
        </section>
      ) : null}

      {result ? (
        <section id="research-results" className="research-results" tabIndex={-1}>
          <div className="research-result-heading">
            <div>
              <span>04 / EXIT LAB</span>
              <h2>청산 전략 비교</h2>
            </div>
            <p>
              {result.period.sessions} sessions · {result.period.bars.toLocaleString("ko-KR")} bars
              · {result.market.synthetic ? "SYNTHETIC" : "TOSS REAL DATA"}
            </p>
          </div>
          <dl className="research-provenance" aria-label="백테스트 데이터와 실행 가정">
            <div>
              <dt>Market</dt>
              <dd>{result.market.market}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{result.market.timeZone}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{result.market.currency}</dd>
            </div>
            <div>
              <dt>Calendar</dt>
              <dd>{result.market.calendar}</dd>
            </div>
            <div>
              <dt>Source / version</dt>
              <dd>
                {result.market.source} / {result.market.version}
              </dd>
            </div>
            <div>
              <dt>Costs</dt>
              <dd>
                commission {result.costs.commissionBps} bps / slippage {result.costs.slippageBps}{" "}
                bps
              </dd>
            </div>
          </dl>
          <div
            className="table-scroll comparison-scroll"
            role="region"
            aria-label="청산 전략 성과 비교 표 가로 스크롤 영역"
            tabIndex={0}
          >
            <table aria-label="청산 전략 성과 비교">
              <thead>
                <tr>
                  <th scope="col">차트</th>
                  <th scope="col">청산 기준</th>
                  <th scope="col">Return</th>
                  <th scope="col">CAGR</th>
                  <th scope="col">MDD</th>
                  <th scope="col">Sharpe</th>
                  <th scope="col">PF</th>
                  <th scope="col">Win</th>
                  <th scope="col">Avg win / loss</th>
                  <th scope="col">Trades</th>
                  <th scope="col">Avg hold</th>
                  <th scope="col">MFE / MAE</th>
                </tr>
              </thead>
              <tbody>
                {result.runs.map((run, index) => (
                  <tr key={`${run.exit.kind}-${index}`}>
                    <td>
                      <label className="run-picker">
                        <input
                          type="radio"
                          name="research-run"
                          aria-label={`${run.label} 차트 보기`}
                          checked={selectedRun === index}
                          onChange={() => setSelectedRun(index)}
                        />
                        <span className="sr-only">{run.label} 차트 보기</span>
                      </label>
                    </td>
                    <th scope="row">{run.label}</th>
                    <td>{run.metrics.totalReturnPercent.toFixed(2)}%</td>
                    <td>{run.metrics.annualizedReturnPercent.toFixed(2)}%</td>
                    <td>{run.metrics.maxDrawdownPercent.toFixed(2)}%</td>
                    <td>{run.metrics.sharpeRatio.toFixed(2)}</td>
                    <td>
                      {run.metrics.profitFactor === null
                        ? run.metrics.grossProfit > 0
                          ? "∞"
                          : "—"
                        : run.metrics.profitFactor.toFixed(2)}
                    </td>
                    <td>{run.metrics.winRatePercent.toFixed(1)}%</td>
                    <td>
                      {run.metrics.averageWinPercent.toFixed(2)}% /{" "}
                      {run.metrics.averageLossPercent.toFixed(2)}%
                    </td>
                    <td>{run.metrics.trades}</td>
                    <td>{run.metrics.averageHoldingMinutes.toFixed(0)}m</td>
                    <td>
                      {run.metrics.averageMfePercent.toFixed(2)}% /{" "}
                      {run.metrics.averageMaePercent.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="data-panel chart-sync-panel" aria-label="선택 청산 신호 차트 동기화">
            <div className="panel-heading">
              <div>
                <span>05</span>
                <h3>Interactive chart sync</h3>
              </div>
              <strong>{result.runs[selectedRun]?.label}</strong>
            </div>
            <p>
              기본 청산 run의 BUY/SELL은 위 KLineChart와 신호 표에 표시됩니다. 다른 청산 설정은 비교
              표에서 선택해 정확한 성과와 거래 내역을 검토하세요.
            </p>
          </section>
          <ul className="research-assumptions">
            {result.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
