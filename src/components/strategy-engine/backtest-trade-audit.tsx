import type {
  BacktestEventV3,
  BacktestNoTradeReasonV3,
  BacktestResultV3,
} from "@/src/domain/backtest-v3/engine";
import type { DecisionTrace, GroupDecisionTrace } from "@/src/domain/strategy-runtime/rules";

function eventLabel(
  type: BacktestEventV3["type"],
  side: BacktestResultV3["strategy"]["side"],
): string {
  if (type === "ENTRY_REJECTED") return "진입 거절";
  if (type === "FORCED_EXIT") return "기간 종료 청산";
  const entryAction = side === "LONG" ? "BUY" : "SELL";
  const exitAction = side === "LONG" ? "SELL" : "BUY";
  if (type === "ENTRY_SIGNAL") return `${entryAction} 신호`;
  if (type === "ENTRY_FILL") return `${entryAction} 체결`;
  if (type === "EXIT_SIGNAL") return `${exitAction} 신호`;
  return `${exitAction} 체결`;
}

function eventAction(
  type: BacktestEventV3["type"],
  side: BacktestResultV3["strategy"]["side"],
): "BUY" | "SELL" | undefined {
  if (type === "ENTRY_REJECTED") return undefined;
  const isEntry = type === "ENTRY_SIGNAL" || type === "ENTRY_FILL";
  return isEntry === (side === "LONG") ? "BUY" : "SELL";
}

const noTradeLabels: Record<BacktestNoTradeReasonV3, string> = {
  WARM_UP_ONLY: "선택 구간이 지표 준비 기간보다 짧아 규칙을 판정할 수 없었습니다.",
  NO_ENTRY_MATCH: "준비 기간 이후 Entry Rule Chain을 모두 통과한 봉이 없었습니다.",
  FILTER_BLOCKED: "Entry 조건은 발생했지만 Filter가 모든 신호를 차단했습니다.",
  ORDER_NOT_FILLED: "신호는 발생했지만 지정한 주문 가격이 다음 봉에서 체결되지 않았습니다.",
  POSITION_SIZE_ZERO: "신호는 발생했지만 포지션 크기·리스크 한도로 주문 수량이 0이었습니다.",
  SIGNAL_AT_END_OF_DATA: "마지막 봉에서 신호가 발생해 다음 봉 체결 데이터가 없었습니다.",
};

function outcome(value: number): "gain" | "loss" | "flat" {
  return value > 0 ? "gain" : value < 0 ? "loss" : "flat";
}

function formatPercent(value: number, signed = true): string {
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function currencyFor(result: BacktestResultV3): "KRW" | "USD" {
  return result.strategy.market === "KOSPI" || result.strategy.market === "KOSDAQ" ? "KRW" : "USD";
}

function money(value: number, currency: "KRW" | "USD"): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
}

function quantity(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(value);
}

function cumulativeTradePnl(trades: BacktestResultV3["trades"]): number[] {
  const values: number[] = [];
  let cumulative = 0;
  for (const trade of trades) {
    cumulative += trade.netPnl;
    values.push(cumulative);
  }
  return values;
}

