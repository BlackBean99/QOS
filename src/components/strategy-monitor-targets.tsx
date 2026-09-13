"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { InstrumentSummarySchema, type InstrumentSummary } from "@/src/domain/instruments";
import {
  createInstrumentSnapshot,
  type InstrumentSnapshot,
  type MonitorTargetControl,
  type StoredStrategy,
} from "@/src/domain/stored-strategy";
import {
  StrategyMonitorTargetRow,
  type MonitorPositionSummary,
} from "./strategy-monitor-target-row";

const TargetSearchResponseSchema = z
  .object({
    instruments: z.array(InstrumentSummarySchema),
    cache: z
      .object({
        status: z.enum(["HIT", "REFRESHED", "STALE"]),
        origin: z.enum(["MEMORY", "DISK", "PROVIDER", "MIXED"]).nullable(),
        fetchedAt: z.iso.datetime({ offset: true }).nullable(),
        expiresAt: z.iso.datetime({ offset: true }).nullable(),
        markets: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .passthrough();

function initialTargets(document: StoredStrategy): InstrumentSnapshot[] {
  return structuredClone(
    document.monitor.targets && document.monitor.targets.length > 0
      ? document.monitor.targets
      : [document.instrument],
  );
}

function initialControls(
  document: StoredStrategy,
  targets: InstrumentSnapshot[],
): MonitorTargetControl[] {
  const saved = new Map(
    document.monitor.targetControls?.map((control) => [control.instrumentId, control]) ?? [],
  );
  return targets.map(
    (target) =>
      saved.get(target.instrumentId) ?? { instrumentId: target.instrumentId, enabled: true },
  );
}

function cacheLabel(cache: z.infer<typeof TargetSearchResponseSchema>["cache"]): string {
  const timestamp = cache.fetchedAt
    ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(cache.fetchedAt),
      )
    : "기준 시각 없음";
  const origin = cache.origin ? ` · ${cache.origin}` : "";
  if (cache.status === "STALE") return `이전 catalog 사용${origin} · ${timestamp} 기준`;
  if (cache.status === "REFRESHED") return `TOSS catalog 갱신 완료${origin} · ${timestamp} 기준`;
  return `로컬 catalog cache${origin} · ${timestamp} 기준`;
}

export function StrategyMonitorTargets({
  document,
  busy,
  onSave,
}: {
  document: StoredStrategy;
  busy: boolean;
  onSave: (
    document: StoredStrategy,
    targets: InstrumentSnapshot[],
    targetControls: MonitorTargetControl[],
    enable: boolean,
  ) => Promise<void>;
}) {
  const [targets, setTargets] = useState<InstrumentSnapshot[]>(() => initialTargets(document));
  const [controls, setControls] = useState<MonitorTargetControl[]>(() =>
    initialControls(document, initialTargets(document)),
  );
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<"KR" | "US">(
    document.instrument.currency === "KRW" ? "KR" : "US",
  );
  const [results, setResults] = useState<InstrumentSummary[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [hedgeTargetId, setHedgeTargetId] = useState<string | null>(null);
  const [positions, setPositions] = useState<MonitorPositionSummary[]>([]);
  const requestRef = useRef(0);
  const activeCount = controls.filter((control) => control.enabled).length;

  useEffect(() => {
    let active = true;
    const refreshPositions = async () => {
      try {
        const response = await fetch("/api/monitor/status", {
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { positions?: MonitorPositionSummary[] };
        if (active) setPositions(payload.positions ?? []);
      } catch {
        // Keep the last confirmed paper state visible while the local status endpoint recovers.
      }
    };
    void refreshPositions();
    const timer = window.setInterval(() => {
      if (globalThis.document.visibilityState === "visible") void refreshPositions();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function runSearch(forceRefresh = false) {
    if (!query.trim() || searching) return;
    const generation = ++requestRef.current;
    setSearching(true);
    setMessage("");
    try {
      const parameters = new URLSearchParams({ query: query.trim(), region });
      if (forceRefresh) parameters.set("refresh", "true");
      const response = await fetch(`/api/instruments?${parameters.toString()}`, {
        headers: { accept: "application/json" },
      });
      const payload: unknown = await response.json();
      const parsed = TargetSearchResponseSchema.safeParse(payload);
      if (!response.ok || !parsed.success) {
        const errorMessage = (payload as { error?: { message?: string } })?.error?.message;
        throw new Error(errorMessage ?? "감시 종목을 검색하지 못했습니다.");
      }
      if (generation !== requestRef.current) return;
      setResults(parsed.data.instruments);
      setMessage(
        parsed.data.instruments.length === 0
          ? `일치하는 거래 가능 종목이 없습니다. · ${cacheLabel(parsed.data.cache)}`
          : `${parsed.data.instruments.length}건 · ${cacheLabel(parsed.data.cache)}`,
      );
    } catch (error) {
      if (generation !== requestRef.current) return;
      setResults([]);
      setMessage(error instanceof Error ? error.message : "감시 종목을 검색하지 못했습니다.");
    } finally {
      if (generation === requestRef.current) setSearching(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function changeRegion(next: "KR" | "US") {
    if (next === region) return;
    requestRef.current += 1;
    setRegion(next);
    setResults([]);
    setMessage("");
    setSearching(false);
  }

  function addTarget(instrument: InstrumentSummary) {
    if (hedgeTargetId) {
      if (instrument.instrumentId === hedgeTargetId) {
        setMessage("원 종목과 같은 상품은 헷지로 지정할 수 없습니다.");
        return;
      }
      const snapshot = createInstrumentSnapshot(instrument);
      setControls((current) =>
        current.map((control) =>
          control.instrumentId === hedgeTargetId
            ? { ...control, hedgeInstrument: snapshot }
            : control,
        ),
      );
      setHedgeTargetId(null);
      setResults([]);
      setMessage(
        `${instrument.displayName}을 매도 전환용 paper 헷지로 지정했습니다. 저장해야 반영됩니다.`,
      );
      return;
    }
    if (targets.some((target) => target.instrumentId === instrument.instrumentId)) {
      setMessage(`${instrument.displayName}은 이미 감시 목록에 있습니다.`);
      return;
    }
    if (targets.length >= 50) {
      setMessage("전략 하나에는 최대 50개 종목을 감시할 수 있습니다.");
      return;
    }
    const snapshot = createInstrumentSnapshot(instrument);
    setTargets((current) => [...current, snapshot]);
    setControls((current) => [...current, { instrumentId: snapshot.instrumentId, enabled: true }]);
    setMessage(`${instrument.displayName}을 감시 목록에 추가했습니다. 저장해야 반영됩니다.`);
  }

  function removeTarget(instrumentId: string) {
    if (targets.length === 1) {
      setMessage("감시 종목은 하나 이상 필요합니다. 다른 종목을 먼저 추가하세요.");
      return;
    }
    setTargets((current) => current.filter((target) => target.instrumentId !== instrumentId));
    setControls((current) => current.filter((control) => control.instrumentId !== instrumentId));
    if (hedgeTargetId === instrumentId) setHedgeTargetId(null);
    setMessage("감시 목록에서 제거했습니다. 저장해야 반영됩니다.");
  }

  function updateControl(
    instrumentId: string,
    update: (control: MonitorTargetControl) => MonitorTargetControl,
  ) {
    setControls((current) =>
      current.map((control) => (control.instrumentId === instrumentId ? update(control) : control)),
    );
  }

  function beginHedgeSearch(target: InstrumentSnapshot) {
    setHedgeTargetId(target.instrumentId);
    setRegion(target.currency === "KRW" ? "KR" : "US");
    setQuery("");
    setResults([]);
    setMessage(`${target.displayName} 매도 뒤 추적할 인버스 ETF/ETN을 검색하세요.`);
  }

  return (
    <section className="monitor-targets" aria-labelledby={`monitor-targets-${document.id}`}>
      <header>
        <div>
          <span>MULTI-SYMBOL PAPER SIGNALS</span>
          <h4 id={`monitor-targets-${document.id}`}>다종목 신호 감시</h4>
        </div>
        <strong>
          ON {activeCount} · 전체 {targets.length} / 50
        </strong>
      </header>
      <p>
        같은 Entry·Filter·Exit Rule Chain을 각 종목에 적용합니다. OFF 종목은 구독·조회하지 않으며,
        선택한 인버스는 SELL 뒤 paper BUY하고 다음 BUY에서 paper SELL합니다.
      </p>

      {hedgeTargetId ? (
        <div className="monitor-hedge-search-banner" role="status">
          <span>INVERSE HEDGE PICKER</span>
          <strong>
            {targets.find((target) => target.instrumentId === hedgeTargetId)?.displayName} 매도 전환
          </strong>
          <button
            type="button"
            onClick={() => {
              setHedgeTargetId(null);
              setResults([]);
              setMessage("");
            }}
          >
            취소
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} role="search" aria-label="감시 종목 검색">
        <fieldset>
          <legend>감시 시장</legend>
          <label>
            <input
              type="radio"
              name={`monitor-region-${document.id}`}
              checked={region === "KR"}
              onChange={() => changeRegion("KR")}
            />
            국내
          </label>
          <label>
            <input
              type="radio"
              name={`monitor-region-${document.id}`}
              checked={region === "US"}
              onChange={() => changeRegion("US")}
            />
            미국
          </label>
        </fieldset>
        <label>
          <span>{hedgeTargetId ? "인버스 ETF/ETN 이름 또는 티커" : "감시 종목명 또는 티커"}</span>
          <input
            type="search"
            value={query}
            maxLength={80}
            autoComplete="off"
            placeholder={
              hedgeTargetId
                ? region === "KR"
                  ? "인버스 ETF 또는 ETN"
                  : "SH, PSQ 또는 inverse ETF"
                : region === "KR"
                  ? "KODEX 200 또는 069500"
                  : "SPY 또는 ETF"
            }
            onChange={(event) => {
              requestRef.current += 1;
              setQuery(event.target.value);
              setResults([]);
              setMessage("");
            }}
          />
        </label>
        <div>
          <button type="submit" disabled={busy || searching || !query.trim()}>
            {searching ? "검색 중" : "검색"}
          </button>
          <button
            type="button"
            disabled={busy || searching || !query.trim()}
            onClick={() => void runSearch(true)}
          >
            TOSS catalog 새로고침
          </button>
        </div>
      </form>

      <p className="monitor-target-message" role="status" aria-live="polite">
        {message}
      </p>

      {results.length > 0 ? (
        <ul className="monitor-target-results" aria-label="감시 종목 검색 결과">
          {results.map((instrument) => {
            const selected =
              !hedgeTargetId &&
              targets.some((target) => target.instrumentId === instrument.instrumentId);
            const selfHedge = hedgeTargetId === instrument.instrumentId;
            return (
              <li key={instrument.instrumentId}>
                <span>
                  <strong>{instrument.displayName}</strong>
                  <small>
                    {instrument.symbol} · {instrument.market} · {instrument.securityType ?? "기타"}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={busy || selected || selfHedge}
                  onClick={() => addTarget(instrument)}
                >
                  {selfHedge
                    ? "동일 종목"
                    : hedgeTargetId
                      ? "헷지 지정"
                      : selected
                        ? "추가됨"
                        : "추가"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ul className="monitor-target-selected" aria-label="현재 감시 종목">
        {targets.map((target) => {
          const control = controls.find(
            (candidate) => candidate.instrumentId === target.instrumentId,
          ) ?? { instrumentId: target.instrumentId, enabled: true };
          const position = positions.find(
            (candidate) =>
              candidate.strategyId === document.id &&
              candidate.instrumentId === target.instrumentId,
          );
          return (
            <StrategyMonitorTargetRow
              key={target.instrumentId}
              target={target}
              control={control}
              position={position}
              busy={busy}
              canRemove={targets.length > 1}
              selectingHedge={hedgeTargetId === target.instrumentId}
              onToggle={() =>
                updateControl(target.instrumentId, (current) => ({
                  ...current,
                  enabled: !current.enabled,
                }))
              }
              onFindHedge={() => beginHedgeSearch(target)}
              onClearHedge={() => {
                updateControl(target.instrumentId, (current) => ({
                  instrumentId: current.instrumentId,
                  enabled: current.enabled,
                }));
                setMessage("인버스 헷지를 해제했습니다. 저장해야 반영됩니다.");
              }}
              onRemove={() => removeTarget(target.instrumentId)}
            />
          );
        })}
      </ul>

      <div className="monitor-target-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSave(document, targets, controls, false)}
        >
          대상 저장
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={busy || activeCount === 0}
          onClick={() => void onSave(document, targets, controls, true)}
        >
          대상 저장 + 감시 시작
        </button>
      </div>
      <small>
        완료 봉 paper signal만 전송합니다. 15분 VWAP 시가 교차는 봉 종료 후 확정되며 실제 주문은
        생성하지 않습니다. 선택 상품의 실제 인버스 관계와 leverage 적합성은 QOS가 보증하지 않습니다.
      </small>
    </section>
  );
}
