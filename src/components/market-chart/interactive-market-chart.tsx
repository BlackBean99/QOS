"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Chart,
  Crosshair,
  DeepPartial,
  Indicator,
  KLineData,
  Overlay,
  OverlayTemplate,
  Point,
  Styles,
} from "klinecharts";

import type { InstrumentSummary } from "@/src/domain/instruments";
import { ichimoku, rollingSessionVwap, stochasticRsi } from "@/src/domain/indicators";
import {
  configuredIndicatorCalculation,
  indicatorCatalogItem,
  indicatorRequiredHistory,
  normalizeIndicatorInstances,
  type IndicatorInstance,
} from "@/src/domain/chart-indicators";
import {
  SavedDrawingSchema,
  type ChartSettings,
  type DrawingKind,
  type SavedDrawing,
} from "@/src/domain/stored-strategy";
import type { MarketCandle } from "@/src/server/toss/schemas";
import {
  dailyBucketStart,
  overlayNameForDrawing,
  periodForChart,
  resolveFiveMinuteProviderPage,
  resolveHistoryPage,
  toDisplayCandles,
  type FiveMinutePageState,
  type HistoryPageState,
} from "./chart-model";
import { IndicatorManager } from "./indicator-manager";
import { DrawingIcon } from "./drawing-icon";
import { registerExtendedIndicators } from "./extended-indicators";

export interface ChartSignal {
  timestamp: string;
  side: "BUY" | "SELL";
  price: number;
  reason: string;
}

export interface ChartLevel {
  from: string;
  to: string;
  value: number;
  label: string;
  kind: "STOP" | "TARGET" | "TRAILING";
}

interface Props {
  instrument: InstrumentSummary;
  settings: ChartSettings;
  signals?: ChartSignal[];
  levels?: ChartLevel[];
  onSettingsChange: (settings: ChartSettings) => void;
}

interface CandlePayload {
  candles: MarketCandle[];
  nextBefore: string | null;
  error?: { message?: string };
}

const DRAWINGS: Array<{ kind: DrawingKind; label: string }> = [
  { kind: "trend_line", label: "추세선" },
  { kind: "straight_line", label: "직선" },
  { kind: "ray", label: "광선" },
  { kind: "horizontal_ray", label: "수평 광선" },
  { kind: "horizontal_segment", label: "수평 구간" },
  { kind: "horizontal_line", label: "수평선" },
  { kind: "vertical_ray", label: "수직 광선" },
  { kind: "vertical_segment", label: "수직 구간" },
  { kind: "vertical_line", label: "수직선" },
  { kind: "parallel_lines", label: "평행선" },
  { kind: "price_channel", label: "가격 채널" },
  { kind: "price_line", label: "가격선" },
  { kind: "brush", label: "빗금/브러시" },
  { kind: "rectangle", label: "박스" },
  { kind: "fibonacci", label: "피보나치" },
  { kind: "pitchfork", label: "피치포크" },
  { kind: "fan", label: "팬" },
  { kind: "annotation", label: "주석" },
  { kind: "tag", label: "태그" },
];

const DRAWING_GUIDANCE: Record<DrawingKind, string> = {
  trend_line: "차트에서 시작점과 끝점을 차례로 선택하세요.",
  straight_line: "차트에서 직선이 지나는 두 점을 차례로 선택하세요.",
  ray: "차트에서 시작점과 방향점을 차례로 선택하세요.",
  horizontal_ray: "차트에서 수평 광선의 시작점과 방향점을 선택하세요.",
  horizontal_segment: "차트에서 수평 구간의 시작점과 끝점을 선택하세요.",
  horizontal_line: "차트에서 가격 한 점을 선택하세요.",
  vertical_ray: "차트에서 수직 광선의 시작점과 방향점을 선택하세요.",
  vertical_segment: "차트에서 수직 구간의 시작점과 끝점을 선택하세요.",
  vertical_line: "차트에서 시각 한 점을 선택하세요.",
  parallel_lines: "차트에서 기준선 두 점과 평행 간격점을 선택하세요.",
  price_channel: "차트에서 채널 기준선 두 점과 폭 한 점을 선택하세요.",
  price_line: "차트에서 표시할 가격 한 점을 선택하세요.",
  brush: "차트 위에서 누른 채 드래그해 자유선을 그리세요.",
  rectangle: "차트에서 대각선 두 모서리를 차례로 선택하세요.",
  fibonacci: "차트에서 고점과 저점 두 앵커를 차례로 선택하세요.",
  pitchfork: "차트에서 기준점과 두 갈래점을 차례로 선택하세요.",
  fan: "차트에서 시작점과 방향점을 차례로 선택하세요.",
  annotation: "차트에서 주석을 표시할 한 점을 선택하세요.",
  tag: "차트에서 태그를 표시할 한 점을 선택하세요.",
};

const CHART_STYLES = {
  grid: {
    show: true,
    horizontal: { show: true, size: 1, color: "#e9eef5", style: "dashed", dashedValue: [3, 3] },
    vertical: { show: true, size: 1, color: "#eef2f7", style: "dashed", dashedValue: [3, 3] },
  },
  candle: {
    type: "candle_solid",
    bar: {
      compareRule: "current_open",
      upColor: "#d43c3c",
      downColor: "#1769d2",
      noChangeColor: "#687386",
      upBorderColor: "#d43c3c",
      downBorderColor: "#1769d2",
      noChangeBorderColor: "#687386",
      upWickColor: "#d43c3c",
      downWickColor: "#1769d2",
      noChangeWickColor: "#687386",
    },
    priceMark: {
      high: { color: "#364152" },
      low: { color: "#364152" },
      last: {
        upColor: "#d43c3c",
        downColor: "#1769d2",
        noChangeColor: "#687386",
      },
    },
  },
  xAxis: { axisLine: { color: "#dce3ec" }, tickText: { color: "#657186" } },
  yAxis: { axisLine: { color: "#dce3ec" }, tickText: { color: "#657186" } },
  crosshair: {
    show: true,
    horizontal: { line: { color: "#5e6b7d", style: "dashed", dashedValue: [4, 4] } },
    vertical: { line: { color: "#5e6b7d", style: "dashed", dashedValue: [4, 4] } },
  },
  overlay: {
    line: { color: "#7147d9", size: 2 },
    rect: { color: "rgba(113, 71, 217, 0.12)", borderColor: "#7147d9", borderSize: 1 },
    text: { color: "#253044", backgroundColor: "#ffffff", borderColor: "#dce3ec" },
  },
} satisfies DeepPartial<Styles>;

