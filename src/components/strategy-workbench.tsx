"use client";

import { useState, type FormEvent } from "react";

import type { BacktestResult } from "@/src/domain/backtest";
import type { ResearchComparisonResult } from "@/src/domain/advanced-backtest";
import type { ResearchStrategy } from "@/src/domain/advanced-strategy";
import type { InstrumentId, InstrumentSummary } from "@/src/domain/instruments";
import { createInstrumentSnapshot } from "@/src/domain/stored-strategy";
import {
  StrategySchema,
  type InterpretationIssue,
  type InterpretationResult,
  type Strategy,
} from "@/src/domain/strategy";
import { AdvancedResearch } from "./advanced-research";
import { BacktestDashboard } from "./backtest-dashboard";
import { InstrumentPicker } from "./instrument-picker";
import { StrategyBuilder } from "./strategy-builder";
import { StrategyCard } from "./strategy-card";

type Status = "idle" | "parsing" | "ready" | "running" | "complete";
type InputMode = "builder" | "prompt" | "research";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function focusAfterRender(selector: string) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  });
}

export function StrategyWorkbench({
  instruments,
  onStrategyChange,
  onBacktestResult,
  onResearchResult,
}: {
  instruments: InstrumentSummary[];
  onStrategyChange?: (strategy: Strategy | ResearchStrategy | null) => void;
  onBacktestResult?: (result: BacktestResult) => void;
  onResearchResult?: (result: ResearchComparisonResult) => void;
}) {
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<InstrumentId>(
    instruments[0].instrumentId,
  );
  const [mode, setMode] = useState<InputMode>("builder");
  const [prompt, setPrompt] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [issues, setIssues] = useState<InterpretationIssue[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const isBusy = status === "parsing" || status === "running";
  const selectedInstrument =
    instruments.find((instrument) => instrument.instrumentId === selectedInstrumentId) ??
    instruments[0];

  function resetOutput() {
    setStrategy(null);
    setResult(null);
    setIssues([]);
    setRunError(null);
    setWarnings([]);
    setStatus("idle");
    onStrategyChange?.(null);
  }

  function changeMode(nextMode: InputMode) {
    if (mode === nextMode || isBusy) return;
    resetOutput();
    setMode(nextMode);
    focusAfterRender(
      nextMode === "builder"
        ? 'input[name="instrument"]:checked'
        : nextMode === "research"
          ? "#research-prompt"
          : "#strategy-prompt",
    );
  }

  function changeInstrument(instrumentId: InstrumentId) {
    if (isBusy || instrumentId === selectedInstrumentId) return;
    resetOutput();
    setSelectedInstrumentId(instrumentId);
  }

  function handleBuilderConfirm(nextStrategy: Strategy) {
    setStrategy(nextStrategy);
    setResult(null);
    setIssues([]);
    setRunError(null);
    setWarnings([
      selectedInstrument.synthetic
        ? "선택한 조건은 synthetic fixture에 적용됩니다."
        : "선택한 조건은 TOSS 수정주가 일봉에 적용됩니다.",
      "종가에서 신호를 확인하고 다음 세션 시가에 체결합니다.",
    ]);
    setStatus("ready");
    onStrategyChange?.(nextStrategy);
  }

  function loadJsonDraft() {
    try {
      const candidate = StrategySchema.parse(JSON.parse(jsonDraft));
      if (
        candidate.market !== selectedInstrument.market ||
        candidate.instrumentId !== selectedInstrumentId
      )
        throw new Error("JSON의 시장·종목이 현재 선택과 일치해야 합니다.");
      setStrategy(candidate);
      setIssues([]);
      setWarnings([
        "직접 입력한 JSON 전략을 검증했습니다.",
        "종가 신호는 다음 세션 시가에 체결합니다.",
      ]);
      setStatus("ready");
      onStrategyChange?.(candidate);
    } catch (error) {
      setIssues([
        {
          field: "prompt",
          message: error instanceof Error ? error.message : "JSON 전략을 확인해 주세요.",
        },
      ]);
      focusAfterRender("#prompt-errors");
    }
  }

  async function handleInterpret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;

    setStatus("parsing");
    setIssues([]);
    setRunError(null);
    setStrategy(null);
    setResult(null);

    try {
      const response = await fetch("/api/strategies/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          instrumentId: selectedInstrumentId,
          instrument: createInstrumentSnapshot(selectedInstrument),
        }),
      });
      const payload = (await readJson(response)) as InterpretationResult | null;

      if (!response.ok || !payload?.ok) {
        setIssues(
          payload && !payload.ok
            ? payload.issues
            : [{ field: "prompt", message: "입력값을 확인하고 다시 시도해 주세요." }],
        );
        setStatus("idle");
        focusAfterRender("#prompt-errors");
        return;
      }

      setStrategy(payload.strategy);
      setWarnings(payload.warnings);
      setStatus("ready");
      onStrategyChange?.(payload.strategy);
    } catch {
      setIssues([{ field: "prompt", message: "로컬 서버 연결을 확인해 주세요." }]);
      setStatus("idle");
      focusAfterRender("#prompt-errors");
    }
  }

  async function handleBacktest() {
    if (!strategy || isBusy) return;
    setStatus("running");
    setIssues([]);
    setRunError(null);

    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy,
          instrument: createInstrumentSnapshot(selectedInstrument),
        }),
      });
      const payload = (await readJson(response)) as BacktestResult | { error: string } | null;
      if (!response.ok || !payload || "error" in payload) {
        setRunError(
          payload && "error" in payload && payload.error
            ? payload.error
            : "백테스트를 완료하지 못했습니다.",
        );
        setStatus("ready");
        return;
      }

      setResult(payload);
      onBacktestResult?.(payload);
      setStatus("complete");
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("#backtest-results")?.focus();
      });
    } catch {
      setRunError("백테스트 서버 응답을 확인할 수 없습니다.");
      setStatus("ready");
    }
  }

  return (
    <section className="workbench" id="strategy-builder" aria-labelledby="workbench-title">
      <div className="workbench-main">
        <header className="studio-heading">
          <div>
            <span>NEW / 01</span>
            <h1 id="workbench-title">전략 조립</h1>
          </div>
          <div className="mode-switch" aria-label="전략 입력 방식">
            <button
              type="button"
              aria-pressed={mode === "builder"}
              onClick={() => changeMode("builder")}
            >
              빠른 조립
            </button>
            <button
              type="button"
              aria-pressed={mode === "prompt"}
              onClick={() => changeMode("prompt")}
            >
              문장 입력
            </button>
            <button
              type="button"
              aria-pressed={mode === "research"}
              onClick={() => changeMode("research")}
            >
              지표 연구
            </button>
          </div>
        </header>

        <InstrumentPicker
          key={`picker-${selectedInstrumentId}`}
          instruments={instruments}
          selectedInstrumentId={selectedInstrumentId}
          isBusy={isBusy}
          onSelect={changeInstrument}
        />

        {mode === "research" ? (
          <AdvancedResearch
            key={`research-${selectedInstrumentId}`}
            instrument={selectedInstrument}
            onStrategyChange={onStrategyChange}
            onResult={onResearchResult}
          />
        ) : mode === "builder" ? (
          <StrategyBuilder
            instrument={selectedInstrument}
            onConfirm={handleBuilderConfirm}
            onDirty={resetOutput}
            isBusy={isBusy}
          />
        ) : (
          <form className="prompt-form prompt-studio" onSubmit={handleInterpret} noValidate>
            <div className="prompt-topline">
              <label htmlFor="strategy-prompt">투자 전략 설명</label>
              <span>{prompt.length.toLocaleString("ko-KR")} / 2,000</span>
            </div>
            <div className="prompt-shell">
              <span className="prompt-prefix" aria-hidden="true">
                &gt;
              </span>
              <textarea
                id="strategy-prompt"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  if (strategy || result || issues.length) resetOutput();
                }}
                aria-describedby={issues.length > 0 ? "prompt-errors" : undefined}
                aria-invalid={issues.length > 0}
                aria-busy={isBusy}
                maxLength={2_000}
                readOnly={isBusy}
                rows={5}
              />
            </div>

            {issues.length > 0 ? (
              <div
                className="error-panel example-recovery"
                id="prompt-errors"
                role="alert"
                tabIndex={-1}
              >
                <div className="recovery-heading">
                  <div>
                    <strong>이 문장을 자동으로 확정하지 않았습니다.</strong>
                    <p>
                      자유로운 전략은 JSON으로 직접 검토하거나 OPENAI_API_KEY가 설정된 서버에서
                      변환할 수 있습니다.
                    </p>
                  </div>
                </div>
                <ul className="issue-list">
                  {issues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
                <label htmlFor="strategy-json-draft">검토할 Strategy JSON</label>
                <textarea
                  id="strategy-json-draft"
                  value={jsonDraft}
                  onChange={(event) => setJsonDraft(event.target.value)}
                  rows={12}
                  placeholder='{"version":1,"name":"...","entry":{...}}'
                />
                <button
                  type="button"
                  onClick={loadJsonDraft}
                  disabled={isBusy || !jsonDraft.trim()}
                >
                  JSON 검증 후 전략으로 사용
                </button>
              </div>
            ) : null}

            <button
              className="primary-button prompt-submit"
              type="submit"
              disabled={isBusy || prompt.length === 0}
            >
              <span>{status === "parsing" ? "구조화 중" : "전략 구조화"}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        )}

        <p className="live-status" aria-live="polite">
          {status === "parsing" && "전략 문장을 확인하고 있습니다."}
          {status === "running" && "TOSS 일봉으로 백테스트를 실행하고 있습니다."}
          {status === "complete" && "백테스트가 완료되었습니다."}
        </p>

        {runError ? (
          <div className="error-panel" role="alert">
            <strong>백테스트를 완료하지 못했습니다.</strong>
            <p>{runError}</p>
          </div>
        ) : null}

        {strategy ? (
          <StrategyCard
            strategy={strategy}
            instrument={selectedInstrument}
            warnings={warnings}
            isRunning={status === "running"}
            onRun={handleBacktest}
          />
        ) : null}

        {result ? <BacktestDashboard result={result} /> : null}
      </div>
    </section>
  );
}
