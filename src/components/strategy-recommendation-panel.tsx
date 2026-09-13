"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import type { InstrumentSummary } from "@/src/domain/instruments";
import { createInstrumentSnapshot } from "@/src/domain/stored-strategy";
import {
  StrategyDefinitionV3Schema,
  type StrategyTimeframe,
} from "@/src/domain/strategy-v3/schema";

export interface BacktestWindowDraft {
  startDate: string;
  endDate: string;
}

const RecommendationMetricsSchema = z
  .object({
    totalReturnPercent: z.number().finite(),
    maximumDrawdownPercent: z.number().finite(),
    sharpeRatio: z.number().finite(),
    numberOfTrades: z.number().int().nonnegative(),
  })
  .strict();

const RecommendationCandidateSchema = z
  .object({
    rank: z.number().int().positive(),
    presetId: z.string(),
    presetName: z.string(),
    category: z.string(),
    strategy: StrategyDefinitionV3Schema,
    metrics: RecommendationMetricsSchema,
  })
  .strict();

const RecommendationResponseSchema = z
  .object({
    methodology: z
      .object({
        catalogVersion: z.string(),
        candidatesEvaluated: z.number().int().positive(),
        ranking: z.literal("TOTAL_RETURN_DESC"),
        baselineExit: z.string(),
        execution: z.string(),
      })
      .strict(),
    window: z
      .object({
        source: z.enum(["DEFAULT", "CUSTOM"]),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
        label: z.string(),
      })
      .strict(),
    dataPeriod: z
      .object({
        start: z.string(),
        end: z.string(),
        bars: z.number().int().positive(),
      })
      .strict(),
    recommendation: RecommendationCandidateSchema.nullable(),
    rankings: z.array(RecommendationCandidateSchema).max(5),
    warnings: z.array(z.string()),
    cache: z.enum(["HIT", "MISS", "COALESCED"]),
    requestId: z.string(),
  })
  .strict();

export type RecommendationCandidate = z.infer<typeof RecommendationCandidateSchema>;

interface Props {
  instrument: InstrumentSummary;
  backtestWindow: BacktestWindowDraft;
  onWindowChange: (window: BacktestWindowDraft) => void;
  onApply: (candidate: RecommendationCandidate) => void;
  onTrack: (
    candidate: RecommendationCandidate,
    analyzedWindow: z.infer<typeof RecommendationResponseSchema>["window"],
  ) => Promise<void>;
}

const timeframes: StrategyTimeframe[] = ["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"];

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function drawdown(value: number): string {
  return `${Math.abs(value) === 0 ? "" : "−"}${Math.abs(value).toFixed(2)}%`;
}