let customOverlaysRegistered = false;

function lineToWidth(
  start: { x: number; y: number },
  through: { x: number; y: number },
  width: number,
) {
  const deltaX = through.x - start.x;
  if (Math.abs(deltaX) < 0.001) return [start, { x: start.x, y: 0 }];
  const slope = (through.y - start.y) / deltaX;
  return [start, { x: width, y: start.y + slope * (width - start.x) }];
}

function registerCustomOverlays(module: typeof import("klinecharts")): void {
  if (customOverlaysRegistered) return;
  registerExtendedIndicators(module);
  module.registerIndicator({
    name: "FRACTAL",
    shortName: "Fractal (2+2)",
    series: "price",
    precision: 2,
    shouldOhlc: true,
    figures: [
      {
        key: "up",
        title: "▲: ",
        type: "circle",
      },
      {
        key: "down",
        title: "▼: ",
        type: "circle",
      },
    ],
    calc: (dataList, indicator) => {
      const radius = Math.max(1, Math.round(Number(indicator.calcParams[0] ?? 2)));
      return dataList.map((candle, index) => {
        if (index < radius || index + radius >= dataList.length) return {};
        const neighbors = dataList.slice(index - radius, index + radius + 1);
        const value: { up?: number; down?: number } = {};
        if (
          neighbors.every((neighbor, offset) => offset === radius || candle.high > neighbor.high)
        ) {
          value.up = candle.high;
        }
        if (neighbors.every((neighbor, offset) => offset === radius || candle.low < neighbor.low)) {
          value.down = candle.low;
        }
        return value;
      });
    },
  });
  module.registerIndicator<{ vwap: number | null }>({
    name: "VWAP",
    shortName: "VWAP 15D",
    series: "price",
    precision: 2,
    shouldOhlc: true,
    figures: [
      {
        key: "vwap",
        title: "VWAP 15D: ",
        type: "line",
      },
    ],
    calc: (dataList, indicator) => {
      const lookback = Math.max(1, Math.round(Number(indicator.calcParams[0] ?? 15)));
      const candles = dataList.map((candle) => ({
        date: new Date(candle.timestamp).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? 0,
      }));
      return rollingSessionVwap(candles, lookback).map((vwap) => ({ vwap }));
    },
  });
  module.registerIndicator<{
    tenkan: number | null;
    kijun: number | null;
    spanA: number | null;
    spanB: number | null;
  }>({
    name: "ICHIMOKU",
    shortName: "Ichimoku 9·26·52",
    series: "price",
    precision: 2,
    shouldOhlc: true,
    figures: [
      {
        key: "tenkan",
        title: "전환선: ",
        type: "line",
      },
      {
        key: "kijun",
        title: "기준선: ",
        type: "line",
      },
      {
        key: "spanA",
        title: "선행 A: ",
        type: "line",
      },
      {
        key: "spanB",
        title: "선행 B: ",
        type: "line",
      },
    ],
    calc: (dataList, indicator) =>
      ichimoku(
        dataList.map((candle) => ({
          date: new Date(candle.timestamp).toISOString(),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume ?? 0,
        })),
        Math.max(1, Math.round(Number(indicator.calcParams[0] ?? 9))),
        Math.max(1, Math.round(Number(indicator.calcParams[1] ?? 26))),
        Math.max(1, Math.round(Number(indicator.calcParams[2] ?? 52))),
        Math.max(1, Math.round(Number(indicator.calcParams[3] ?? 26))),
      ),
  });
  module.registerIndicator<{ k: number | null; d: number | null }>({
    name: "STOCH_RSI",
    shortName: "Stochastic RSI 14·14·3·3",
    series: "normal",
    precision: 2,
    minValue: 0,
    maxValue: 100,
    figures: [
      {
        key: "k",
        title: "%K: ",
        type: "line",
      },
      {
        key: "d",
        title: "%D: ",
        type: "line",
      },
    ],
    calc: (dataList, indicator) => {
      const rsiPeriod = Math.max(1, Math.round(Number(indicator.calcParams[0] ?? 14)));
      const stochasticPeriod = Math.max(1, Math.round(Number(indicator.calcParams[1] ?? 14)));
      const kSmoothing = Math.max(1, Math.round(Number(indicator.calcParams[2] ?? 3)));
      const dSmoothing = Math.max(1, Math.round(Number(indicator.calcParams[3] ?? 3)));
      const k = stochasticRsi(
        dataList.map((candle) => candle.close),
        rsiPeriod,
        stochasticPeriod,
        kSmoothing,
      );
      const d = k.map((value, index) => {
        if (value === null || index < dSmoothing - 1) return null;
        const window = k.slice(index - dSmoothing + 1, index + 1);
        if (window.some((item) => item === null)) return null;
        return (window as number[]).reduce((sum, item) => sum + item, 0) / dSmoothing;
      });
      return k.map((value, index) => ({ k: value, d: d[index] }));
    },
  });
  const rectangle: OverlayTemplate = {
    name: "qosRectangle",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }) =>
      coordinates.length < 2
        ? []
        : [
            {
              type: "rect",
              attrs: {
                x: Math.min(coordinates[0].x, coordinates[1].x),
                y: Math.min(coordinates[0].y, coordinates[1].y),
                width: Math.abs(coordinates[1].x - coordinates[0].x),
                height: Math.abs(coordinates[1].y - coordinates[0].y),
              },
            },
          ],
  };
  const pitchfork: OverlayTemplate = {
    name: "qosPitchfork",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding }) => {
      if (coordinates.length < 3) return [];
      const midpoint = {
        x: (coordinates[1].x + coordinates[2].x) / 2,
        y: (coordinates[1].y + coordinates[2].y) / 2,
      };
      const center = lineToWidth(coordinates[0], midpoint, bounding.width);
      const delta = { x: midpoint.x - coordinates[0].x, y: midpoint.y - coordinates[0].y };
      return [
        {
          type: "line",
          attrs: [
            { coordinates: center },
            {
              coordinates: lineToWidth(
                coordinates[1],
                { x: coordinates[1].x + delta.x, y: coordinates[1].y + delta.y },
                bounding.width,
              ),
            },
            {
              coordinates: lineToWidth(
                coordinates[2],
                { x: coordinates[2].x + delta.x, y: coordinates[2].y + delta.y },
                bounding.width,
              ),
            },
          ],
        },
      ];
    },
  };
  const fan: OverlayTemplate = {
    name: "qosFan",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding }) => {
      if (coordinates.length < 2) return [];
      const start = coordinates[0];
      const end = coordinates[1];
      const lines = [0.25, 0.5, 0.75, 1, 1.5].map((ratio) => ({
        coordinates: lineToWidth(
          start,
          { x: end.x, y: start.y + (end.y - start.y) * ratio },
          bounding.width,
        ),
      }));
      return [{ type: "line", attrs: lines }];
    },
  };
  const signal: OverlayTemplate<{ side: "BUY" | "SELL"; reason?: string; timestamp?: string }> = {
    name: "qosSignal",
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    lock: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 1) return [];
      const buy = overlay.extendData.side === "BUY";
      return [
        {
          type: "text",
          attrs: {
            x: coordinates[0].x,
            y: coordinates[0].y + (buy ? 18 : -18),
            text: buy ? "▲ BUY" : "▼ SELL",
            align: "center",
            baseline: "middle",
          },
          styles: {
            color: "#ffffff",
            backgroundColor: buy ? "#b82d2d" : "#1459b1",
            borderColor: buy ? "#8f1f1f" : "#0e4388",
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 3,
            paddingBottom: 3,
          },
        },
      ];
    },
  };
  module.registerOverlay(rectangle);
  module.registerOverlay(pitchfork);
  module.registerOverlay(fan);
  module.registerOverlay(signal);
  customOverlaysRegistered = true;
}

