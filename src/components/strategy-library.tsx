"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { ResearchStrategy } from "@/src/domain/advanced-strategy";
import type { InstrumentSummary } from "@/src/domain/instruments";
import {
  createInstrumentSnapshot,
  MAX_STRATEGY_DOCUMENT_BYTES,
  type ChartSettings,
  type StoredStrategy,
} from "@/src/domain/stored-strategy";
import type { Strategy } from "@/src/domain/strategy";
import type { StrategyDefinitionV3, StrategyTimeframe } from "@/src/domain/strategy-v3/schema";
import type { InterpretationResult } from "@/src/domain/strategy";
import { STRATEGY_PRESETS } from "@/src/domain/strategy-presets";
import { StrategyBacktestHistory } from "./strategy-backtest-history";

type ExecutableStrategy = Strategy | ResearchStrategy | StrategyDefinitionV3;

function chartPeriod(timeframe: StrategyTimeframe): ChartSettings["period"] {
  return timeframe === "1m" ? "1m" : timeframe === "1d" || timeframe === "1w" ? "1d" : "5m";
}

interface Props {
  instrument: InstrumentSummary | null;
  currentStrategy: ExecutableStrategy | null;
  chart: ChartSettings;
  onLoad: (strategy: StoredStrategy) => void;
  onRun: (strategy: StoredStrategy) => Promise<void>;
  onCreate: () => void;
  onPresetSelect: (strategy: Strategy | ResearchStrategy, presetTitle: string) => void;
}

interface StrategyListPayload {
  strategies?: StoredStrategy[];
  error?: { message?: string };
}

const REQUEST_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function readableRequestError(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "요청 시간이 초과되었습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  return error instanceof Error ? error.message : fallback;
}

function editableDocument(document: StoredStrategy, monitor = document.monitor) {
  return {
    expectedRevision: document.revision,
    name: document.name,
    description: document.description,
    instrument: document.instrument,
    strategy: document.strategy,
    chart: document.chart,
    monitor,
  };
}

