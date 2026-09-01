import WebSocket, { type RawData } from "ws";

import { isKoreanMarket, type Market } from "@/src/domain/instruments";
import { TossTradeMessageSchema } from "./schemas";
import type { TossClient } from "./client";

export interface RealtimeInstrument {
  market: Market;
  symbol: string;
}

export interface RealtimeTrade {
  marketRegion: "kr" | "us";
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
  currency: string;
}

export type RealtimeStatus =
  "connecting" | "connected" | "disconnected" | "reconnecting" | "stopped";

export function createTradeSubscription(instruments: RealtimeInstrument[], id: string): unknown[] {
  const domestic = new Set<string>();
  const us = new Set<string>();
  for (const instrument of instruments) {
    (isKoreanMarket(instrument.market) ? domestic : us).add(instrument.symbol);
  }
  const declaration: unknown[] = [{ id }];
  if (domestic.size > 0) {
    declaration.push({ type: "trade:kr", codes: [...domestic].toSorted() });
  }
  if (us.size > 0) declaration.push({ type: "trade:us", codes: [...us].toSorted() });
  return declaration;
}

export function parseTradeFrame(frame: string): RealtimeTrade | null {
  if (frame === "PONG") return null;
  try {
    const parsed = TossTradeMessageSchema.safeParse(JSON.parse(frame) as unknown);
    if (!parsed.success) return null;
    const topic = parsed.data.topic.split(":");
    return {
      marketRegion: topic[1] as "kr" | "us",
      symbol: topic.slice(2).join(":"),
      price: Number(parsed.data.data.price),
      volume: Number(parsed.data.data.volume),
      timestamp: parsed.data.data.timestamp,
      currency: parsed.data.data.currency,
    };
  } catch {
    return null;
  }
}

export interface RealtimeConnectionOptions {
  client: TossClient;
  instruments: RealtimeInstrument[];
  onTrade: (trade: RealtimeTrade) => void;
  onStatus?: (status: RealtimeStatus) => void;
  onError?: (error: Error) => void;
  url?: string;
  reconnect?: boolean;
}

export class TossRealtimeConnection {
  readonly #client: TossClient;
  readonly #onTrade: (trade: RealtimeTrade) => void;
  readonly #onStatus: (status: RealtimeStatus) => void;
  readonly #onError: (error: Error) => void;
  readonly #url: string;
  readonly #reconnect: boolean;
  #instruments: RealtimeInstrument[];
  #socket: WebSocket | null = null;
  #stopped = false;
  #attempt = 0;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RealtimeConnectionOptions) {
    this.#client = options.client;
    this.#instruments = options.instruments;
    this.#onTrade = options.onTrade;
    this.#onStatus = options.onStatus ?? (() => undefined);
    this.#onError = options.onError ?? (() => undefined);
    this.#url = options.url ?? "wss://openapi-ws.tossinvest.com/ws/v1";
    this.#reconnect = options.reconnect ?? true;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connect();
  }

  async #connect(): Promise<void> {
    if (this.#stopped || this.#instruments.length === 0) return;
    this.#onStatus(this.#attempt === 0 ? "connecting" : "reconnecting");
    try {
      const token = await this.#client.getAccessToken();
      if (this.#stopped) return;
      const socket = new WebSocket(this.#url, {
        headers: { authorization: `Bearer ${token}` },
        handshakeTimeout: 8_000,
      });
      this.#socket = socket;
      socket.on("open", () => {
        this.#attempt = 0;
        this.#onStatus("connected");
        this.#sendSubscription();
        this.#pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("PING");
        }, 60_000);
      });
      socket.on("message", (data: RawData) => {
        const trade = parseTradeFrame(data.toString());
        if (trade) this.#onTrade(trade);
      });
      socket.on("error", (error) => this.#onError(error));
      socket.on("close", () => {
        this.#clearPing();
        if (this.#socket === socket) this.#socket = null;
        if (this.#stopped) {
          this.#onStatus("stopped");
          return;
        }
        this.#onStatus("disconnected");
        if (this.#reconnect) this.#scheduleReconnect();
      });
    } catch (error) {
      this.#onError(error instanceof Error ? error : new Error("실시간 연결에 실패했습니다."));
      if (this.#reconnect && !this.#stopped) this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer || this.#stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.#attempt, 5));
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);
  }

  #sendSubscription(): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(
      JSON.stringify(createTradeSubscription(this.#instruments, `qos-${Date.now()}`)),
    );
  }

  updateInstruments(instruments: RealtimeInstrument[]): void {
    this.#instruments = instruments;
    this.#sendSubscription();
  }

  #clearPing(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  stop(): void {
    this.#stopped = true;
    this.#clearPing();
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send("[]");
    this.#socket?.close(1000, "QOS monitor stopped");
    this.#socket = null;
    this.#onStatus("stopped");
  }
}