function savedKind(overlay: Overlay): DrawingKind | null {
  const extend = overlay.extendData as { savedKind?: unknown } | null;
  return typeof extend?.savedKind === "string" ? (extend.savedKind as DrawingKind) : null;
}

function serializeDrawings(chart: Chart): SavedDrawing[] {
  return chart
    .getOverlays({ groupId: "qos-drawings" })
    .map((overlay) => {
      const candidate = {
        id: overlay.id,
        kind: savedKind(overlay),
        points: overlay.points
          .filter(
            (point): point is Partial<Point> & { timestamp: number; value: number } =>
              Number.isFinite(point.timestamp) && Number.isFinite(point.value),
          )
          .map((point) => ({
            timestamp: new Date(point.timestamp).toISOString(),
            value: point.value,
          })),
      };
      const parsed = SavedDrawingSchema.safeParse(candidate);
      return parsed.success ? parsed.data : null;
    })
    .filter((drawing): drawing is SavedDrawing => drawing !== null);
}

function formatPrice(value: number, currency: "KRW" | "USD"): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
}

const LEGACY_MAIN = new Set(["MA", "SMA", "EMA", "BOLL", "FRACTAL", "VWAP", "ICHIMOKU"]);
const LEGACY_SUB = new Set(["VOL", "RSI", "MACD", "STOCH_RSI"]);

function indicatorStyles(config: IndicatorInstance): DeepPartial<Styles["indicator"]> {
  return {
    lines: Array.from({ length: 16 }, (_, index) => ({
      color: config.color,
      size: config.lineWidth,
      style: index % 2 === 0 ? "solid" : "dashed",
    })),
    bars: Array.from({ length: 16 }, () => ({
      upColor: config.color,
      downColor: config.color,
      noChangeColor: config.color,
    })),
    circles: Array.from({ length: 4 }, () => ({
      color: config.color,
      borderColor: config.color,
      borderSize: config.lineWidth,
      upColor: config.color,
      downColor: config.color,
      noChangeColor: config.color,
    })),
  };
}

