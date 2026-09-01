"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";

import {
  INDICATOR_CATALOG,
  IndicatorInstanceSchema,
  createIndicatorInstance,
  indicatorCatalogItem,
  indicatorParamRule,
  type ChartIndicator,
  type IndicatorInstance,
  type IndicatorSource,
} from "@/src/domain/chart-indicators";

const sourceLabels: Record<IndicatorSource, string> = {
  open: "시가",
  high: "고가",
  low: "저가",
  close: "종가",
  hl2: "HL2",
  hlc3: "HLC3",
  ohlc4: "OHLC4",
};

interface Props {
  instances: IndicatorInstance[];
  onChange: (instances: IndicatorInstance[]) => void;
}

function freshId(name: ChartIndicator): string {
  return `${name.toLowerCase()}-${crypto.randomUUID()}`;
}

export function IndicatorManager({ instances, onChange }: Props) {
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<IndicatorInstance | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ko-KR");
    if (!needle) return INDICATOR_CATALOG;
    return INDICATOR_CATALOG.filter((item) =>
      `${item.name} ${item.label} ${item.description}`.toLocaleLowerCase("ko-KR").includes(needle),
    );
  }, [query]);

  function closeAddDialog() {
    addDialogRef.current?.close();
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function addIndicator(name: ChartIndicator) {
    onChange([...instances, createIndicatorInstance(name, freshId(name), instances.length)]);
    closeAddDialog();
  }

  function openSettings(instance: IndicatorInstance) {
    setSettingsError(null);
    setEditing({ ...instance, calcParams: [...instance.calcParams] });
    requestAnimationFrame(() => settingsDialogRef.current?.showModal());
  }

  function closeSettings() {
    const id = editing?.id;
    settingsDialogRef.current?.close();
    setEditing(null);
    setSettingsError(null);
    if (id) {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(`[data-settings-for="${CSS.escape(id)}"]`)
          ?.focus(),
      );
    }
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const parsed = IndicatorInstanceSchema.safeParse(editing);
    if (!parsed.success) {
      setSettingsError(parsed.error.issues[0]?.message ?? "지표 설정을 확인해 주세요.");
      return;
    }
    onChange(instances.map((instance) => (instance.id === editing.id ? parsed.data : instance)));
    closeSettings();
  }

  function removeIndicator(instance: IndicatorInstance) {
    const index = instances.findIndex((candidate) => candidate.id === instance.id);
    const focusId = instances[index + 1]?.id ?? instances[index - 1]?.id;
    onChange(instances.filter((candidate) => candidate.id !== instance.id));
    requestAnimationFrame(() => {
      if (focusId) {
        document
          .querySelector<HTMLButtonElement>(`[data-settings-for="${CSS.escape(focusId)}"]`)
          ?.focus();
      } else {
        addButtonRef.current?.focus();
      }
    });
  }

  return (
    <div className="indicator-manager">
      <div className="indicator-manager-heading">
        <div>
          <strong>활성 지표</strong>
          <small>{instances.length}개 · 같은 지표도 다른 설정으로 추가할 수 있습니다.</small>
        </div>
        <button
          ref={addButtonRef}
          type="button"
          className="indicator-add-button"
          onClick={() => {
            setQuery("");
            addDialogRef.current?.showModal();
          }}
        >
          <span aria-hidden="true">＋</span> 지표 추가
        </button>
      </div>

      {instances.length > 0 ? (
        <ul className="indicator-instance-list" aria-label="활성 차트 지표">
          {instances.map((instance) => {
            const item = indicatorCatalogItem(instance.name);
            return (
              <li key={instance.id} data-indicator-instance={instance.id}>
                <i style={{ backgroundColor: instance.color }} aria-hidden="true" />
                <span className="indicator-instance-name">
                  <strong>{instance.name}</strong>
                  <small>{item.label}</small>
                </span>
                <span className="indicator-instance-summary">
                  {instance.calcParams.length > 0 ? instance.calcParams.join("·") : "기본"} ·{" "}
                  {item.supportsSource ? sourceLabels[instance.source] : "고정 OHLCV"} ·{" "}
                  {instance.timeframe === "1d" ? "1D" : "차트 봉"}
                </span>
                <span className="indicator-instance-actions">
                  <button
                    type="button"
                    data-settings-for={instance.id}
                    aria-label={`${instance.name} 설정`}
                    title={`${instance.name} 설정`}
                    onClick={() => openSettings(instance)}
                  >
                    <span aria-hidden="true">⚙</span>
                  </button>
                  <button
                    type="button"
                    className="danger-tool"
                    aria-label={`${instance.name} 삭제`}
                    title={`${instance.name} 삭제`}
                    onClick={() => removeIndicator(instance)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="indicator-empty">표시 중인 지표가 없습니다. 지표 추가에서 선택하세요.</p>
      )}

      <dialog
        ref={addDialogRef}
        className="chart-dialog indicator-catalog-dialog"
        aria-labelledby="indicator-catalog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeAddDialog();
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">INDICATORS</span>
            <h3 id="indicator-catalog-title">지표 추가</h3>
            <p>가격 오버레이와 보조지표 {INDICATOR_CATALOG.length}종을 검색해 차트에 추가합니다.</p>
          </div>
          <button type="button" aria-label="지표 추가 닫기" onClick={closeAddDialog}>
            ×
          </button>
        </div>
        <label className="indicator-search">
          <span>지표 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예: VWAP, 이동평균, 모멘텀"
          />
        </label>
        <div className="indicator-catalog" aria-live="polite">
          {filteredCatalog.map((item) => (
            <article key={item.name} data-indicator-catalog-item={item.name}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.label}</span>
                <small>{item.description}</small>
              </div>
              <button
                type="button"
                aria-label={`${item.name} 추가`}
                onClick={() => addIndicator(item.name)}
              >
                추가
              </button>
            </article>
          ))}
          {filteredCatalog.length === 0 ? <p role="status">일치하는 지표가 없습니다.</p> : null}
        </div>
      </dialog>

      <dialog
        ref={settingsDialogRef}
        className="chart-dialog indicator-settings-dialog"
        aria-labelledby="indicator-settings-title"
        onCancel={(event) => {
          event.preventDefault();
          closeSettings();
        }}
      >
        {editing ? (
          <form onSubmit={saveSettings} noValidate>
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">INDICATOR SETTINGS</span>
                <h3 id="indicator-settings-title">{editing.name} 지표 설정</h3>
                <p>{indicatorCatalogItem(editing.name).description}</p>
              </div>
              <button type="button" aria-label="지표 설정 닫기" onClick={closeSettings}>
                ×
              </button>
            </div>

            {editing.calcParams.length > 0 ? (
              <fieldset className="indicator-param-grid">
                <legend>계산 파라미터</legend>
                {editing.calcParams.map((value, index) => (
                  <label key={`${editing.id}-param-${index}`}>
                    <span>{indicatorParamRule(editing.name, index, editing.timeframe).label}</span>
                    <input
                      type="number"
                      min={indicatorParamRule(editing.name, index, editing.timeframe).min}
                      max={indicatorParamRule(editing.name, index, editing.timeframe).max}
                      step={indicatorParamRule(editing.name, index, editing.timeframe).step}
                      value={value}
                      onChange={(event) => {
                        const calcParams = [...editing.calcParams];
                        calcParams[index] = Math.max(0.1, Number(event.target.value) || 0.1);
                        setEditing({ ...editing, calcParams });
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            ) : null}

            <div className="indicator-setting-grid">
              <label>
                <span>가격 소스</span>
                <select
                  value={editing.source}
                  disabled={!indicatorCatalogItem(editing.name).supportsSource}
                  onChange={(event) =>
                    setEditing({ ...editing, source: event.target.value as IndicatorSource })
                  }
                >
                  {Object.entries(sourceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {!indicatorCatalogItem(editing.name).supportsSource ? (
                  <small>이 지표는 고가·저가·거래량을 포함한 고정 공식을 사용합니다.</small>
                ) : null}
              </label>
              <label>
                <span>계산 봉</span>
                <select
                  value={editing.timeframe}
                  onChange={(event) =>
                    setEditing({ ...editing, timeframe: event.target.value as "chart" | "1d" })
                  }
                >
                  <option value="chart">현재 차트 봉</option>
                  <option
                    value="1d"
                    disabled={!indicatorCatalogItem(editing.name).supportsDailyTimeframe}
                  >
                    일봉 · 직전 완료 봉
                  </option>
                </select>
                {!indicatorCatalogItem(editing.name).supportsDailyTimeframe ? (
                  <small>
                    이 지표는 이후 봉에 따라 과거 값이 바뀌어 현재 차트 봉만 지원합니다.
                  </small>
                ) : null}
              </label>
              <label>
                <span>대표 색</span>
                <input
                  type="color"
                  value={editing.color}
                  onChange={(event) => setEditing({ ...editing, color: event.target.value })}
                />
              </label>
              <label>
                <span>선 굵기</span>
                <select
                  value={editing.lineWidth}
                  onChange={(event) =>
                    setEditing({ ...editing, lineWidth: Number(event.target.value) })
                  }
                >
                  {[1, 2, 3, 4].map((width) => (
                    <option key={width} value={width}>
                      {width}px
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="indicator-timeframe-note">
              분봉에서 1D를 선택하면 미래정보를 막기 위해 직전 완료 일봉 값만 표시합니다.
            </p>
            {settingsError ? (
              <p className="indicator-settings-error" role="alert">
                {settingsError}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" onClick={closeSettings}>
                취소
              </button>
              <button type="submit" className="primary-button">
                설정 저장
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
