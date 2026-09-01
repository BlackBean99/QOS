import type { BacktestResult, BacktestTrade } from "@/src/domain/backtest";
import { AccessibleChart } from "./accessible-chart";

function currency(value: number, code: string): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: code,
    maximumFractionDigits: code === "KRW" ? 0 : 2,
  }).format(value);
}

function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function tradeOutcome(trade: BacktestTrade, currencyCode: string): string {
  if (trade.status === "OPEN") return "OPEN · 마지막 종가 평가";
  return `${signedPercent(trade.returnPercent ?? 0)} · ${currency(trade.pnl ?? 0, currencyCode)}`;
}

export function BacktestDashboard({ result }: { result: BacktestResult }) {
  const { metrics, market } = result;
  const kpis = [
    {
      label: "TOTAL RETURN",
      value: signedPercent(metrics.totalReturnPercent),
      note: `Buy & hold ${signedPercent(metrics.benchmarkReturnPercent)}`,
      tone: metrics.totalReturnPercent >= 0 ? "positive" : "negative",
    },
    {
      label: "MAX DRAWDOWN",
      value: signedPercent(metrics.maxDrawdownPercent),
      note: "Peak-to-trough",
      tone: "negative",
    },
    {
      label: "SHARPE",
      value: metrics.sharpeRatio.toFixed(2),
      note: "252 sessions · RF 0%",
      tone: "neutral",
    },
    {
      label: "WIN RATE",
      value: `${metrics.winRatePercent.toFixed(1)}%`,
      note: `${metrics.closedTrades} closed trades`,
      tone: "neutral",
    },
  ];

  return (
    <section
      className="results-section"
      id="backtest-results"
      tabIndex={-1}
      aria-labelledby="results-title"
    >
      <div className="results-heading">
        <div>
          <p className="eyebrow">STEP 03 / REVIEW</p>
          <h2 id="results-title">백테스트 결과</h2>
        </div>
        <div className="result-status">
          <span aria-hidden="true">✓</span>
          DETERMINISTIC RUN
        </div>
      </div>

      <div className="run-context">
        <div>
          <span>{market.market}</span>
          <strong>{market.displayName}</strong>
        </div>
        <dl>
          <div>
            <dt>SYMBOL</dt>
            <dd>{market.symbol}</dd>
          </div>
          <div>
            <dt>PERIOD</dt>
            <dd>
              {result.period.start} — {result.period.end}
            </dd>
          </div>
          <div>
            <dt>SESSIONS</dt>
            <dd>{result.period.sessions}</dd>
          </div>
          <div>
            <dt>CURRENCY</dt>
            <dd>{market.currency}</dd>
          </div>
        </dl>
      </div>

      <dl className="kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`kpi-card tone-${kpi.tone}`}>
            <dt>{kpi.label}</dt>
            <dd>{kpi.value}</dd>
            <dd className="kpi-note">{kpi.note}</dd>
          </div>
        ))}
      </dl>

      <section className="data-panel chart-sync-panel" aria-labelledby="trade-chart-title">
        <div className="panel-heading">
          <div>
            <span>01</span>
            <h3 id="trade-chart-title">Interactive chart signals</h3>
          </div>
          <strong>{market.symbol} · BUY/SELL SYNC</strong>
        </div>
        <p>
          결과의 BUY/SELL은 위 KLineChart에 글자·도형 marker로 동기화됩니다. 정확한 시각과 가격은
          차트 아래 신호 표와 아래 거래 내역에서 함께 확인할 수 있습니다.
        </p>
      </section>

      <div className="chart-layout">
        <section className="data-panel chart-panel" aria-labelledby="equity-title">
          <div className="panel-heading">
            <div>
              <span>02</span>
              <h3 id="equity-title">Equity curve</h3>
            </div>
            <strong>{currency(metrics.endingEquity, market.currency)}</strong>
          </div>
          <AccessibleChart
            points={result.equityCurve}
            value="equity"
            label="Portfolio equity"
            currency={market.currency}
          />
        </section>

        <section className="data-panel chart-panel" aria-labelledby="drawdown-title">
          <div className="panel-heading">
            <div>
              <span>03</span>
              <h3 id="drawdown-title">Drawdown</h3>
            </div>
            <strong>{signedPercent(metrics.maxDrawdownPercent)}</strong>
          </div>
          <AccessibleChart
            points={result.equityCurve}
            value="drawdownPercent"
            label="Portfolio drawdown"
          />
        </section>
      </div>

      <section className="data-panel" aria-labelledby="trades-title">
        <div className="panel-heading">
          <div>
            <span>04</span>
            <h3 id="trades-title">Trade history</h3>
          </div>
          <strong>{result.trades.length} ENTRIES</strong>
        </div>
        <div
          className="table-scroll"
          role="region"
          aria-label="거래 내역 표 가로 스크롤 영역"
          tabIndex={0}
        >
          <table aria-label="거래 내역">
            <thead>
              <tr>
                <th scope="col">Signal → Fill</th>
                <th scope="col">Symbol</th>
                <th scope="col">Entry</th>
                <th scope="col">Exit</th>
                <th scope="col">Outcome</th>
                <th scope="col">Engine reason</th>
              </tr>
            </thead>
            <tbody>
              {result.trades.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    이 데이터 구간에서는 모든 진입 조건이 동시에 충족되지 않았습니다.
                  </td>
                </tr>
              ) : (
                result.trades.map((trade) => (
                  <tr key={`${trade.signalDate}-${trade.entryDate}`}>
                    <td>
                      {trade.signalDate}
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only">에서 다음 세션인 </span>
                      {trade.entryDate}
                    </td>
                    <td>{trade.symbol}</td>
                    <td>{currency(trade.entryPrice, market.currency)}</td>
                    <td>
                      {trade.exitPrice === undefined
                        ? "—"
                        : currency(trade.exitPrice, market.currency)}
                    </td>
                    <td>{tradeOutcome(trade, market.currency)}</td>
                    <td>
                      <strong className="reason-label">ENTRY</strong>
                      <ul className="reason-list">
                        {trade.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      {trade.exitReason ? (
                        <p className="exit-reason">
                          <strong>EXIT</strong>
                          Close {currency(trade.exitReason.signalClose, market.currency)} ≤ stop{" "}
                          {currency(trade.exitReason.stopPrice, market.currency)} after peak{" "}
                          {currency(trade.exitReason.peakPrice, market.currency)}; filled next
                          session at {currency(trade.exitReason.fillPrice, market.currency)}.
                        </p>
                      ) : (
                        <p className="exit-reason">EXIT · Position remains open.</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="assumption-layout">
        <section className="data-panel" aria-labelledby="assumptions-title">
          <div className="panel-heading compact">
            <div>
              <span>05</span>
              <h3 id="assumptions-title">Execution assumptions</h3>
            </div>
          </div>
          <dl className="assumption-list">
            <div>
              <dt>신호 / 체결</dt>
              <dd>
                {result.execution.signalAt} / {result.execution.fillAt}
              </dd>
            </div>
            <div>
              <dt>수수료 / slippage / 매도세</dt>
              <dd>
                {result.costs.commissionBps} / {result.costs.slippageBps} /{" "}
                {result.costs.sellTaxBps}
                bps (paper assumptions)
              </dd>
            </div>
            <div>
              <dt>시간대 / 달력</dt>
              <dd>
                {market.timeZone} / {market.calendar}
              </dd>
            </div>
            <div>
              <dt>데이터</dt>
              <dd>
                {market.source} · {market.version} ·
                {market.adjustedPrices ? " adjusted" : " unadjusted"}
              </dd>
            </div>
          </dl>
        </section>

        <aside className="limitation-panel" aria-labelledby="limitations-title">
          <p className="eyebrow">DO NOT OVERREAD</p>
          <h3 id="limitations-title">Paper result, not a forecast</h3>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
