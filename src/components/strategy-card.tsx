import type { InstrumentSummary } from "@/src/domain/instruments";
import type { Strategy } from "@/src/domain/strategy";

interface StrategyCardProps {
  strategy: Strategy;
  instrument: InstrumentSummary;
  warnings: string[];
  isRunning: boolean;
  onRun: () => void;
}

function priceRule(strategy: Strategy): string {
  const rule = strategy.entry.price;
  return rule.kind === "rolling_high_breakout"
    ? `${rule.period}일 고점 상향 돌파`
    : `${rule.period}일 이동평균 상향 돌파`;
}

export function StrategyCard({
  strategy,
  instrument,
  warnings,
  isRunning,
  onRun,
}: StrategyCardProps) {
  const fields = [
    { label: "INSTRUMENT", value: `${instrument.displayName} · ${instrument.symbol}` },
    { label: "MARKET", value: strategy.market },
    { label: "TIMEFRAME", value: "1 DAY" },
    { label: "ENTRY / PRICE", value: priceRule(strategy) },
    {
      label: "ENTRY / VOLUME",
      value: `${strategy.entry.volume.period}일 평균 × ${strategy.entry.volume.ratio}`,
    },
    { label: "EXIT", value: `고점 대비 ${strategy.exit.percent}% trailing stop` },
    { label: "FILL", value: "다음 fixture 세션 시가" },
  ];

  return (
    <article className="strategy-card" aria-labelledby="structured-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">STEP 02 / CONFIRM</p>
          <h2 id="structured-title">구조화된 전략</h2>
        </div>
        <span className="schema-badge">SCHEMA V{strategy.version}</span>
      </div>

      <div className="strategy-name-row">
        <div>
          <span>STRATEGY</span>
          <strong>{strategy.name}</strong>
        </div>
        <span className="validated-badge">
          <span aria-hidden="true">✓</span> VALIDATED
        </span>
      </div>

      <dl className="rule-grid">
        {fields.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>

      <div className="warning-stack" aria-label="실행 전 주의사항">
        {warnings.map((warning) => (
          <p key={warning}>
            <span aria-hidden="true">!</span>
            {warning}
          </p>
        ))}
      </div>

      <details className="json-details">
        <summary>Strategy JSON 보기</summary>
        <pre>{JSON.stringify(strategy, null, 2)}</pre>
      </details>

      <div className="run-row">
        <p>
          <span>EXECUTION</span>
          종가 신호 → 다음 세션 시가 체결
        </p>
        <button
          className="primary-button run-button"
          type="button"
          onClick={onRun}
          disabled={isRunning}
        >
          <span>{isRunning ? "실행 중" : "백테스트 실행"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}