function installConfiguredIndicator(
  chart: Chart,
  config: IndicatorInstance,
  timezone: string,
  chartPeriod: "1m" | "5m" | "1d",
  dailyHistory: KLineData[],
): void {
  const catalog = indicatorCatalogItem(config.name);
  const paneId = catalog.placement === "main" ? "candle_pane" : undefined;
  const probeId = chart.createIndicator(
    { name: config.name, paneId, calcParams: config.calcParams },
    catalog.placement === "main",
  );
  if (!probeId) return;
  const base = chart.getIndicators({ id: probeId })[0] as
    Indicator<Record<string, unknown>> | undefined;
  chart.removeIndicator({ id: probeId });
  if (!base) return;

  chart.createIndicator(
    {
      id: config.id,
      name: config.name,
      paneId,
      calcParams: config.calcParams,
      shortName: `${config.name} · ${config.timeframe === "1d" ? "1D" : chartPeriod}`,
      styles: indicatorStyles(config),
      calc: (dataList, indicator) =>
        configuredIndicatorCalculation(
          dataList,
          config,
          timezone,
          (candles) =>
            base.calc(candles, indicator as Indicator<Record<string, unknown>>) as Record<
              string,
              unknown
            >[],
          chartPeriod,
          catalog.supportsSource,
          dailyHistory,
        ),
    },
    catalog.placement === "main",
  );
}

