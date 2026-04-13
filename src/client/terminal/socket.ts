/**
 * TerminalSocket — manages the WebSocket connection to a sandbox terminal.
 *
 * Protocol (from Cloudflare Sandbox SDK docs):
 *   Binary frames  = terminal I/O  (ANSI/VT byte stream, UTF-8)
 *   Text frames    = JSON control / status messages
 *
 * Lifecycle:
 *   1. Client opens WS, sets binaryType = "arraybuffer"
 *   2. Server may replay buffered PTY output (binary) before ready
 *   3. Server sends { type: "ready" }
 *   4. Bidirectional binary I/O
 *   5. On disconnect the PTY survives; reconnecting replays buffer
 */
import type { ConnectionState, ServerStatusMessage } from "../../shared/protocol";

export type SocketState = ConnectionState;

export interface TerminalSocketOptions {
  /** WebSocket URL including query params (id, session, token). */
  url: string;
  /** Called for every binary frame (terminal output). */
  onOutput: (data: ArrayBuffer) => void;
  /** Called when the connection state changes. */
  onStateChange: (state: SocketState, error?: Error) => void;
  /** Called once when the server sends the "ready" status. */
  onReady: () => void;
  /** Called when the shell process exits. */
  onExit: (code: number, signal?: string) => void;
  /**
   * Called after a successful (re)connect with session context.
   * `resumed: true` means the server replayed a PTY buffer (existing session).
   * `resumed: false` means a fresh shell (container may have restarted).
   */
  onSessionAttached?: (info: { resumed: boolean; isReconnect: boolean }) => void;
  /** Enable automatic reconnection (default true). */
  reconnect?: boolean;
  /** Max reconnect attempts before giving up (default 10). */
  maxReconnectAttempts?: number;
}

export class TerminalSocket {
  private ws: WebSocket | null = null;
  private state: SocketState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private readonly encoder = new TextEncoder();
  /** Whether we ever reached "connected" state in this socket's lifetime. */
  private wasConnectedBefore = false;
  /** Whether binary frames arrived before the "ready" message on this connection. */
  private receivedBufferBeforeReady = false;

  constructor(private opts: TerminalSocketOptions) {}

  // --------------- public API ---------------

  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /** Send user keystrokes as binary UTF-8. */
  sendInput(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(this.encoder.encode(data));
    }
  }

  /** Send a resize control message. Both cols and rows must be positive. */
  sendResize(cols: number, rows: number): void {
    if (cols < 1 || rows < 1) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "resize",
          cols: Math.round(cols),
          rows: Math.round(rows),
        }),
      );
    }
  }

  getState(): SocketState {
    return this.state;
  }

  // --------------- internals ---------------

  private openSocket(): void {
    this.receivedBufferBeforeReady = false;
    this.setState(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(this.opts.url);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      // Connected at transport level — wait for "ready" status
      // before marking state as "connected".
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary frame: terminal output (may arrive before "ready").
        // Track that we received buffer replay — this means the PTY
        // session survived and is being resumed (not a fresh shell).
        this.receivedBufferBeforeReady = true;
        this.opts.onOutput(event.data);
        return;
      }

      // Text frame: JSON control / status message.
      let msg: ServerStatusMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return; // ignore malformed frames
      }

      switch (msg.type) {
        case "ready": {
          const isReconnect = this.wasConnectedBefore;
          const resumed = this.receivedBufferBeforeReady;
          this.wasConnectedBefore = true;

          this.setState("connected");
          this.opts.onReady();
          this.opts.onSessionAttached?.({ resumed, isReconnect });
          break;
        }

        case "exit":
          this.setState("ended");
          this.opts.onExit(msg.code, msg.signal);
          break;

        case "error":
          this.setState("error", new Error(msg.message));
          break;
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.intentionalClose || this.state === "ended") return;
      this.maybeReconnect();
    });

    ws.addEventListener("error", () => {
      // The "close" event always fires after "error", so reconnect
      // logic is handled there.
    });

    this.ws = ws;
  }

  private maybeReconnect(): void {
    const maxAttempts = this.opts.maxReconnectAttempts ?? 10;
    if (this.opts.reconnect === false || this.reconnectAttempts >= maxAttempts) {
      this.setState("error", new Error("Connection lost"));
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // prevent stacking timers

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.setState("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(next: SocketState, error?: Error): void {
    if (this.state === next && !error) return;
    this.state = next;
    this.opts.onStateChange(next, error);
  }
}
