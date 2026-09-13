"use client";

import { useEffect, useState } from "react";

interface TelegramStatus {
  configured: boolean;
  connected: boolean;
  botUsername: string | null;
  displayName: string | null;
  connectedAt: string | null;
}

interface MonitorStatus {
  status: "stopped" | "connecting" | "connected" | "reconnecting" | "error";
  heartbeatAt: string | null;
  enabledStrategies: number;
  deliveredSignals: number;
  failedSignals: number;
  lastErrorCode: string | null;
  providerRequests?: number;
  datasetCacheHits?: number;
  trackedTargets?: number;
  lastProviderSyncAt?: string | null;
  lastStrategyRefreshAt?: string | null;
  strategySource?: "PRIMARY" | "SNAPSHOT";
  strategySnapshotAt?: string | null;
  positions?: Array<{
    strategyId: string;
    instrumentId: string;
    hedgeInstrumentId: string | null;
    leg: "WAITING" | "LONG_PRIMARY" | "LONG_HEDGE";
  }>;
}

const MONITOR_LABEL: Record<MonitorStatus["status"], string> = {
  stopped: "감시 중지",
  connecting: "연결 준비",
  connected: "감시 연결됨",
  reconnecting: "재연결 중",
  error: "감시 오류",
};

function heartbeatLabel(value: string | null | undefined): string {
  if (!value) return "아직 heartbeat가 없습니다.";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "heartbeat 시각을 확인할 수 없습니다.";
  return `마지막 확인 ${new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(timestamp)}`;
}

export function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [monitor, setMonitor] = useState<MonitorStatus | null>(null);
  const monitorState = monitor?.status ?? "stopped";

  async function refresh() {
    const response = await fetch("/api/telegram/status", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("Telegram 상태를 확인하지 못했습니다.");
    setStatus((await response.json()) as TelegramStatus);
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/telegram/status", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        if (active) setStatus((await response.json()) as TelegramStatus);
      })
      .catch(() => {
        if (active) setMessage("Telegram 상태를 확인하지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/monitor/status", {
          headers: { accept: "application/json" },
        });
        if (response.ok && active) setMonitor((await response.json()) as MonitorStatus);
      } catch {
        // The visible status remains at the last confirmed value.
      }
    };
    void poll();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  async function action(endpoint: "connect" | "test") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/telegram/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: endpoint === "connect" ? JSON.stringify({ sendTest: true }) : undefined,
      });
      const payload = (await response.json()) as { error?: { message?: string }; sent?: boolean };
      if (!response.ok) throw new Error(payload.error?.message ?? "Telegram 요청에 실패했습니다.");
      await refresh();
      setMessage(
        endpoint === "connect"
          ? "Telegram private chat 연결과 테스트 전송을 완료했습니다."
          : "Telegram 테스트 알림을 전송했습니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Telegram 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="telegram-settings"
      id="automation"
      aria-labelledby="telegram-settings-title"
      aria-busy={busy}
    >
      <div>
        <div className="telegram-title-row">
          <div>
            <span className="eyebrow">AUTOMATION / TELEGRAM</span>
            <h2 id="telegram-settings-title">Telegram 알림</h2>
          </div>
          <strong className={`monitor-state monitor-state-${monitorState}`}>
            {MONITOR_LABEL[monitorState]}
          </strong>
        </div>
        <p>
          {status?.connected
            ? `@${status.botUsername} → ${status.displayName} 연결됨`
            : status?.configured
              ? "봇 채팅에 일반 메시지를 보낸 뒤 연결하세요. 특정 command는 필요하지 않습니다."
              : "TELEGRAM_BOT_TOKEN 서버 설정이 필요합니다."}
        </p>
        <p className={`monitor-runtime monitor-runtime-${monitorState}`}>
          {MONITOR_LABEL[monitorState]} · 전략 {monitor?.enabledStrategies ?? 0} · 감시 종목{" "}
          {monitor?.trackedTargets ?? 0} · 전송 {monitor?.deliveredSignals ?? 0} · 실패{" "}
          {monitor?.failedSignals ?? 0}
        </p>
        <p className="monitor-heartbeat">{heartbeatLabel(monitor?.heartbeatAt)}</p>
        <p className="monitor-heartbeat">
          TOSS REST {monitor?.providerRequests ?? 0}회 · 공유 dataset cache hit{" "}
          {monitor?.datasetCacheHits ?? 0}회
        </p>
        <p className="monitor-heartbeat">
          전략 source {monitor?.strategySource ?? "PRIMARY"} · paper position{" "}
          {monitor?.positions?.filter((position) => position.leg !== "WAITING").length ?? 0}개
        </p>
        {monitor?.strategySource === "SNAPSHOT" ? (
          <p className="monitor-recovery">
            원격 전략 저장소에 연결하지 못해 마지막 정상 snapshot으로 감시 중입니다. 새 설정은 원격
            연결 회복 뒤 반영됩니다. snapshot {heartbeatLabel(monitor.strategySnapshotAt)}
          </p>
        ) : null}
        {monitorState === "error" ? (
          <p className="monitor-recovery">
            <code>npm run deploy:local:status</code>로 server와 monitor를 확인하고 필요하면{" "}
            <code>npm run deploy:local</code>로 함께 재시작하세요.
            {monitor?.lastErrorCode ? (
              <>
                {" "}
                마지막 오류 <code>{monitor.lastErrorCode}</code>
              </>
            ) : null}
          </p>
        ) : monitorState === "stopped" ? (
          <p className="monitor-recovery">
            전략 tracking을 켜면 local release monitor가 60초 안에 반영합니다. 개발 서버만 실행한
            경우에는 <code>npm run monitor</code>를 별도로 사용할 수 있습니다.
          </p>
        ) : null}
      </div>
      <div className="telegram-actions">
        <button
          className="primary-button"
          type="button"
          disabled={busy || !status?.configured}
          onClick={() => void action("connect")}
        >
          채팅 연결
        </button>
        <button
          type="button"
          disabled={busy || !status?.connected}
          onClick={() => void action("test")}
        >
          테스트 알림
        </button>
      </div>
      <details className="telegram-setup-guide">
        <summary>처음 연결하는 방법</summary>
        <ol>
          <li>Telegram의 @BotFather에서 새 bot을 만들고 token을 발급합니다.</li>
          <li>
            token은 브라우저가 아니라 서버의 <code>.env.local</code>에{" "}
            <code>TELEGRAM_BOT_TOKEN</code>으로 저장한 뒤 local release를 다시 시작합니다.
          </li>
          <li>만든 bot의 private chat에 아무 메시지를 한 번 보내고 위 ‘채팅 연결’을 누릅니다.</li>
          <li>‘테스트 알림’이 도착하면 저장 전략에서 종목별 감시를 ON 합니다.</li>
        </ol>
      </details>
      <p className="telegram-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
