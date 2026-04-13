import type { PipelineFrameMessage } from "@/lib/detection";

interface OutgoingFrame {
  frame_id: number;
  image: string;
  healing_enabled: boolean;
  detection_level: number;
}

interface PipelineSocketConfig {
  url?: string;
  onFrame: (message: PipelineFrameMessage) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected" | "error") => void;
}

function getDefaultWsUrl(): string {
  if (import.meta.env.VITE_PIPELINE_WS_URL) {
    return String(import.meta.env.VITE_PIPELINE_WS_URL).trim();
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const wsFromQuery = params.get("ws");
    if (wsFromQuery) {
      window.localStorage.setItem("pipelineWsUrl", wsFromQuery);
      return wsFromQuery;
    }

    const wsFromStorage = window.localStorage.getItem("pipelineWsUrl");
    if (wsFromStorage) {
      return wsFromStorage;
    }
  } catch {
    // Ignore URL/localStorage parsing errors.
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;

  if (host === "localhost" || host === "127.0.0.1") {
    return `${protocol}://localhost:8000/ws/pipeline`;
  }

  // Production fallback: try same domain backend (works with reverse proxy setups).
  return `${protocol}://${window.location.host}/ws/pipeline`;
}

export class PipelineSocket {
  private ws: WebSocket | null = null;
  private connected = false;
  private busy = false;
  private queued: OutgoingFrame | null = null;
  private readonly cfg: PipelineSocketConfig;

  constructor(cfg: PipelineSocketConfig) {
    this.cfg = cfg;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.cfg.onStatus?.("connecting");
    this.ws = new WebSocket(this.cfg.url ?? getDefaultWsUrl());

    this.ws.onopen = () => {
      this.connected = true;
      this.cfg.onStatus?.("connected");
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.busy = false;
      this.queued = null;
      this.cfg.onStatus?.("disconnected");
    };

    this.ws.onerror = () => {
      this.cfg.onStatus?.("error");
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as PipelineFrameMessage;
        if (parsed.type === "frame_result") {
          this.cfg.onFrame(parsed);
        }
      } catch {
        // Ignore malformed payloads.
      } finally {
        this.busy = false;
        if (this.queued) {
          const next = this.queued;
          this.queued = null;
          this.sendFrame(next);
        }
      }
    };
  }

  disconnect() {
    this.connected = false;
    this.busy = false;
    this.queued = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  sendFrame(payload: OutgoingFrame) {
    if (!this.isConnected() || !this.ws) {
      return;
    }

    if (this.busy) {
      this.queued = payload;
      return;
    }

    this.busy = true;
    this.ws.send(
      JSON.stringify({
        type: "frame",
        ...payload,
      })
    );
  }
}