export function StrategyRecommendationPanel({
  instrument,
  backtestWindow,
  onWindowChange,
  onApply,
  onTrack,
}: Props) {
  const [timeframe, setTimeframe] = useState<StrategyTimeframe>("1d");
  const [result, setResult] = useState<z.infer<typeof RecommendationResponseSchema> | null>(null);
  const [status, setStatus] = useState("전체 Entry 후보를 같은 조건으로 준비하고 있습니다.");
  const [busy, setBusy] = useState(false);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [tracked, setTracked] = useState(false);
  const requestSequence = useRef(0);

  function invalidateResult(message = "조건이 변경되었습니다. 다시 분석해 주세요.") {
    requestSequence.current += 1;
    setResult(null);
    setTracked(false);
    setStatus(message);
  }

  const requestRecommendation = useCallback(
    async (
      selectedTimeframe: StrategyTimeframe,
      selectedWindow?: BacktestWindowDraft,
      signal?: AbortSignal,
    ) => {
      const requestId = ++requestSequence.current;
      await Promise.resolve();
      if (signal?.aborted) return;
      setBusy(true);
      setStatus("전체 Entry 후보를 동일한 데이터·비용으로 평가하고 있습니다.");
      try {
        const response = await fetch("/api/strategy-recommendations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instrument: createInstrumentSnapshot(instrument),
            timeframe: selectedTimeframe,
            ...(selectedWindow?.startDate && selectedWindow.endDate
              ? { window: selectedWindow }
              : {}),
          }),
          signal,
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const message = (body as { error?: { message?: string } })?.error?.message;
          throw new Error(message ?? "전략 추천을 완료하지 못했습니다.");
        }
        const parsed = RecommendationResponseSchema.safeParse(body);
        if (!parsed.success) throw new Error("전략 추천 응답을 검증하지 못했습니다.");
        if (requestId !== requestSequence.current) return;
        setResult(parsed.data);
        setTracked(false);
        setStatus(
          parsed.data.recommendation
            ? `${parsed.data.methodology.candidatesEvaluated}개 Entry 후보 비교를 완료했습니다.`
            : "선택 기간에 거래가 발생한 추천 후보가 없습니다.",
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestId !== requestSequence.current) return;
        setResult(null);
        setStatus(error instanceof Error ? error.message : "전략 추천을 완료하지 못했습니다.");
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [instrument],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void requestRecommendation("1d", undefined, controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestRecommendation]);

  function analyze() {
    if (
      (backtestWindow.startDate && !backtestWindow.endDate) ||
      (!backtestWindow.startDate && backtestWindow.endDate)
    ) {
      setStatus("시작일과 종료일을 함께 입력하거나 둘 다 비워 자동 기간을 사용하세요.");
      return;
    }
    void requestRecommendation(timeframe, backtestWindow);
  }

  const winner = result?.recommendation ?? null;
  return (
    <section
      className="strategy-recommendation"
      id="strategy-recommendation"
      aria-labelledby="strategy-recommendation-title"
      aria-busy={busy || trackingBusy}
    >
      <header>
        <div>
          <span className="eyebrow">02 / ALL-ENTRY RESEARCH</span>
          <h2 id="strategy-recommendation-title">과거 수익률 추천</h2>
        </div>
        <p>
          두세 가지 전략만 고르지 않습니다. 현재 Entry preset 전체를 같은 기간, baseline Exit와
          비용으로 실행해 과거 총수익률 순으로 비교합니다.
        </p>
      </header>

      <div className="recommendation-controls">
        <label>
          <span>추천 timeframe</span>
          <select
            value={timeframe}
            onChange={(event) => {
              setTimeframe(event.target.value as StrategyTimeframe);
              invalidateResult();
            }}
          >
            {timeframes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>분석 시작일</span>
          <input
            type="date"
            value={backtestWindow.startDate}
            onChange={(event) => {
              onWindowChange({ ...backtestWindow, startDate: event.target.value });
              invalidateResult();
            }}
          />
        </label>
        <label>
          <span>분석 종료일</span>
          <input
            type="date"
            value={backtestWindow.endDate}
            onChange={(event) => {
              onWindowChange({ ...backtestWindow, endDate: event.target.value });
              invalidateResult();
            }}
          />
        </label>
        <button type="button" className="primary-button" disabled={busy} onClick={analyze}>
          {busy ? "전체 후보 분석 중" : "이 기간으로 다시 분석"}
        </button>
      </div>
      <p className="recommendation-help">
        날짜를 비우면 분봉 30일 · 일봉 2년 · 주봉 5년을 자동 적용합니다. 분봉 직접 설정은 최근
        31일까지 지원합니다.
      </p>

      {winner ? (
        <div className="recommendation-result">
          <article className="recommendation-winner">
            <span>HISTORICAL RANK 01 · {winner.category}</span>
            <h3>{winner.presetName}</h3>
            <p>{result?.window.label}</p>
            <p>
              실제 데이터 {result?.dataPeriod.bars.toLocaleString("ko-KR")}봉 ·{" "}
              {result ? new Date(result.dataPeriod.start).toLocaleDateString("ko-KR") : ""} —{" "}
              {result ? new Date(result.dataPeriod.end).toLocaleDateString("ko-KR") : ""}
            </p>
            <dl>
              <div>
                <dt>총수익률</dt>
                <dd>{percent(winner.metrics.totalReturnPercent)}</dd>
              </div>
              <div>
                <dt>MDD</dt>
                <dd>{drawdown(winner.metrics.maximumDrawdownPercent)}</dd>
              </div>
              <div>
                <dt>Sharpe</dt>
                <dd>{winner.metrics.sharpeRatio.toFixed(2)}</dd>
              </div>
              <div>
                <dt>거래</dt>
                <dd>{winner.metrics.numberOfTrades}회</dd>
              </div>
            </dl>
            <div className="recommendation-actions">
              <button type="button" onClick={() => onApply(winner)}>
                추천 전략 적용
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={trackingBusy || tracked}
                onClick={() => {
                  setTrackingBusy(true);
                  setStatus("추천 전략을 저장하고 paper tracking을 켜는 중입니다.");
                  void onTrack(winner, result!.window)
                    .then(() => {
                      setTracked(true);
                      setStatus("저장 완료 · 트래킹 ON · local monitor가 60초 안에 반영합니다.");
                    })
                    .catch((error) =>
                      setStatus(
                        error instanceof Error ? error.message : "트래킹을 켜지 못했습니다.",
                      ),
                    )
                    .finally(() => setTrackingBusy(false));
                }}
              >
                {tracked ? "트래킹 ON" : trackingBusy ? "저장 중" : "저장하고 트래킹 ON"}
              </button>
            </div>
          </article>

          <div className="recommendation-ranking">
            <h3>상위 후보</h3>
            <ol>
              {result?.rankings.map((candidate) => (
                <li key={candidate.presetId}>
                  <b>{String(candidate.rank).padStart(2, "0")}</b>
                  <span>
                    <strong>{candidate.presetName}</strong>
                    <small>
                      {candidate.category} · {candidate.metrics.numberOfTrades} trades · MDD{" "}
                      {drawdown(candidate.metrics.maximumDrawdownPercent)} · Sharpe{" "}
                      {candidate.metrics.sharpeRatio.toFixed(2)}
                    </small>
                  </span>
                  <em>{percent(candidate.metrics.totalReturnPercent)}</em>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      <p className="recommendation-status" role="status" aria-live="polite">
        {status}
      </p>
      {result ? (
        <div className="recommendation-warning">
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p>
            {result.methodology.execution} · {result.methodology.baselineExit}
          </p>
        </div>
      ) : null}
    </section>
  );
}