export function InteractiveMarketChart({
  instrument,
  settings,
  signals = [],
  levels = [],
  onSettingsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const restoringRef = useRef(false);
  const settingsRef = useRef(settings);
  const liveCallbackRef = useRef<((data: KLineData) => void) | null>(null);
  const liveBarRef = useRef<KLineData | null>(null);
  const historyRef = useRef<HistoryPageState>({ olderCursor: null, timestamps: [] });
  const fiveMinutePageRef = useRef<FiveMinutePageState>({
    oldestRawTimestamp: null,
    pendingOldestBucket: [],
  });
  const dataLoaderGenerationRef = useRef(0);
  const [recentCandles, setRecentCandles] = useState<KLineData[]>([]);
  const [crosshair, setCrosshair] = useState<KLineData | null>(null);
  const [activeIndicators, setActiveIndicators] = useState<string[]>([]);
  const [activeIndicatorStyles, setActiveIndicatorStyles] = useState<string[]>([]);
  const [dailyIndicatorState, setDailyIndicatorState] = useState<{
    instrumentId: string | null;
    lookback: number;
    candles: KLineData[];
    status: "ready" | "error";
  }>({ instrumentId: null, lookback: 0, candles: [], status: "ready" });
  const [drawingCount, setDrawingCount] = useState(0);
  const [drawingPointCount, setDrawingPointCount] = useState(0);
  const [activeDrawing, setActiveDrawing] = useState<DrawingKind | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [streamStatus, setStreamStatus] = useState("연결 중");
  const [selectedSignal, setSelectedSignal] = useState<ChartSignal | null>(null);
  const indicatorInstances = useMemo(
    () =>
      normalizeIndicatorInstances({
        mainIndicators: settings.mainIndicators,
        subIndicators: settings.subIndicators,
        indicatorInstances: settings.indicatorInstances,
      }),
    [settings.indicatorInstances, settings.mainIndicators, settings.subIndicators],
  );
  const needsDailyIndicatorHistory =
    settings.period !== "1d" && indicatorInstances.some((instance) => instance.timeframe === "1d");
  const dailyIndicatorLookback = Math.min(
    400,
    Math.max(
      1,
      ...indicatorInstances
        .filter((instance) => instance.timeframe === "1d")
        .map((instance) => indicatorRequiredHistory(instance.name, instance.calcParams)),
    ),
  );
  const dailyStateMatches =
    dailyIndicatorState.instrumentId === instrument.instrumentId &&
    dailyIndicatorState.lookback >= dailyIndicatorLookback;
  const dailyIndicatorCandles = useMemo(
    () => (needsDailyIndicatorHistory && dailyStateMatches ? dailyIndicatorState.candles : []),
    [dailyIndicatorState.candles, dailyStateMatches, needsDailyIndicatorHistory],
  );
  const dailyIndicatorStatus = !needsDailyIndicatorHistory
    ? "idle"
    : dailyStateMatches
      ? dailyIndicatorState.status
      : "loading";
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!needsDailyIndicatorHistory) return;
    const controller = new AbortController();
    let active = true;

    async function loadDailyHistory() {
      const candlesByTimestamp = new Map<number, MarketCandle>();
      let before: string | null = null;
      for (let page = 0; page < Math.max(1, Math.ceil(dailyIndicatorLookback / 200)); page += 1) {
        const query = new URLSearchParams({
          instrumentId: instrument.instrumentId,
          interval: "1d",
          count: "200",
          adjusted: "true",
        });
        if (before) query.set("before", before);
        const response = await fetch(`/api/market/candles?${query.toString()}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const payload = (await response.json()) as CandlePayload;
        if (!response.ok || !Array.isArray(payload.candles)) {
          throw new Error(payload.error?.message ?? "일봉 지표 이력을 불러오지 못했습니다.");
        }
        for (const candle of payload.candles) {
          const timestamp = Date.parse(candle.timestamp);
          if (Number.isFinite(timestamp)) candlesByTimestamp.set(timestamp, candle);
        }
        if (!payload.nextBefore || payload.nextBefore === before) break;
        before = payload.nextBefore;
      }
      if (!active) return;
      const candles = toDisplayCandles([...candlesByTimestamp.values()], "1d").map((candle) => ({
        timestamp: candle.timestampMs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }));
      setDailyIndicatorState({
        instrumentId: instrument.instrumentId,
        lookback: dailyIndicatorLookback,
        candles,
        status: candles.length >= dailyIndicatorLookback ? "ready" : "error",
      });
    }

    void loadDailyHistory().catch(() => {
      if (!active || controller.signal.aborted) return;
      setDailyIndicatorState({
        instrumentId: instrument.instrumentId,
        lookback: dailyIndicatorLookback,
        candles: [],
        status: "error",
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [dailyIndicatorLookback, instrument.instrumentId, needsDailyIndicatorHistory]);

  useEffect(() => {
    let active = true;
    let loadedModule: typeof import("klinecharts") | null = null;
    async function mount() {
      const chartModule = await import("klinecharts");
      if (!active || !containerRef.current) return;
      loadedModule = chartModule;
      registerCustomOverlays(chartModule);
      chartModule.registerLocale("ko-KR", {
        time: "시간: ",
        open: "시가: ",
        high: "고가: ",
        low: "저가: ",
        close: "종가: ",
        volume: "거래량: ",
        turnover: "거래대금: ",
        change: "등락률: ",
        second: "초",
        minute: "분",
        hour: "시간",
        day: "일",
        week: "주",
        month: "월",
        year: "년",
      });
      const chart = chartModule.init(containerRef.current, {
        locale: "ko-KR",
        timezone: instrument.timezone,
        styles: CHART_STYLES,
        zoomAnchor: "cursor",
        hotkey: { enabled: true, exclude: ["INPUT", "TEXTAREA", "BUTTON"] },
      });
      if (!chart) {
        setError("차트 엔진을 시작하지 못했습니다.");
        return;
      }
      chartRef.current = chart;
      containerRef.current
        .querySelector<HTMLElement>("[tabindex='1']")
        ?.setAttribute("tabindex", "-1");
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
      const crosshairHandler = (data?: unknown) => {
        const value = data as Crosshair | undefined;
        if (value?.kLineData) setCrosshair(value.kLineData);
      };
      let visibleTimer: ReturnType<typeof setTimeout> | null = null;
      const visibleHandler = () => {
        if (visibleTimer) clearTimeout(visibleTimer);
        visibleTimer = setTimeout(() => {
          const current = chart.getDataList();
          const visible = chart.getVisibleRange();
          const from = current[Math.max(0, visible.from)]?.timestamp;
          const to = current[Math.min(current.length - 1, visible.to)]?.timestamp;
          if (from && to && from < to) {
            onSettingsChange({
              ...settingsRef.current,
              visibleRange: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
            });
          }
        }, 350);
      };
      chart.subscribeAction("onCrosshairChange", crosshairHandler);
      chart.subscribeAction("onVisibleRangeChange", visibleHandler);
      setReady(true);
      return () => {
        if (visibleTimer) clearTimeout(visibleTimer);
        chart.unsubscribeAction("onCrosshairChange", crosshairHandler);
        chart.unsubscribeAction("onVisibleRangeChange", visibleHandler);
      };
    }
    let detach: (() => void) | undefined;
    void mount().then((cleanup) => {
      detach = cleanup;
    });
    return () => {
      active = false;
      detach?.();
      if (loadedModule && chartRef.current) loadedModule.dispose(chartRef.current);
      chartRef.current = null;
      setReady(false);
    };
  }, [instrument.instrumentId, instrument.timezone, onSettingsChange]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    let active = true;
    const generation = dataLoaderGenerationRef.current + 1;
    dataLoaderGenerationRef.current = generation;
    const requestController = new AbortController();
    historyRef.current = { olderCursor: null, timestamps: [] };
    fiveMinutePageRef.current = { oldestRawTimestamp: null, pendingOldestBucket: [] };
    setLoadedCount(0);
    setHistoryExhausted(false);
    const { chart: chartPeriod, provider } = periodForChart(settings.period);
    chart.setDataLoader({
      async getBars({ type, timestamp, callback }) {
        if (type === "backward" || type === "update") {
          callback([], { backward: false });
          return;
        }
        const requestedCursor = type === "forward" ? historyRef.current.olderCursor : null;
        if (type === "forward" && requestedCursor === null) {
          setHistoryExhausted(true);
          callback([], { forward: false, backward: false });
          return;
        }
        try {
          const query = new URLSearchParams({
            instrumentId: instrument.instrumentId,
            interval: provider,
            count: "200",
            adjusted: "true",
          });
          if (requestedCursor) query.set("before", requestedCursor);
          const response = await fetch(`/api/market/candles?${query.toString()}`, {
            headers: { accept: "application/json" },
            signal: requestController.signal,
          });
          const payload = (await response.json()) as CandlePayload;
          if (!active || dataLoaderGenerationRef.current !== generation) {
            callback([], { backward: false, forward: false });
            return;
          }
          if (!response.ok || !Array.isArray(payload.candles)) {
            throw new Error(payload.error?.message ?? "과거 캔들을 불러오지 못했습니다.");
          }
          const fiveMinutePage =
            settings.period === "5m"
              ? resolveFiveMinuteProviderPage(fiveMinutePageRef.current, {
                  type,
                  requestedCursor,
                  nextBefore: payload.nextBefore,
                  candles: payload.candles,
                })
              : null;
          if (fiveMinutePage) fiveMinutePageRef.current = fiveMinutePage.state;
          const resolved = resolveHistoryPage(historyRef.current, {
            type,
            boundaryTimestamp: timestamp,
            requestedCursor,
            nextBefore: fiveMinutePage?.nextBefore ?? payload.nextBefore,
            candles: fiveMinutePage?.candles ?? toDisplayCandles(payload.candles, settings.period),
          });
          historyRef.current = resolved.state;
          setLoadedCount(resolved.state.timestamps.length);
          const display: KLineData[] = resolved.bars.map((bar) => ({ ...bar }));
          callback(display, resolved.more);
          setHistoryExhausted(!resolved.more.forward);
          setRecentCandles((current) => {
            const merged = new Map(
              [...(type === "init" ? [] : current), ...display].map((candle) => [
                candle.timestamp,
                candle,
              ]),
            );
            const next = [...merged.values()]
              .toSorted((left, right) => left.timestamp - right.timestamp)
              .slice(-20);
            liveBarRef.current = next.at(-1) ?? null;
            return next;
          });
          setError(null);
        } catch (loadError) {
          callback([], { backward: false, forward: false });
          if (
            !active ||
            dataLoaderGenerationRef.current !== generation ||
            requestController.signal.aborted
          )
            return;
          setError(
            loadError instanceof Error ? loadError.message : "과거 캔들을 불러오지 못했습니다.",
          );
        }
      },
      subscribeBar({ callback }) {
        liveCallbackRef.current = callback;
      },
      unsubscribeBar() {
        liveCallbackRef.current = null;
      },
    });
    chart.setSymbol({
      ticker: instrument.symbol,
      pricePrecision: instrument.currency === "KRW" ? 0 : 4,
      volumePrecision: 0,
    });
    chart.setPeriod(chartPeriod);
    return () => {
      active = false;
      requestController.abort();
    };
  }, [instrument, ready, settings.period]);

  useEffect(() => {
    if (!ready) return;
    const query = new URLSearchParams({ instrumentId: instrument.instrumentId });
    const source = new EventSource(`/api/market/stream?${query.toString()}`);
    source.addEventListener("status", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { status?: string };
        setStreamStatus(
          payload.status === "connected"
            ? "실시간 연결"
            : payload.status === "error"
              ? "재연결 중"
              : "연결 중",
        );
      } catch {
        setStreamStatus("재연결 중");
      }
    });
    source.addEventListener("trade", (event) => {
      try {
        const trade = JSON.parse((event as MessageEvent<string>).data) as {
          price: number;
          timestamp: string;
        };
        if (!Number.isFinite(trade.price)) return;
        const timestamp = Date.parse(trade.timestamp);
        const duration =
          settings.period === "1m" ? 60_000 : settings.period === "5m" ? 300_000 : 86_400_000;
        const previous = liveBarRef.current;
        const dailyBucket = dailyBucketStart(timestamp, instrument.timezone);
        const sameMarketDay =
          settings.period === "1d" &&
          previous !== null &&
          dailyBucketStart(previous.timestamp, instrument.timezone) === dailyBucket;
        const bucket =
          settings.period === "1d"
            ? sameMarketDay && previous
              ? previous.timestamp
              : dailyBucket
            : Math.floor(timestamp / duration) * duration;
        const sameBucket = previous?.timestamp === bucket;
        const next: KLineData =
          sameBucket && previous
            ? {
                ...previous,
                high: Math.max(previous.high, trade.price),
                low: Math.min(previous.low, trade.price),
                close: trade.price,
              }
            : {
                timestamp: bucket,
                open: trade.price,
                high: trade.price,
                low: trade.price,
                close: trade.price,
                volume: 0,
              };
        liveBarRef.current = next;
        liveCallbackRef.current?.(next);
        setRecentCandles((current) => {
          const merged = new Map([...current, next].map((candle) => [candle.timestamp, candle]));
          return [...merged.values()]
            .toSorted((left, right) => left.timestamp - right.timestamp)
            .slice(-20);
        });
      } catch {
        // Invalid frames are ignored; the REST candle loader remains authoritative.
      }
    });
    source.onerror = () => setStreamStatus("재연결 중");
    return () => source.close();
  }, [instrument.instrumentId, instrument.timezone, ready, settings.period]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeIndicator();
    for (const instance of indicatorInstances) {
      installConfiguredIndicator(
        chart,
        instance,
        instrument.timezone,
        settings.period,
        dailyIndicatorCandles,
      );
    }
    const indicators = chart.getIndicators();
    setActiveIndicators(
      indicators.map((indicator) => `${indicator.name}:${indicator.id}`).toSorted(),
    );
    setActiveIndicatorStyles(
      indicators
        .map((indicator) => {
          const line = indicator.styles?.lines?.[0];
          const bar = indicator.styles?.bars?.[0];
          const circle = indicator.styles?.circles?.[0];
          const figureType = indicator.figures[0]?.type;
          const color =
            figureType === "circle"
              ? circle?.noChangeColor
              : figureType === "bar"
                ? bar?.upColor
                : line?.color;
          return `${indicator.id}:${color ?? ""}:${figureType === "circle" ? (circle?.borderSize ?? 0) : (line?.size ?? 0)}`;
        })
        .toSorted(),
    );
  }, [dailyIndicatorCandles, indicatorInstances, instrument.timezone, ready, settings.period]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    restoringRef.current = true;
    chart.removeOverlay({ groupId: "qos-drawings" });
    for (const drawing of settings.drawings) {
      chart.createOverlay({
        id: drawing.id,
        groupId: "qos-drawings",
        name: overlayNameForDrawing(drawing.kind),
        points: drawing.points.map((point) => ({
          timestamp: Date.parse(point.timestamp),
          value: point.value,
        })),
        extendData: { savedKind: drawing.kind },
        onDrawEnd: ({ chart: eventChart }) => {
          if (!restoringRef.current) {
            onSettingsChange({ ...settingsRef.current, drawings: serializeDrawings(eventChart) });
          }
        },
        onRemoved: ({ chart: eventChart }) => {
          if (!restoringRef.current) {
            onSettingsChange({ ...settingsRef.current, drawings: serializeDrawings(eventChart) });
          }
        },
      });
    }
    setDrawingCount(chart.getOverlays({ groupId: "qos-drawings" }).length);
    setDrawingPointCount(
      settings.drawings.reduce((sum, drawing) => sum + drawing.points.length, 0),
    );
    restoringRef.current = false;
  }, [onSettingsChange, ready, settings.drawings]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeOverlay({ groupId: "qos-signals" });
    for (const signal of signals) {
      const timestamp = Date.parse(signal.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      chart.createOverlay({
        groupId: "qos-signals",
        name: "qosSignal",
        lock: true,
        points: [{ timestamp, value: signal.price }],
        extendData: { side: signal.side, reason: signal.reason, timestamp: signal.timestamp },
        onClick: () => {
          setSelectedSignal(signal);
          window.requestAnimationFrame(() =>
            document.querySelector<HTMLElement>("#selected-signal-explanation")?.focus(),
          );
          return true;
        },
      });
    }
  }, [ready, signals]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    chart.removeOverlay({ groupId: "qos-strategy-levels" });
    for (const level of levels.slice(-200)) {
      const from = Date.parse(level.from);
      const to = Date.parse(level.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      chart.createOverlay({
        groupId: "qos-strategy-levels",
        name: overlayNameForDrawing("horizontal_segment"),
        lock: true,
        points: [
          { timestamp: from, value: level.value },
          { timestamp: to, value: level.value },
        ],
        extendData: { label: level.label, kind: level.kind },
        styles: {
          line: {
            color:
              level.kind === "TARGET"
                ? "#69e3b4"
                : level.kind === "TRAILING"
                  ? "#ffc46b"
                  : "#ff8d7d",
            size: level.kind === "TRAILING" ? 2 : 1,
            style: level.kind === "TRAILING" ? "solid" : "dashed",
          },
        },
      });
    }
  }, [levels, ready]);

  function updateIndicatorInstances(instances: IndicatorInstance[]) {
    const uniqueNames = [...new Set(instances.map((instance) => instance.name))];
    onSettingsChange({
      ...settings,
      mainIndicators: uniqueNames.filter((name) =>
        LEGACY_MAIN.has(name),
      ) as ChartSettings["mainIndicators"],
      subIndicators: uniqueNames.filter((name) =>
        LEGACY_SUB.has(name),
      ) as ChartSettings["subIndicators"],
      indicatorInstances: instances,
    });
  }

  function beginDrawing(kind: DrawingKind) {
    const chart = chartRef.current;
    if (!chart) return;
    chart.createOverlay({
      groupId: "qos-drawings",
      name: overlayNameForDrawing(kind),
      extendData: { savedKind: kind },
      onDrawEnd: ({ chart: eventChart }) => {
        const drawings = serializeDrawings(eventChart);
        setDrawingCount(drawings.length);
        setDrawingPointCount(drawings.reduce((sum, drawing) => sum + drawing.points.length, 0));
        onSettingsChange({ ...settingsRef.current, drawings });
        setActiveDrawing(null);
      },
      onRemoved: ({ chart: eventChart }) => {
        if (!restoringRef.current) {
          const drawings = serializeDrawings(eventChart);
          setDrawingCount(drawings.length);
          setDrawingPointCount(drawings.reduce((sum, drawing) => sum + drawing.points.length, 0));
          onSettingsChange({ ...settingsRef.current, drawings });
        }
      },
    });
    setActiveDrawing(kind);
    setDrawingCount(chart.getOverlays({ groupId: "qos-drawings" }).length);
    setDrawingPointCount(
      chart
        .getOverlays({ groupId: "qos-drawings" })
        .reduce((sum, overlay) => sum + overlay.points.length, 0),
    );
  }

  function downloadChartImage() {
    const chart = chartRef.current;
    if (!chart) return;
    const link = document.createElement("a");
    link.href = chart.getConvertPictureUrl(true, "png", "#ffffff");
    link.download = `${instrument.symbol}-${settings.period}-chart.png`;
    link.click();
  }

  async function enterFullscreen() {
    const shell = containerRef.current?.closest<HTMLElement>(".market-chart-shell");
    if (!shell?.requestFullscreen) {
      setError("이 브라우저는 차트 전체 화면을 지원하지 않습니다.");
      return;
    }
    try {
      await shell.requestFullscreen();
      requestAnimationFrame(() => chartRef.current?.resize());
    } catch {
      setError("차트 전체 화면을 열지 못했습니다.");
    }
  }

  const exact = crosshair ?? recentCandles.at(-1) ?? null;

  return (
    <section className="market-chart-shell" aria-labelledby="market-chart-title">
      <header className="market-chart-heading">
        <div>
          <span className="eyebrow">TOSS MARKET DATA</span>
          <h2 id="market-chart-title" tabIndex={-1}>
            {instrument.displayName} <small>{instrument.symbol}</small>
          </h2>
          <p>
            {instrument.market} · {instrument.currency} · {instrument.timezone}
            <span className="stream-status"> · {streamStatus}</span>
          </p>
        </div>
        <div className="candle-legend" aria-label="캔들 색 범례">
          <span>
            <i className="legend-candle up" /> 상승 적색
          </span>
          <span>
            <i className="legend-candle down" /> 하락 청색
          </span>
        </div>
      </header>

      <div className="chart-toolbar" aria-label="차트 주기와 화면 제어">
        <div className="tool-group" aria-label="봉 주기">
          {(["1m", "5m", "1d"] as const).map((period) => (
            <button
              type="button"
              key={period}
              aria-pressed={settings.period === period}
              onClick={() => onSettingsChange({ ...settings, period, visibleRange: null })}
            >
              {period === "1m" ? "1분" : period === "5m" ? "5분" : "일봉"}
            </button>
          ))}
        </div>
        <div className="tool-group" aria-label="화면 이동과 확대">
          <button type="button" onClick={() => chartRef.current?.zoomAtCoordinate(0.8)}>
            확대 +
          </button>
          <button type="button" onClick={() => chartRef.current?.zoomAtCoordinate(-0.8)}>
            축소 −
          </button>
          <button
            type="button"
            onClick={() => {
              const chart = chartRef.current;
              if (!chart) return;
              const count = Math.max(1, chart.getDataList().length);
              chart.setBarSpace(
                Math.max(3, Math.min(14, (containerRef.current?.clientWidth ?? 800) / count)),
              );
              chart.scrollToRealTime(0);
            }}
          >
            화면 맞춤
          </button>
          <button type="button" onClick={() => chartRef.current?.scrollToRealTime(0)}>
            최신 봉
          </button>
          <button type="button" onClick={downloadChartImage}>
            차트 저장
          </button>
          <button type="button" onClick={() => void enterFullscreen()}>
            전체 화면
          </button>
        </div>
      </div>

      <details className="chart-tools" open>
        <summary>지표 · 드로잉 도구</summary>
        <IndicatorManager instances={indicatorInstances} onChange={updateIndicatorInstances} />
        {dailyIndicatorStatus === "loading" ? (
          <p className="indicator-history-status" role="status">
            완료 일봉 지표 이력을 불러오는 중입니다.
          </p>
        ) : null}
        {dailyIndicatorStatus === "error" ? (
          <p className="indicator-settings-error" role="alert">
            완료 일봉 지표 이력이 없거나 계산 기간보다 부족합니다. 가격 소스와 기간을 확인해 주세요.
          </p>
        ) : null}
        <div className="drawing-tools" aria-label="차트 드로잉">
          {DRAWINGS.map((drawing) => (
            <button
              key={drawing.kind}
              type="button"
              aria-pressed={activeDrawing === drawing.kind}
              onClick={() => beginDrawing(drawing.kind)}
            >
              <DrawingIcon kind={drawing.kind} />
              <span>{drawing.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="danger-tool"
            onClick={() => {
              restoringRef.current = true;
              chartRef.current?.removeOverlay({ groupId: "qos-drawings" });
              restoringRef.current = false;
              setDrawingCount(0);
              setDrawingPointCount(0);
              setActiveDrawing(null);
              onSettingsChange({ ...settings, drawings: [] });
            }}
          >
            그림 전체 삭제
          </button>
        </div>
      </details>

      <p className="drawing-guidance" role="status" aria-live="polite">
        {activeDrawing
          ? DRAWING_GUIDANCE[activeDrawing]
          : "드로잉 도구를 선택하면 차트에 직접 표시하고 전략과 함께 저장합니다."}
      </p>

      {error ? (
        <div className="chart-error" role="alert">
          {error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="kline-chart"
        role="img"
        tabIndex={0}
        aria-label={`${instrument.displayName} ${settings.period} 캔들차트. 상승은 적색, 하락은 청색이며 십자선과 확대·이동을 지원합니다.`}
        data-loaded-count={loadedCount}
        data-indicators={activeIndicators.join(",")}
        data-indicator-styles={activeIndicatorStyles.join(",")}
        data-daily-indicator-bars={dailyIndicatorCandles.length}
        data-indicator-instances={indicatorInstances
          .map(
            (indicator) =>
              `${indicator.name}:${indicator.calcParams.join("-")}:${indicator.source}:${indicator.timeframe}`,
          )
          .join(",")}
        data-drawing-count={drawingCount}
        data-drawing-points={drawingPointCount}
      />

      <p className="chart-runtime-status" role="status">
        {loadedCount.toLocaleString("ko-KR")}개 봉 · 활성 지표{" "}
        {activeIndicators.length > 0
          ? activeIndicators.map((indicator) => indicator.split(":")[0]).join(", ")
          : "없음"}{" "}
        · 드로잉 {drawingCount}개{historyExhausted ? " · 가장 오래된 데이터 경계" : ""}
      </p>

      <div className="chart-exact" aria-live="polite">
        {exact ? (
          <p>
            <time dateTime={new Date(exact.timestamp).toISOString()}>
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: instrument.timezone,
                dateStyle: "medium",
                timeStyle: settings.period === "1d" ? undefined : "short",
              }).format(exact.timestamp)}
            </time>
            <span>시 {formatPrice(exact.open, instrument.currency)}</span>
            <span>고 {formatPrice(exact.high, instrument.currency)}</span>
            <span>저 {formatPrice(exact.low, instrument.currency)}</span>
            <span>종 {formatPrice(exact.close, instrument.currency)}</span>
            <span>거래량 {(exact.volume ?? 0).toLocaleString("ko-KR")}</span>
          </p>
        ) : (
          <p>캔들을 불러오는 중입니다.</p>
        )}
      </div>

      {selectedSignal ? (
        <aside
          className="selected-signal-explanation"
          id="selected-signal-explanation"
          tabIndex={-1}
          aria-label="선택한 매매 신호 근거"
        >
          <header>
            <span>{selectedSignal.side === "BUY" ? "▲ BUY" : "▼ SELL"}</span>
            <button
              type="button"
              onClick={() => setSelectedSignal(null)}
              aria-label="신호 설명 닫기"
            >
              닫기
            </button>
          </header>
          <strong>
            {selectedSignal.timestamp} · {formatPrice(selectedSignal.price, instrument.currency)}
          </strong>
          <p>{selectedSignal.reason}</p>
        </aside>
      ) : null}

      {signals.length > 0 ? (
        <details className="signal-table-wrap">
          <summary>BUY/SELL 신호 {signals.length}건</summary>
          <div className="table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>구분</th>
                  <th>시각</th>
                  <th>가격</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((signal) => (
                  <tr key={`${signal.side}-${signal.timestamp}-${signal.price}`}>
                    <td>
                      <strong>{signal.side === "BUY" ? "▲ BUY" : "▼ SELL"}</strong>
                    </td>
                    <td>
                      <time dateTime={signal.timestamp}>{signal.timestamp}</time>
                    </td>
                    <td>{formatPrice(signal.price, instrument.currency)}</td>
                    <td>{signal.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
