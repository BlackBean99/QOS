"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import type { ResearchComparisonResult } from "@/src/domain/advanced-backtest";
import type { ResearchStrategy } from "@/src/domain/advanced-strategy";
import type { BacktestResult } from "@/src/domain/backtest";
import type { BacktestResultV3 } from "@/src/domain/backtest-v3/engine";
import type { BacktestWindowInput } from "@/src/domain/backtest-window";
import { InstrumentSummarySchema, type InstrumentSummary } from "@/src/domain/instruments";
import {
  createInstrumentSnapshot,
  type ChartSettings,
  type StoredStrategy,
} from "@/src/domain/stored-strategy";
import type { Strategy } from "@/src/domain/strategy";
import type { StrategyDefinitionV3, StrategyTimeframe } from "@/src/domain/strategy-v3/schema";
import type { DecisionTrace } from "@/src/domain/strategy-runtime/rules";
import { MarketChartPanel } from "./market-chart/market-chart-panel";
import type { ChartLevel, ChartSignal } from "./market-chart/interactive-market-chart";
import { StrategyLibrary } from "./strategy-library";
import { StrategyWorkbench } from "./strategy-workbench";
import { StrategyEngineWorkbench } from "./strategy-engine/strategy-engine-workbench";
import { TelegramSettings } from "./telegram-settings";
import {
  StrategyRecommendationPanel,
  type BacktestWindowDraft,
  type RecommendationCandidate,
} from "./strategy-recommendation-panel";

type ExecutableStrategy = Strategy | ResearchStrategy | StrategyDefinitionV3;

function chartPeriod(timeframe: StrategyTimeframe): ChartSettings["period"] {
  return timeframe === "1m" ? "1m" : timeframe === "1d" || timeframe === "1w" ? "1d" : "5m";
}

