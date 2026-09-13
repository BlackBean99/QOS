"use client";

import type { InstrumentSnapshot, MonitorTargetControl } from "@/src/domain/stored-strategy";

export interface MonitorPositionSummary {
  strategyId: string;
  instrumentId: string;
  hedgeInstrumentId: string | null;
  leg: "WAITING" | "LONG_PRIMARY" | "LONG_HEDGE";
  signalAt: string;
  updatedAt: string;
}

const LEG_LABEL: Record<MonitorPositionSummary["leg"], string> = {
  WAITING: "진입 대기",
  LONG_PRIMARY: "원 종목 PAPER 보유",
  LONG_HEDGE: "인버스 PAPER 보유",
};

export function StrategyMonitorTargetRow({
  target,
  control,
  position,
  busy,
  canRemove,
  selectingHedge,
  onToggle,
  onFindHedge,
  onClearHedge,
  onRemove,
}: {
  target: InstrumentSnapshot;
  control: MonitorTargetControl;
  position?: MonitorPositionSummary;
  busy: boolean;
  canRemove: boolean;
  selectingHedge: boolean;
  onToggle: () => void;
  onFindHedge: () => void;
  onClearHedge: () => void;
  onRemove: () => void;
}) {
  return (
    <li className={control.enabled ? "target-enabled" : "target-disabled"}>
      <div className="monitor-target-identity">
        <span>
          <strong>{target.displayName}</strong>
          <small>
            {target.symbol} · {target.market} · {target.securityType ?? "기타"}
          </small>
        </span>
        <span className="monitor-target-badges">
          <b>{control.enabled ? "TRACKING ON" : "TRACKING OFF"}</b>
          <b>{position ? LEG_LABEL[position.leg] : "PAPER 상태 없음"}</b>
        </span>
        <small>
          {control.hedgeInstrument
            ? `매도 전환 헷지: ${control.hedgeInstrument.displayName} (${control.hedgeInstrument.symbol})`
            : "매도 신호는 알림만 전송 · 인버스 헷지 없음"}
        </small>
      </div>
      <div className="monitor-target-row-actions">
        <label className="monitor-target-switch">
          <input type="checkbox" checked={control.enabled} disabled={busy} onChange={onToggle} />
          <span>{control.enabled ? "감시 ON" : "감시 OFF"}</span>
        </label>
        <button type="button" disabled={busy} aria-pressed={selectingHedge} onClick={onFindHedge}>
          {selectingHedge ? "인버스 검색 중" : "인버스 선택"}
        </button>
        {control.hedgeInstrument ? (
          <button type="button" disabled={busy} onClick={onClearHedge}>
            헷지 해제
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !canRemove}
          aria-label={`${target.displayName} 감시 목록에서 제거`}
          onClick={onRemove}
        >
          제거
        </button>
      </div>
    </li>
  );
}