function timestamp(value: string | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function flattenTrace(trace: DecisionTrace): DecisionTrace[] {
  return trace.type === "GROUP"
    ? trace.children.flatMap((child) =>
        child.type === "GROUP" ? [child, ...flattenTrace(child)] : [child],
      )
    : [trace];
}

function TraceView({ trace, title }: { trace: GroupDecisionTrace; title: string }) {
  return (
    <div className="trade-trace">
      <h5>{title}</h5>
      <ul className="engine-trace-list">
        {flattenTrace(trace).map((child, index) => (
          <li key={`${child.id}-${index}`} data-pass={child.passed}>
            {child.type === "CONDITION" ? (
              <>
                <span>{child.label ?? child.id}</span>
                <strong>{child.status}</strong>
                <code>
                  {child.current.left ?? "—"} {child.operator}{" "}
                  {child.current.right ?? child.current.lower ?? "—"}
                </code>
              </>
            ) : (
              <>
                <span>{child.label ?? child.id}</span>
                <strong>
                  {child.operator} · {child.passed ? "PASS" : "FAIL"}
                </strong>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BacktestTradeAudit({ result }: { result: BacktestResultV3 }) {
  const currency = currencyFor(result);
  const zone = result.dataPolicy.marketTimeZone;
  const cumulativeNetPnl = cumulativeTradePnl(result.trades);

  return (
    <div className="trade-audit">
      {result.diagnostics.noTradeReason ? (
        <section className="trade-diagnostic" aria-labelledby="trade-diagnostic-title">
          <span>NO EXECUTED TRADE</span>
          <h4 id="trade-diagnostic-title">0% 수익이 아니라, 체결된 거래가 없습니다</h4>
          <p>{noTradeLabels[result.diagnostics.noTradeReason]}</p>
          <dl>
            <div>
              <dt>평가 봉</dt>
              <dd>{result.diagnostics.evaluatedBars.toLocaleString("ko-KR")}</dd>
            </div>
            <div>
              <dt>Warm-up 봉</dt>
              <dd>{result.diagnostics.warmupBars.toLocaleString("ko-KR")}</dd>
            </div>
            <div>
              <dt>Entry 통과</dt>
              <dd>{result.diagnostics.entryPasses.toLocaleString("ko-KR")}</dd>
            </div>
            <div>
              <dt>Filter 통과</dt>
              <dd>{result.diagnostics.filterPasses.toLocaleString("ko-KR")}</dd>
            </div>
            <div>
              <dt>조합 신호</dt>
              <dd>{result.diagnostics.combinedSignals.toLocaleString("ko-KR")}</dd>
            </div>
            <div>
              <dt>거절</dt>
              <dd>{result.diagnostics.rejectedSignals.toLocaleString("ko-KR")}</dd>
            </div>
          </dl>
          {result.diagnostics.conditionStats.length ? (
            <div className="trade-table-scroll" tabIndex={0} aria-label="조건별 판정 집계 표">
              <table className="trade-audit-table">
                <caption>조건별 판정 집계</caption>
                <thead>
                  <tr>
                    <th scope="col">구간</th>
                    <th scope="col">Rule</th>
                    <th scope="col">PASS</th>
                    <th scope="col">FAIL</th>
                    <th scope="col">WARM-UP</th>
                    <th scope="col">마지막 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {result.diagnostics.conditionStats.map((stat) => (
                    <tr key={`${stat.scope}-${stat.ruleId}`}>
                      <td>{stat.scope}</td>
                      <th scope="row">{stat.label}</th>
                      <td>{stat.passed}</td>
                      <td>{stat.failed}</td>
                      <td>{stat.warmup}</td>
                      <td>{stat.lastStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {result.events.length ? (
        <details className="trade-event-log" open>
          <summary>매수·매도 실행 로그 · {result.events.length} events</summary>
          <p className="trade-scroll-hint">
            표를 좌우로 스크롤하면 가격·수량·손익을 볼 수 있습니다.
          </p>
          <div className="trade-table-scroll" tabIndex={0} aria-label="매수·매도 실행 로그 표">
            <table className="trade-audit-table">
              <caption>신호와 실제 체결 순서</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">이벤트</th>
                  <th scope="col">시장 시각</th>
                  <th scope="col">체결가</th>
                  <th scope="col">수량</th>
                  <th scope="col">사유</th>
                  <th scope="col">이번 순손익</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((event) => (
                  <tr
                    key={event.sequence}
                    data-event={event.type}
                    data-action={eventAction(event.type, result.strategy.side)}
                  >
                    <td>{String(event.sequence).padStart(2, "0")}</td>
                    <th scope="row">{eventLabel(event.type, result.strategy.side)}</th>
                    <td title={event.at}>{timestamp(event.at, zone)}</td>
                    <td>{event.price === undefined ? "—" : money(event.price, currency)}</td>
                    <td>{event.quantity === undefined ? "—" : quantity(event.quantity)}</td>
                    <td>{event.reason}</td>
                    <td data-outcome={outcome(event.netPnl ?? 0)}>
                      {event.netPnl === undefined ? "—" : money(event.netPnl, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {result.trades.length ? (
        <section className="trade-ledger" aria-labelledby="trade-ledger-title">
          <header>
            <div>
              <span>TRADE-BY-TRADE AUDIT</span>
              <h4 id="trade-ledger-title">실제 체결 손익</h4>
            </div>
            <p>원시 가격 손익 − 수수료 − 슬리피지 = 순손익</p>
          </header>
          {result.trades.map((trade, index) => {
            return (
              <details className="trade-card" key={`${trade.entryAt}-${index}`}>
                <summary>
                  <b>#{String(index + 1).padStart(2, "0")}</b>
                  <span>
                    <strong>{trade.side === "LONG" ? "BUY → SELL" : "SELL → BUY"}</strong>
                    <small>
                      {timestamp(trade.entryAt, zone)} → {timestamp(trade.exitAt, zone)} ·{" "}
                      {trade.exitReason ?? "OPEN"}
                    </small>
                  </span>
                  <em data-outcome={outcome(trade.netPnl)}>
                    {money(trade.netPnl, currency)} · {formatPercent(trade.returnPercent)}
                  </em>
                </summary>

                <ol className="trade-timeline" aria-label={`거래 ${index + 1} 체결 타임라인`}>
                  <li data-kind="signal">
                    <span>01</span>
                    <strong>{trade.side === "LONG" ? "BUY" : "SELL"} 신호 확정</strong>
                    <time dateTime={trade.entrySignalAt}>
                      {timestamp(trade.entrySignalAt, zone)}
                    </time>
                    <small>봉 마감 Rule Chain 통과</small>
                  </li>
                  <li data-kind="entry" data-action={trade.side === "LONG" ? "BUY" : "SELL"}>
                    <span>02</span>
                    <strong>{trade.side === "LONG" ? "BUY" : "SELL"} 체결</strong>
                    <time dateTime={trade.entryAt}>{timestamp(trade.entryAt, zone)}</time>
                    <small>
                      {money(trade.entryPrice, currency)} × {quantity(trade.positionSize)}
                    </small>
                  </li>
                  {trade.fills.map((fill, fillIndex) => (
                    <li
                      data-kind="exit"
                      data-action={trade.side === "LONG" ? "SELL" : "BUY"}
                      key={`${fill.at}-${fill.ruleId}-${fillIndex}`}
                    >
                      <span>{String(fillIndex + 3).padStart(2, "0")}</span>
                      <strong>
                        {fill.remainingQuantity > 0 ? "분할" : "최종"}{" "}
                        {trade.side === "LONG" ? "SELL" : "BUY"}
                      </strong>
                      <time dateTime={fill.at}>{timestamp(fill.at, zone)}</time>
                      <small>
                        {money(fill.price, currency)} × {quantity(fill.quantity)} ·{" "}
                        <b data-outcome={outcome(fill.netPnl)}>
                          {money(fill.netPnl, currency)} ({formatPercent(fill.returnPercent)})
                        </b>
                      </small>
                    </li>
                  ))}
                </ol>

                <dl className="trade-accounting">
                  <div>
                    <dt>원시 가격 손익</dt>
                    <dd data-outcome={outcome(trade.grossPnl)}>
                      {money(trade.grossPnl, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>수수료</dt>
                    <dd>− {money(trade.fee, currency)}</dd>
                  </div>
                  <div>
                    <dt>슬리피지·스프레드</dt>
                    <dd>− {money(trade.slippageCost, currency)}</dd>
                  </div>
                  <div>
                    <dt>순손익</dt>
                    <dd data-outcome={outcome(trade.netPnl)}>{money(trade.netPnl, currency)}</dd>
                  </div>
                  <div>
                    <dt>누적 순손익</dt>
                    <dd data-outcome={outcome(cumulativeNetPnl[index] ?? 0)}>
                      {money(cumulativeNetPnl[index] ?? 0, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>R / 보유</dt>
                    <dd>
                      {trade.rMultiple?.toFixed(2) ?? "—"}R · {trade.holdingBars}봉
                    </dd>
                  </div>
                  <div>
                    <dt>MFE / MAE</dt>
                    <dd>
                      {formatPercent(trade.mfePercent, false)} /{" "}
                      {formatPercent(trade.maePercent, false)}
                    </dd>
                  </div>
                  <div>
                    <dt>진입 raw / 체결</dt>
                    <dd>
                      {money(trade.entryRawPrice, currency)} / {money(trade.entryPrice, currency)}
                    </dd>
                  </div>
                </dl>
                <TraceView trace={trade.entryTrace} title="매수 Decision Trace" />
                {trade.exitTrace ? (
                  <TraceView trace={trade.exitTrace} title="매도 Decision Trace" />
                ) : null}
              </details>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
