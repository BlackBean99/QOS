"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { BacktestRunListItem, StoredBacktestRun } from "@/src/domain/strategy-history";

interface Props {
  strategyId?: string;
  refreshKey: number;
}

interface ErrorPayload {
  error?: { message?: string };
}

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function percent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function StrategyBacktestHistory({ strategyId, refreshKey }: Props) {
  const titleId = useId();
  const endpoint = strategyId
    ? `/api/strategies/${strategyId}/backtests?limit=20`
    : "/api/backtest-runs?limit=20";
  const requestKey = `${endpoint}:${refreshKey}`;
  const [runs, setRuns] = useState<BacktestRunListItem[]>([]);
  const [selected, setSelected] = useState<{
    requestKey: string;
    run: StoredBacktestRun;
  } | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [loadFailedKey, setLoadFailedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const requestKeyRef = useRef(requestKey);
  const detailControllerRef = useRef<AbortController | null>(null);
  const loading = loadedKey !== requestKey;
  const loadFailed = loadFailedKey === requestKey;
  const visibleRuns = loading ? [] : runs;
  const selectedRun = selected?.requestKey === requestKey ? selected.run : null;
  const HistoryHeading = strategyId ? "h4" : "h3";

  useEffect(() => {
    const controller = new AbortController();
    requestKeyRef.current = requestKey;
    detailControllerRef.current?.abort();
    void fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as { runs?: BacktestRunListItem[] } & ErrorPayload;
        if (!response.ok || !payload.runs) {
          throw new Error(payload.error?.message ?? "백테스트 이력을 불러오지 못했습니다.");
        }
        setRuns(payload.runs);
        setLoadFailedKey("");
        setStatus("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRuns([]);
          setLoadFailedKey(requestKey);
          setStatus(
            error instanceof Error ? error.message : "백테스트 이력을 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(requestKey);
      });
    return () => {
      controller.abort();
      detailControllerRef.current?.abort();
    };
  }, [endpoint, requestKey]);

  async function openRun(id: string) {
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    const scope = requestKey;
    detailControllerRef.current = controller;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/backtest-runs/${id}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const payload = (await response.json()) as { run?: StoredBacktestRun } & ErrorPayload;
      if (!response.ok || !payload.run) {
        throw new Error(payload.error?.message ?? "백테스트 상세를 불러오지 못했습니다.");
      }
      if (requestKeyRef.current === scope && detailControllerRef.current === controller) {
        setSelected({ requestKey: scope, run: payload.run });
        setStatus("백테스트 실행 snapshot을 불러왔습니다.");
      }
    } catch (error) {
      if (!controller.signal.aborted && requestKeyRef.current === scope) {
        setStatus(error instanceof Error ? error.message : "백테스트 상세를 불러오지 못했습니다.");
      }
    } finally {
      if (detailControllerRef.current === controller) {
        detailControllerRef.current = null;
        setBusy(false);
      }
    }
  }

  async function removeRun(run: BacktestRunListItem) {
    if (
      !window.confirm(`${dateTime.format(new Date(run.createdAt))} 백테스트 이력을 삭제할까요?`)
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/backtest-runs/${run.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as ErrorPayload;
        throw new Error(payload.error?.message ?? "백테스트 이력을 삭제하지 못했습니다.");
      }
      setRuns((current) => current.filter((candidate) => candidate.id !== run.id));
      if (selectedRun?.id === run.id) setSelected(null);
      setStatus("백테스트 이력을 삭제했습니다.");
      requestAnimationFrame(() => sectionRef.current?.focus());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "백테스트 이력을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      ref={sectionRef}
      className="strategy-history"
      aria-labelledby={titleId}
      aria-busy={loading || busy}
      tabIndex={-1}
    >
      <header>
        <div>
          <span>PERSISTED RESULT SNAPSHOTS</span>
          <HistoryHeading id={titleId}>
            {strategyId ? "백테스트 이력" : "전체 백테스트 이력"}
          </HistoryHeading>
        </div>
        <strong>{visibleRuns.length} RUNS</strong>
      </header>
      <p className="strategy-history-status" role="status" aria-live="polite">
        {loading ? "백테스트 이력을 불러오는 중입니다." : status}
      </p>
      {!loading && !loadFailed && visibleRuns.length === 0 ? (
        <p className="strategy-history-empty">아직 저장된 실행 결과가 없습니다.</p>
      ) : (
        <ul className="strategy-history-list" aria-label="백테스트 이력 목록">
          {visibleRuns.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="history-open"
                disabled={busy}
                aria-pressed={selectedRun?.id === run.id}
                onClick={() => void openRun(run.id)}
              >
                <span>{dateTime.format(new Date(run.createdAt))}</span>
                <strong>{percent(run.summary.totalReturnPercent)}</strong>
                <small>
                  {!strategyId ? (
                    <>
                      {run.strategyName} · {run.instrumentId} ·{" "}
                      {run.strategyId ? "저장 전략" : "삭제된 전략"} ·{" "}
                    </>
                  ) : null}
                  MDD {percent(run.summary.maxDrawdownPercent)} · {run.summary.trades} trades · rev{" "}
                  {run.strategyRevision}
                </small>
              </button>
              <button
                type="button"
                className="history-delete"
                disabled={busy}
                aria-label={`${dateTime.format(new Date(run.createdAt))} 백테스트 이력 삭제`}
                onClick={() => void removeRun(run)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedRun ? (
        <details className="strategy-history-detail" open>
          <summary>선택 실행 JSON · {selectedRun.engineVersion}</summary>
          <dl>
            <div>
              <dt>수익률</dt>
              <dd>{percent(selectedRun.summary.totalReturnPercent)}</dd>
            </div>
            <div>
              <dt>Sharpe</dt>
              <dd>{selectedRun.summary.sharpeRatio.toFixed(2)}</dd>
            </div>
            <div>
              <dt>기간</dt>
              <dd>
                {selectedRun.summary.periodStart} → {selectedRun.summary.periodEnd}
              </dd>
            </div>
          </dl>
          <pre tabIndex={0}>{JSON.stringify(selectedRun, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}
