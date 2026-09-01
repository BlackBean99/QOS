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
    const timer = setInterval(() => void poll(), 10_000);
    return () => {
      active = false;
      clearInterval(timer);
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
          {MONITOR_LABEL[monitorState]} · 전략 {monitor?.enabledStrategies ?? 0} · 전송{" "}
          {monitor?.deliveredSignals ?? 0} · 실패 {monitor?.failedSignals ?? 0}
        </p>
        <p className="monitor-heartbeat">{heartbeatLabel(monitor?.heartbeatAt)}</p>
        {monitorState === "error" ? (
          <p className="monitor-recovery">
            터미널에서 <code>npm run monitor</code>를 다시 실행하세요.
            {monitor?.lastErrorCode ? (
              <>
                {" "}
                마지막 오류 <code>{monitor.lastErrorCode}</code>
              </>
            ) : null}
          </p>
        ) : monitorState === "stopped" ? (
          <p className="monitor-recovery">
            저장 전략의 감시를 켠 뒤 터미널에서 <code>npm run monitor</code>를 실행하세요.
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
      <p className="telegram-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