export function StrategyLibrary({
  instrument,
  currentStrategy,
  chart,
  onLoad,
  onRun,
  onCreate,
  onPresetSelect,
}: Props) {
  const [strategies, setStrategies] = useState<StoredStrategy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRequestRef = useRef(0);
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? null;

  async function refresh(preferredId?: string) {
    const generation = ++listRequestRef.current;
    const response = await fetchWithTimeout("/api/strategies", {
      headers: { accept: "application/json" },
    });
    const payload = (await response.json()) as StrategyListPayload;
    if (!response.ok || !payload.strategies)
      throw new Error(payload.error?.message ?? "전략 목록을 불러오지 못했습니다.");
    if (generation !== listRequestRef.current) return;
    setStrategies(payload.strategies);
    setLoadError("");
    setLoading(false);
    if (preferredId) setSelectedId(preferredId);
  }

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8_000);
    const generation = ++listRequestRef.current;
    void fetch("/api/strategies", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as StrategyListPayload;
        if (!response.ok || !payload.strategies) throw new Error(payload.error?.message);
        if (generation === listRequestRef.current) {
          setStrategies(payload.strategies);
          setLoadError("");
        }
      })
      .catch(() => {
        if ((!controller.signal.aborted || timedOut) && generation === listRequestRef.current)
          setLoadError("저장 전략 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if ((!controller.signal.aborted || timedOut) && generation === listRequestRef.current)
          setLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  function applyCommittedStrategy(document: StoredStrategy) {
    ++listRequestRef.current;
    setStrategies((current) => [document, ...current.filter((item) => item.id !== document.id)]);
    setSelectedId(document.id);
    setLoadError("");
  }

  async function synchronizeAfterCommit(success: string, preferredId?: string) {
    setStatus("저장된 전략 목록을 확인하는 중입니다…");
    try {
      await refresh(preferredId);
      setStatus(success);
    } catch {
      setLoading(false);
      setStatus(`${success} 다만 원격 목록 재확인에 실패했습니다. 새로고침해 주세요.`);
    }
  }

  async function saveNew() {
    if (!instrument || !name.trim()) {
      setStatus("종목을 선택하고 저장 이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setLoadError("");
    setStatus(
      currentStrategy
        ? "전략 JSON을 저장하는 중입니다…"
        : "자연어 조건을 JSON 전략으로 변환하는 중입니다…",
    );
    try {
      let strategyToSave = currentStrategy;
      if (!strategyToSave) {
        if (description.trim().length < 12) {
          throw new Error("전략 설명에 지원되는 자연어 조건을 입력해 주세요.");
        }
        const parseResponse = await fetchWithTimeout("/api/strategies/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: description.trim(),
            instrumentId: instrument.instrumentId,
            instrument: createInstrumentSnapshot(instrument),
          }),
        });
        const parsed = (await parseResponse.json()) as InterpretationResult | null;
        if (!parseResponse.ok || !parsed?.ok) {
          throw new Error(
            parsed && !parsed.ok
              ? parsed.issues.map((issue) => issue.message).join(" ")
              : "자연어 전략을 JSON으로 구조화하지 못했습니다.",
          );
        }
        strategyToSave = parsed.strategy;
        setStatus("JSON 변환 완료. 전략을 저장하는 중입니다…");
      }
      const normalizedChart: ChartSettings = {
        ...chart,
        period: chartPeriod(strategyToSave.timeframe),
      };
      const response = await fetchWithTimeout("/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          instrument: createInstrumentSnapshot(instrument),
          strategy: strategyToSave,
          chart: normalizedChart,
          monitor: { enabled: false, interval: strategyToSave.timeframe },
        }),
      });
      const payload = (await response.json()) as {
        strategy?: StoredStrategy;
        error?: { message?: string };
      };
      if (!response.ok || !payload.strategy)
        throw new Error(payload.error?.message ?? "전략을 저장하지 못했습니다.");
      applyCommittedStrategy(payload.strategy);
      setStatus("저장 완료. 전략 목록을 확인하는 중입니다…");
      await synchronizeAfterCommit(
        "전략과 차트 설정을 JSON으로 저장했습니다.",
        payload.strategy.id,
      );
    } catch (error) {
      setStatus(readableRequestError(error, "전략을 저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function updateSelected() {
    if (!instrument || !selected || !currentStrategy) {
      setStatus("수정할 저장 전략과 현재 전략을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setStatus("전략 JSON과 차트 설정을 저장하는 중입니다…");
    try {
      const response = await fetchWithTimeout(`/api/strategies/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: selected.revision,
          name: name.trim() || selected.name,
          description,
          instrument: createInstrumentSnapshot(instrument),
          strategy: currentStrategy,
          chart: { ...chart, period: chartPeriod(currentStrategy.timeframe) },
          monitor: { enabled: selected.monitor.enabled, interval: currentStrategy.timeframe },
        }),
      });
      const payload = (await response.json()) as {
        strategy?: StoredStrategy;
        error?: { message?: string };
      };
      if (!response.ok || !payload.strategy)
        throw new Error(payload.error?.message ?? "전략을 수정하지 못했습니다.");
      applyCommittedStrategy(payload.strategy);
      setStatus("수정 완료. 전략 목록을 확인하는 중입니다…");
      await synchronizeAfterCommit("현재 전략과 차트 설정으로 수정했습니다.", payload.strategy.id);
    } catch (error) {
      setStatus(readableRequestError(error, "전략을 수정하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMonitor(document: StoredStrategy) {
    setBusy(true);
    try {
      const response = await fetch(`/api/strategies/${document.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editableDocument(document, {
            ...document.monitor,
            enabled: !document.monitor.enabled,
          }),
        ),
      });
      const payload = (await response.json()) as {
        strategy?: StoredStrategy;
        error?: { message?: string };
      };
      if (!response.ok || !payload.strategy)
        throw new Error(payload.error?.message ?? "감시 상태를 저장하지 못했습니다.");
      applyCommittedStrategy(payload.strategy);
      await synchronizeAfterCommit(
        payload.strategy.monitor.enabled
          ? "실시간 감시를 예약했습니다. npm run monitor 프로세스 상태를 확인하세요."
          : "실시간 감시를 중지했습니다.",
        payload.strategy.id,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "감시 상태를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(document: StoredStrategy) {
    if (
      !window.confirm(
        `“${document.name}” 전략을 삭제할까요? export하지 않았다면 복구할 수 없습니다.`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/strategies/${document.id}?expectedRevision=${document.revision}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? "전략을 삭제하지 못했습니다.");
      }
      ++listRequestRef.current;
      setSelectedId(null);
      setStrategies((current) => current.filter((item) => item.id !== document.id));
      setHistoryRefreshKey((value) => value + 1);
      await synchronizeAfterCommit("저장 전략을 삭제했습니다.");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "전략을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function runSelected(document: StoredStrategy) {
    setBusy(true);
    setStatus("백테스트를 실행하고 결과를 저장하는 중입니다…");
    try {
      await onRun(document);
      setHistoryRefreshKey((value) => value + 1);
      setStatus("백테스트 결과를 실행 이력에 저장했습니다.");
    } catch (error) {
      setStatus(readableRequestError(error, "저장 전략을 실행하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_STRATEGY_DOCUMENT_BYTES) {
      setStatus("가져올 JSON은 5MiB 이하여야 합니다.");
      return;
    }
    setBusy(true);
    try {
      const document = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/strategies/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, mode: "clone" }),
      });
      const payload = (await response.json()) as {
        imported?: number;
        error?: { message?: string };
      };
      if (!response.ok || payload.imported === undefined)
        throw new Error(payload.error?.message ?? "JSON을 가져오지 못했습니다.");
      ++listRequestRef.current;
      await synchronizeAfterCommit(`${payload.imported}개 전략을 새 id로 가져왔습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "유효한 QOS JSON 파일을 선택해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`strategy-library ${instrument ? "library-authoring-mode" : "library-recovery-mode"}`}
      id="strategy-library"
      aria-labelledby="strategy-library-title"
      aria-busy={busy}
    >
      <header>
        <div>
          <span className="eyebrow">PERSISTED JSON / CRUD</span>
          <h2 ref={headingRef} id="strategy-library-title" tabIndex={-1}>
            전략 라이브러리
          </h2>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !instrument}
          onClick={onCreate}
        >
          {instrument ? "새 전략 만들기" : "종목 선택 후 새 전략"}
        </button>
        <div className="library-file-actions">
          <a className="button-link" href="/api/strategies/export" download>
            JSON 내보내기
          </a>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => importRef.current?.click()}
          >
            JSON 가져오기
          </button>
          <input
            ref={importRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="전략 JSON 파일 선택"
            disabled={busy || loading}
            onChange={importJson}
          />
        </div>
      </header>

      {instrument ? (
        <div className="library-authoring">
          <section className="strategy-presets" aria-labelledby="strategy-presets-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">PUBLIC PRINCIPLES / EDITABLE JSON</span>
                <h3 id="strategy-presets-title">거장들의 공개 전략 원칙으로 시작하기</h3>
              </div>
              <p>프리셋은 출발점입니다. 종목·지표·청산 조건을 수정한 뒤 저장하세요.</p>
            </div>
            <div className="preset-grid">
              {STRATEGY_PRESETS.map((preset) => (
                <article key={preset.id} className="preset-card">
                  <span>{preset.timeframe}</span>
                  <h4>{preset.title}</h4>
                  <small>{preset.author}</small>
                  <p>{preset.principle}</p>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => {
                      const strategy = preset.create(instrument);
                      setName(strategy.name);
                      setDescription(`${preset.title}: ${preset.principle}`);
                      onPresetSelect(strategy, preset.title);
                      setStatus(
                        `${preset.title} JSON을 불러왔습니다. 조건을 수정한 뒤 저장하세요.`,
                      );
                    }}
                  >
                    이 프리셋으로 시작
                  </button>
                </article>
              ))}
            </div>
          </section>

          <div className="library-save-form">
            <label>
              저장 이름
              <input
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 삼성 20일 돌파"
              />
            </label>
            <label>
              설명 또는 자연어 전략 조건
              <textarea
                value={description}
                maxLength={500}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="예: NASDAQ에서 20일 고점을 돌파하고 거래량이 20일 평균의 2배 이상이면 매수, 고점 대비 5% 하락하면 매도."
              />
            </label>
            <div>
              <button
                className="primary-button"
                type="button"
                disabled={busy || loading || (!currentStrategy && description.trim().length < 12)}
                onClick={saveNew}
              >
                {busy ? "저장 중…" : "새 전략 저장"}
              </button>
              <button
                type="button"
                disabled={busy || !selected || !currentStrategy}
                onClick={updateSelected}
              >
                선택 전략 수정
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="library-recovery-note">
          저장 전략은 종목 검색 없이도 복구할 수 있습니다. 새 전략은 위에서 종목을 먼저 선택하세요.
        </p>
      )}

      <p className="library-status" role="status" aria-live="polite">
        {busy && status ? status : loading ? "전략 목록을 불러오는 중입니다." : loadError || status}
      </p>

      {loading || loadError ? null : strategies.length === 0 ? (
        <div>
          <p className="library-empty">
            저장한 전략이 없습니다. 전략을 구조화하고 차트를 설정한 뒤 저장하세요.
          </p>
          <StrategyBacktestHistory refreshKey={historyRefreshKey} />
        </div>
      ) : (
        <div className="library-layout">
          <ul className="strategy-list" aria-label="저장 전략 목록">
            {strategies.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === document.id}
                  onClick={() => {
                    setSelectedId(document.id);
                    setName(document.name);
                    setDescription(document.description);
                  }}
                >
                  <strong>{document.name}</strong>
                  <span>
                    {document.instrument.displayName} · {document.strategy.timeframe}
                  </span>
                  <small>
                    rev {document.revision} · {document.monitor.enabled ? "감시 중" : "중지"}
                  </small>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <article className="strategy-view" aria-label="선택 전략 상세">
              <header>
                <div>
                  <span>READ-ONLY VIEW</span>
                  <h3>{selected.name}</h3>
                </div>
                <span className={selected.monitor.enabled ? "monitor-on" : "monitor-off"}>
                  {selected.monitor.enabled ? "MONITOR ON" : "MONITOR OFF"}
                </span>
              </header>
              <dl>
                <div>
                  <dt>종목</dt>
                  <dd>
                    {selected.instrument.displayName} ({selected.instrument.symbol})
                  </dd>
                </div>
                <div>
                  <dt>시장/통화</dt>
                  <dd>
                    {selected.instrument.market} / {selected.instrument.currency}
                  </dd>
                </div>
                <div>
                  <dt>주기</dt>
                  <dd>{selected.strategy.timeframe}</dd>
                </div>
                <div>
                  <dt>지표</dt>
                  <dd>
                    {[...selected.chart.mainIndicators, ...selected.chart.subIndicators].join(
                      ", ",
                    ) || "없음"}
                  </dd>
                </div>
                <div>
                  <dt>그림</dt>
                  <dd>{selected.chart.drawings.length}개</dd>
                </div>
              </dl>
              <details>
                <summary>전략 JSON 보기</summary>
                <pre tabIndex={0}>{JSON.stringify(selected, null, 2)}</pre>
              </details>
              <div className="strategy-view-actions">
                <button type="button" onClick={() => onLoad(selected)}>
                  차트/설정 불러오기
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void runSelected(selected)}
                >
                  즉시 백테스트
                </button>
                <button type="button" disabled={busy} onClick={() => void toggleMonitor(selected)}>
                  {selected.monitor.enabled ? "실시간 감시 중지" : "실시간 감시 시작"}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(selected)}
                >
                  삭제
                </button>
              </div>
              <StrategyBacktestHistory strategyId={selected.id} refreshKey={historyRefreshKey} />
            </article>
          ) : (
            <div>
              <p className="strategy-view-empty">
                목록에서 전략을 선택하면 JSON과 실행 설정을 확인할 수 있습니다.
              </p>
              <StrategyBacktestHistory refreshKey={historyRefreshKey} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