const SearchResponseSchema = z
  .object({
    instruments: z.array(InstrumentSummarySchema),
    source: z.literal("TOSS OpenAPI"),
    cache: z
      .object({
        status: z.enum(["HIT", "REFRESHED", "STALE"]),
        origin: z.enum(["MEMORY", "DISK", "PROVIDER", "MIXED"]).nullable(),
        fetchedAt: z.iso.datetime({ offset: true }).nullable(),
        expiresAt: z.iso.datetime({ offset: true }).nullable(),
        markets: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .passthrough();

const DEFAULT_CHART: ChartSettings = {
  version: 1,
  period: "1d",
  theme: "upbit-light",
  mainIndicators: ["MA", "BOLL"],
  subIndicators: ["VOL", "RSI"],
  drawings: [],
  visibleRange: null,
};

function dailySignals(result: BacktestResult): ChartSignal[] {
  return result.trades.flatMap((trade) => {
    const signals: ChartSignal[] = [
      {
        side: "BUY",
        timestamp: trade.entryDate,
        price: trade.entryPrice,
        reason: trade.reasons.join(" · "),
      },
    ];
    if (trade.exitDate && trade.exitPrice !== undefined) {
      signals.push({
        side: "SELL",
        timestamp: trade.exitDate,
        price: trade.exitPrice,
        reason: trade.exitReason
          ? `Trailing stop ${trade.exitReason.stopPrice.toLocaleString("ko-KR")}`
          : "청산 조건 충족",
      });
    }
    return signals;
  });
}

function researchSignals(result: ResearchComparisonResult): ChartSignal[] {
  return (result.runs[0]?.trades ?? []).flatMap((trade) => {
    const signals: ChartSignal[] = [
      {
        side: "BUY",
        timestamp: trade.entryAt,
        price: trade.entryPrice,
        reason: `${result.strategy.entry.sessionLookback}-session VWAP 상향 돌파`,
      },
    ];
    if (trade.exitAt && trade.exitPrice !== undefined) {
      signals.push({
        side: "SELL",
        timestamp: trade.exitAt,
        price: trade.exitPrice,
        reason: trade.exitReason ?? result.runs[0]?.label ?? "청산 조건 충족",
      });
    }
    return signals;
  });
}

function strategyV3Signals(result: BacktestResultV3): ChartSignal[] {
  const explanations = (trace: DecisionTrace): string[] =>
    trace.type === "GROUP"
      ? trace.children.flatMap(explanations)
      : [
          `${trace.label ?? trace.id}: ${trace.current.left ?? "—"} ${trace.operator} ${trace.current.right ?? trace.current.lower ?? "—"} ${trace.passed ? "✓" : "✕"}`,
        ];
  return result.trades.flatMap((trade) => {
    const signals: ChartSignal[] = [
      {
        side: trade.side === "LONG" ? "BUY" : "SELL",
        timestamp: trade.entryAt,
        price: trade.entryPrice,
        reason: explanations(trade.entryTrace).join(" · "),
      },
    ];
    if (trade.exitAt && trade.exitPrice !== undefined)
      signals.push({
        side: trade.side === "LONG" ? "SELL" : "BUY",
        timestamp: trade.exitAt,
        price: trade.exitPrice,
        reason: trade.exitReason ?? "Strategy v3 exit",
      });
    return signals;
  });
}

function chartIndicatorsForV3(
  strategy: StrategyDefinitionV3,
): Pick<ChartSettings, "mainIndicators" | "subIndicators"> {
  const document = JSON.stringify(strategy);
  const main: ChartSettings["mainIndicators"] = [];
  const sub: ChartSettings["subIndicators"] = [];
  if (document.includes('"kind":"VWAP"')) main.push("VWAP");
  if (document.includes('"kind":"ICHIMOKU"')) main.push("ICHIMOKU");
  if (document.includes('"kind":"BOLLINGER"')) main.push("BOLL");
  if (document.includes('"kind":"EMA"')) main.push("EMA");
  if (document.includes('"kind":"VOLUME"') || document.includes('"kind":"RELATIVE_VOLUME"'))
    sub.push("VOL");
  if (document.includes('"kind":"RSI"')) sub.push("RSI");
  if (document.includes('"kind":"MACD"')) sub.push("MACD");
  return { mainIndicators: main.slice(0, 7), subIndicators: sub.slice(0, 4) };
}

function strategyV3Levels(result: BacktestResultV3): ChartLevel[] {
  return result.trades.flatMap((trade) => {
    const end = trade.exitAt ?? result.period.end;
    const stops = trade.stopPath.map((point, index) => ({
      from: point.at,
      to: trade.stopPath[index + 1]?.at ?? end,
      value: point.value,
      label: point.reason,
      kind: index === 0 ? ("STOP" as const) : ("TRAILING" as const),
    }));
    const targets = trade.fills
      .filter((fill) => fill.grossPnl > 0)
      .map((fill) => ({
        from: trade.entryAt,
        to: fill.at,
        value: fill.rawPrice,
        label: fill.reason,
        kind: "TARGET" as const,
      }));
    return [...stops, ...targets];
  });
}

export function MarketWorkspace() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<"KR" | "US">("KR");
  const [results, setResults] = useState<InstrumentSummary[]>([]);
  const [selected, setSelected] = useState<InstrumentSummary | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRecovery, setSearchRecovery] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [chart, setChart] = useState<ChartSettings>(DEFAULT_CHART);
  const [signals, setSignals] = useState<ChartSignal[]>([]);
  const [levels, setLevels] = useState<ChartLevel[]>([]);
  const [currentStrategy, setCurrentStrategy] = useState<ExecutableStrategy | null>(null);
  const [runStatus, setRunStatus] = useState<string>("");
  const [workbenchKey, setWorkbenchKey] = useState(0);
  const [libraryKey, setLibraryKey] = useState(0);
  const [backtestWindow, setBacktestWindow] = useState<BacktestWindowDraft>({
    startDate: "",
    endDate: "",
  });
  const searchRequestRef = useRef(0);

  const handleChartChange = useCallback((next: ChartSettings) => setChart(next), []);

  async function runInstrumentSearch(forceRefresh = false) {
    if (!query.trim() || searching) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearching(true);
    setSearchError(null);
    setSearchRecovery("");
    setSearchNotice("");
    try {
      const params = new URLSearchParams({ query: query.trim(), region });
      if (forceRefresh) params.set("refresh", "true");
      const response = await fetch(`/api/instruments?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      const body: unknown = await response.json();
      const parsed = SearchResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        const message = (body as { error?: { message?: string } })?.error?.message;
        throw new Error(message ?? "TOSS 종목 검색 결과를 확인하지 못했습니다.");
      }
      if (requestId !== searchRequestRef.current) return;
      setResults(parsed.data.instruments);
      if (parsed.data.instruments.length === 0) {
        setSearchError("일치하는 실제 상장 종목이 없습니다.");
        setSearchRecovery("시장과 종목명 또는 티커를 확인한 뒤 다시 조회하세요.");
      } else {
        const cache = parsed.data.cache;
        const fetchedAt = cache?.fetchedAt
          ? new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(cache.fetchedAt))
          : null;
        const cacheNotice = cache
          ? `${
              cache.status === "STALE"
                ? " · 이전 local catalog 사용"
                : cache.status === "REFRESHED"
                  ? " · TOSS catalog 갱신"
                  : " · local catalog cache"
            } · ${cache.origin ?? "UNKNOWN"}${fetchedAt ? ` · ${fetchedAt} 기준` : ""}`
          : "";
        setSearchNotice(
          `TOSS 거래 가능 종목 ${parsed.data.instruments.length}건을 찾았습니다.${cacheNotice}`,
        );
      }
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      setResults([]);
      setSearchError(error instanceof Error ? error.message : "종목 검색을 완료하지 못했습니다.");
      setSearchRecovery("TOSS 서버 설정과 허용 IP를 확인한 뒤 다시 조회하세요.");
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runInstrumentSearch();
  }

  function changeRegion(nextRegion: "KR" | "US") {
    if (nextRegion === region) return;
    searchRequestRef.current += 1;
    setRegion(nextRegion);
    setSearching(false);
    setResults([]);
    setSearchError(null);
    setSearchRecovery("");
    setSearchNotice(`검색할 시장이 ${nextRegion === "KR" ? "국내" : "미국"}로 바뀌었습니다.`);
  }

  function changeQuery(nextQuery: string) {
    searchRequestRef.current += 1;
    setQuery(nextQuery);
    setSearching(false);
    setResults([]);
    setSearchError(null);
    setSearchRecovery("");
    setSearchNotice("");
  }

  function startNewStrategy() {
    setCurrentStrategy(null);
    setSignals([]);
    setLevels([]);
    setRunStatus("");
    setWorkbenchKey((value) => value + 1);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(selected ? "#workbench-title" : "#provider-search-title")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectPreset(nextStrategy: Strategy | ResearchStrategy, title: string) {
    setCurrentStrategy(nextStrategy);
    setSignals([]);
    setLevels([]);
    setRunStatus(`${title} 프리셋을 불러왔습니다. 전략 조립 화면에서 조건을 수정할 수 있습니다.`);
    setChart((current) => ({ ...current, period: chartPeriod(nextStrategy.timeframe) }));
    setWorkbenchKey((value) => value + 1);
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>("#workbench-title")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function chooseInstrument(instrument: InstrumentSummary) {
    setSelected(instrument);
    setSignals([]);
    setLevels([]);
    setCurrentStrategy(null);
    setRunStatus("");
    setChart(DEFAULT_CHART);
    setWorkbenchKey((value) => value + 1);
    setBacktestWindow({ startDate: "", endDate: "" });
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#market-chart-title")?.focus?.(),
    );
  }

  function applyRecommendation(candidate: RecommendationCandidate) {
    const next = candidate.strategy;
    setCurrentStrategy(next);
    setSignals([]);
    setLevels([]);
    setChart((current) => ({
      ...current,
      ...chartIndicatorsForV3(next),
      period: chartPeriod(next.timeframe),
      visibleRange: null,
    }));
    setRunStatus(
      `${candidate.presetName} 추천을 적용했습니다. Rule Chain과 Exit를 수정한 뒤 백테스트하세요.`,
    );
    setWorkbenchKey((value) => value + 1);
  }

  async function trackRecommendation(
    candidate: RecommendationCandidate,
    analyzedWindow: { startDate: string; endDate: string },
  ) {
    if (!selected) throw new Error("트래킹할 종목을 다시 선택해 주세요.");
    const next = candidate.strategy;
    const response = await fetch("/api/strategies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `[추천] ${candidate.presetName} · ${selected.symbol}`.slice(0, 100),
        description: `전체 Entry 후보 비교에서 선택한 과거 수익률 추천 · ${analyzedWindow.startDate} — ${analyzedWindow.endDate}`,
        instrument: createInstrumentSnapshot(selected),
        strategy: next,
        chart: {
          ...chart,
          ...chartIndicatorsForV3(next),
          period: chartPeriod(next.timeframe),
          visibleRange: null,
        },
        monitor: { enabled: true, interval: next.timeframe },
      }),
    });
    const payload = (await response.json()) as {
      strategy?: StoredStrategy;
      error?: { message?: string };
    };
    if (!response.ok || !payload.strategy) {
      throw new Error(payload.error?.message ?? "추천 전략을 저장하지 못했습니다.");
    }
    applyRecommendation(candidate);
    setLibraryKey((value) => value + 1);
    setRunStatus(`“${payload.strategy.name}” 저장 완료 · paper tracking ON`);
  }

  function loadStored(document: StoredStrategy) {
    setSelected({ ...document.instrument, aliases: [] });
    setChart(document.chart);
    setSignals([]);
    setLevels([]);
    setCurrentStrategy(document.strategy);
    setRunStatus(`“${document.name}” 전략과 차트 설정을 불러왔습니다.`);
    setWorkbenchKey((value) => value + 1);
    requestAnimationFrame(() =>
      window.document
        .querySelector<HTMLElement>("#market-chart-title")
        ?.scrollIntoView({ block: "start" }),
    );
  }

  async function runStored(document: StoredStrategy) {
    setRunStatus("저장 전략을 TOSS 과거 데이터로 실행하고 있습니다.");
    try {
      const response = await fetch(`/api/strategies/${document.id}/backtests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(backtestWindow.startDate && backtestWindow.endDate ? { window: backtestWindow } : {}),
        }),
      });
      const payload = (await response.json()) as {
        result?: BacktestResult | ResearchComparisonResult;
        error?: string | { message?: string };
      };
      if (!response.ok || !payload.result) {
        const error = payload.error;
        throw new Error(
          typeof error === "string" ? error : (error?.message ?? "백테스트를 완료하지 못했습니다."),
        );
      }
      const body = payload.result;
      setSelected({ ...document.instrument, aliases: [] });
      setChart(document.chart);
      if (document.strategy.version === 1 && "trades" in body) {
        setSignals(dailySignals(body as BacktestResult));
        setRunStatus(
          `백테스트 완료 · 수익률 ${(body as BacktestResult).metrics.totalReturnPercent.toFixed(2)}% · 체결 ${(body as BacktestResult).trades.length}건`,
        );
      } else if (document.strategy.version === 2) {
        const research = body as ResearchComparisonResult;
        setSignals(researchSignals(research));
        setRunStatus(
          `청산 비교 완료 · ${research.runs.length}개 설정 · 기본 run 수익률 ${(research.runs[0]?.metrics.totalReturnPercent ?? 0).toFixed(2)}%`,
        );
      } else {
        const engine = body as unknown as BacktestResultV3;
        setSignals(strategyV3Signals(engine));
        setLevels(strategyV3Levels(engine));
        setRunStatus(
          `Strategy v3 완료 · 수익률 ${engine.metrics.totalReturnPercent.toFixed(2)}% · 거래 ${engine.metrics.numberOfTrades}건`,
        );
      }
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : "저장 전략을 실행하지 못했습니다.");
      throw error;
    }
  }

  return (
    <div className="market-workspace" id="workspace">
      <div className="workspace-command-grid">
        <section
          className="provider-search"
          id="market-search"
          aria-labelledby="provider-search-title"
        >
          <header>
            <div>
              <span className="eyebrow">01 / MARKET DISCOVERY</span>
              <h1 id="provider-search-title">실제 종목 검색</h1>
            </div>
            <p>TOSS OpenAPI의 거래 가능 주식·ETF·ETN·REIT 등을 이름이나 티커로 찾습니다.</p>
          </header>
          <form onSubmit={search} role="search">
            <fieldset>
              <legend>시장 지역</legend>
              <label>
                <input
                  type="radio"
                  name="region"
                  checked={region === "KR"}
                  onChange={() => changeRegion("KR")}
                />{" "}
                국내
              </label>
              <label>
                <input
                  type="radio"
                  name="region"
                  checked={region === "US"}
                  onChange={() => changeRegion("US")}
                />{" "}
                미국
              </label>
            </fieldset>
            <label className="provider-query">
              <span>종목명 또는 티커</span>
              <input
                type="search"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder={region === "KR" ? "삼성전자 또는 005930" : "Apple 또는 AAPL"}
                autoComplete="off"
                maxLength={80}
                aria-describedby={searchError ? "provider-search-error" : undefined}
              />
            </label>
            <div className="provider-search-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={searching || !query.trim()}
              >
                {searching ? "TOSS 조회 중" : "종목 조회"}
              </button>
              <button
                type="button"
                disabled={searching || !query.trim()}
                onClick={() => void runInstrumentSearch(true)}
              >
                TOSS catalog 새로고침
              </button>
            </div>
          </form>
          {searchError ? (
            <p id="provider-search-error" className="provider-error" role="alert">
              <strong>{searchError}</strong>
              <span>{searchRecovery}</span>
            </p>
          ) : null}
          {searchNotice ? (
            <p className="provider-notice" role="status" aria-live="polite">
              {searchNotice}
            </p>
          ) : null}
          {results.length > 0 ? (
            <ul className="provider-results" aria-label="TOSS 종목 검색 결과">
              {results.map((instrument) => (
                <li key={instrument.instrumentId}>
                  <button
                    type="button"
                    aria-pressed={selected?.instrumentId === instrument.instrumentId}
                    onClick={() => chooseInstrument(instrument)}
                  >
                    <span>
                      <strong>{instrument.displayName}</strong>
                      <small>
                        {instrument.symbol} · {instrument.market}
                      </small>
                    </span>
                    <em>
                      {instrument.securityType ?? "기타"} · {instrument.currency}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <TelegramSettings />
      </div>

      {selected ? (
        <>
          <nav className="workspace-section-nav" aria-label="선택 종목 작업 순서">
            <span>
              <b>선택 종목</b> {selected.displayName} · {selected.symbol}
            </span>
            <a href="#strategy-recommendation">02 추천</a>
            <a href="#market-chart-title">03 차트</a>
            <a href="#strategy-builder">04 전략</a>
            <a href="#strategy-library">05 저장</a>
          </nav>
          <StrategyRecommendationPanel
            key={selected.instrumentId}
            instrument={selected}
            backtestWindow={backtestWindow}
            onWindowChange={setBacktestWindow}
            onApply={applyRecommendation}
            onTrack={trackRecommendation}
          />
          <MarketChartPanel
            instrument={selected}
            settings={chart}
            signals={signals}
            levels={levels}
            onSettingsChange={handleChartChange}
          />
          <p className="workspace-run-status" role="status" aria-live="polite">
            {runStatus}
          </p>
          {currentStrategy && currentStrategy.version !== 3 ? (
            <StrategyWorkbench
              key={`${selected.instrumentId}-${workbenchKey}`}
              instruments={[selected]}
              onStrategyChange={(strategy) => {
                setCurrentStrategy(strategy);
                if (strategy)
                  setChart((current) => ({
                    ...current,
                    period: chartPeriod(strategy.timeframe),
                    visibleRange: null,
                  }));
              }}
              onBacktestResult={(result) => {
                setSignals(dailySignals(result));
                setRunStatus(
                  `백테스트 BUY/SELL ${dailySignals(result).length}개를 차트에 표시했습니다.`,
                );
              }}
              onResearchResult={(result) => {
                setSignals(researchSignals(result));
                setRunStatus(
                  `지표 연구 BUY/SELL ${researchSignals(result).length}개를 차트에 표시했습니다.`,
                );
              }}
            />
          ) : (
            <StrategyEngineWorkbench
              key={`${selected.instrumentId}-${workbenchKey}`}
              instrument={selected}
              initialStrategy={currentStrategy?.version === 3 ? currentStrategy : null}
              onStrategyChange={(next) => {
                setCurrentStrategy(next);
                setLevels([]);
                if (next) {
                  const indicators = chartIndicatorsForV3(next);
                  setChart((current) => ({
                    ...current,
                    ...indicators,
                    period: chartPeriod(next.timeframe),
                    visibleRange: null,
                  }));
                }
              }}
              onResult={(engine) => {
                const nextSignals = strategyV3Signals(engine);
                setSignals(nextSignals);
                setLevels(strategyV3Levels(engine));
                setRunStatus(`Strategy v3 BUY/SELL ${nextSignals.length}개를 차트에 표시했습니다.`);
              }}
              backtestWindow={
                backtestWindow.startDate && backtestWindow.endDate
                  ? (backtestWindow as BacktestWindowInput)
                  : undefined
              }
            />
          )}
        </>
      ) : (
        <section className="workspace-empty" aria-label="종목 선택 안내">
          <div>
            <span>START / SEARCH OR RECOVER</span>
            <h2>종목을 찾거나, 저장 전략을 바로 복구하세요.</h2>
            <p>
              새 연구는 실제 종목 검색에서 시작합니다. 기존 전략은 아래 라이브러리에서 provider 검색
              없이 다시 열 수 있습니다.
            </p>
          </div>
          <ol className="workspace-steps" aria-label="QOS 작업 순서">
            <li>
              <b>01</b>
              <span>종목 선택</span>
              <small>TOSS stock master</small>
            </li>
            <li>
              <b>02</b>
              <span>차트·전략 검증</span>
              <small>paper backtest</small>
            </li>
            <li>
              <b>03</b>
              <span>저장·감시</span>
              <small>JSON + Telegram</small>
            </li>
          </ol>
        </section>
      )}
      <StrategyLibrary
        key={libraryKey}
        instrument={selected}
        currentStrategy={currentStrategy}
        chart={chart}
        onLoad={loadStored}
        onRun={runStored}
        onCreate={startNewStrategy}
        onPresetSelect={selectPreset}
      />
    </div>
  );
}
