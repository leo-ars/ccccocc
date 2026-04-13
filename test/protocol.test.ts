/**
 * Unit tests for TerminalSocket — the WebSocket protocol adapter.
 *
 * Covers:
 *  - binary output handling
 *  - JSON control / status handling (ready, exit, error)
 *  - reconnect logic
 *  - resize serialization
 *  - input encoding as binary UTF-8
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalSocket } from "../src/client/terminal/socket";
import type { SocketState } from "../src/client/terminal/socket";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WSListener = (event: { data?: unknown }) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  binaryType = "";
  readyState: number = MockWebSocket.CONNECTING;
  private listeners: Record<string, WSListener[]> = {};
  sent: unknown[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, handler: WSListener) {
    (this.listeners[event] ??= []).push(handler);
  }

  removeEventListener(event: string, handler: WSListener) {
    const arr = this.listeners[event];
    if (!arr) return;
    this.listeners[event] = arr.filter((h) => h !== handler);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  // -- test helpers --

  emit(event: string, data?: unknown) {
    for (const h of this.listeners[event] ?? []) h({ data });
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  simulateBinary(bytes: Uint8Array) {
    this.emit("message", bytes.buffer);
  }

  simulateText(json: object) {
    this.emit("message", JSON.stringify(json));
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  simulateError() {
    this.emit("error");
  }

  // Global registry for test assertions
  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }
}

// Patch global
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.reset();
  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket as unknown;
  vi.useFakeTimers();
});

afterEach(() => {
  (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSocket(overrides: Partial<ConstructorParameters<typeof TerminalSocket>[0]> = {}) {
  const callbacks = {
    onOutput: vi.fn(),
    onStateChange: vi.fn(),
    onReady: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
  const socket = new TerminalSocket({
    url: "wss://test/ws/terminal?id=sb1",
    ...callbacks,
  });
  return { socket, ...callbacks };
}

function lastMock(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TerminalSocket", () => {
  // ---- connection lifecycle ----

  it("sets binaryType to arraybuffer", () => {
    const { socket } = createSocket();
    socket.connect();
    expect(lastMock().binaryType).toBe("arraybuffer");
  });

  it("transitions to connecting on connect()", () => {
    const { socket, onStateChange } = createSocket();
    socket.connect();
    expect(onStateChange).toHaveBeenCalledWith("connecting", undefined);
  });

  it("transitions to connected on ready message", () => {
    const { socket, onStateChange, onReady } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    expect(onStateChange).toHaveBeenCalledWith("connected", undefined);
    expect(onReady).toHaveBeenCalled();
  });

  // ---- binary output ----

  it("forwards binary frames via onOutput", () => {
    const { socket, onOutput } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();

    const payload = new TextEncoder().encode("hello world");
    ws.simulateBinary(payload);

    expect(onOutput).toHaveBeenCalledTimes(1);
    const received = new Uint8Array(onOutput.mock.calls[0][0] as ArrayBuffer);
    expect(new TextDecoder().decode(received)).toBe("hello world");
  });

  it("accepts binary frames before ready (buffered replay)", () => {
    const { socket, onOutput, onReady } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();

    // Binary output arrives before ready
    ws.simulateBinary(new TextEncoder().encode("buffered"));
    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    // Then ready arrives
    ws.simulateText({ type: "ready" });
    expect(onReady).toHaveBeenCalled();
  });

  // ---- status messages ----

  it("handles exit status", () => {
    const { socket, onExit, onStateChange } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });
    ws.simulateText({ type: "exit", code: 0, signal: "SIGTERM" });

    expect(onExit).toHaveBeenCalledWith(0, "SIGTERM");
    expect(onStateChange).toHaveBeenCalledWith("ended", undefined);
  });

  it("handles error status", () => {
    const { socket, onStateChange } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "error", message: "Session not found" });

    expect(onStateChange).toHaveBeenCalledWith("error", expect.objectContaining({ message: "Session not found" }));
  });

  it("ignores malformed JSON text frames", () => {
    const { socket, onOutput, onStateChange } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();

    // Send raw string (not JSON) as text frame
    ws.emit("message", "not json at all{{{");
    // Should not throw or change state beyond "connecting"
    expect(onOutput).not.toHaveBeenCalled();
  });

  // ---- input encoding ----

  it("sends keystrokes as binary UTF-8", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendInput("ls -la\r");

    expect(ws.sent).toHaveLength(1);
    const sent = ws.sent[0] as Uint8Array;
    expect(new TextDecoder().decode(sent)).toBe("ls -la\r");
  });

  it("sends control codes (Ctrl+C = \\x03) as binary UTF-8", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendInput("\x03"); // Ctrl+C

    expect(ws.sent).toHaveLength(1);
    const sent = new Uint8Array(ws.sent[0] as Uint8Array);
    expect(sent[0]).toBe(3); // 0x03 = ETX
    expect(sent.length).toBe(1);
  });

  it("sends Ctrl+D (\\x04) correctly", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendInput("\x04"); // Ctrl+D (EOF)

    const sent = new Uint8Array(ws.sent[0] as Uint8Array);
    expect(sent[0]).toBe(4);
  });

  it("sends Ctrl+Z (\\x1a) correctly", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendInput("\x1a"); // Ctrl+Z (SIGTSTP)

    const sent = new Uint8Array(ws.sent[0] as Uint8Array);
    expect(sent[0]).toBe(26);
  });

  it("does not send input when socket is not open", () => {
    const { socket } = createSocket();
    socket.connect();
    // Socket is still in CONNECTING state
    socket.sendInput("test");
    expect(lastMock().sent).toHaveLength(0);
  });

  // ---- resize ----

  it("sends resize as JSON text", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendResize(120, 40);

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      type: "resize",
      cols: 120,
      rows: 40,
    });
  });

  it("rounds fractional dimensions", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendResize(119.7, 39.2);

    const msg = JSON.parse(ws.sent[0] as string);
    expect(msg.cols).toBe(120);
    expect(msg.rows).toBe(39);
  });

  it("rejects 0x0 dimensions", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendResize(0, 0);
    expect(ws.sent).toHaveLength(0);
  });

  it("rejects negative dimensions", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    socket.sendResize(-1, 24);
    expect(ws.sent).toHaveLength(0);
  });

  // ---- reconnect ----

  it("reconnects with exponential backoff on unexpected close", () => {
    const { socket, onStateChange } = createSocket();
    socket.connect();
    const ws1 = lastMock();
    ws1.simulateOpen();
    ws1.simulateText({ type: "ready" });

    // Unexpected close
    ws1.simulateClose();
    expect(onStateChange).toHaveBeenCalledWith("reconnecting", undefined);

    // First reconnect after 1s
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second reconnect after 2s
    const ws2 = lastMock();
    ws2.simulateClose();
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("stops reconnecting after max attempts", () => {
    const { socket, onStateChange } = createSocket({ maxReconnectAttempts: 2 });
    socket.connect();

    for (let i = 0; i < 2; i++) {
      lastMock().simulateClose();
      vi.advanceTimersByTime(60_000); // enough for any backoff
    }

    // After 2 attempts, should error out
    lastMock().simulateClose();
    expect(onStateChange).toHaveBeenCalledWith("error", expect.objectContaining({ message: "Connection lost" }));
  });

  it("does not reconnect after intentional disconnect", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();

    socket.disconnect();
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not reconnect after exit", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });
    ws.simulateText({ type: "exit", code: 0 });

    ws.simulateClose();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not stack multiple reconnect timers", () => {
    const { socket } = createSocket();
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    // Simulate close + error in rapid succession
    ws.simulateError();
    ws.simulateClose();

    vi.advanceTimersByTime(1000);
    // Should only create one new socket
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  // ---- session attach indication ----

  it("reports resumed=false on first connect (no buffer replay)", () => {
    const onSessionAttached = vi.fn();
    const { socket } = createSocket({ onSessionAttached });
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateText({ type: "ready" });

    expect(onSessionAttached).toHaveBeenCalledWith({
      resumed: false,
      isReconnect: false,
    });
  });

  it("reports resumed=true when buffer replayed before ready", () => {
    const onSessionAttached = vi.fn();
    const { socket } = createSocket({ onSessionAttached });
    socket.connect();
    const ws = lastMock();
    ws.simulateOpen();
    ws.simulateBinary(new TextEncoder().encode("buffered output"));
    ws.simulateText({ type: "ready" });

    expect(onSessionAttached).toHaveBeenCalledWith({
      resumed: true,
      isReconnect: false,
    });
  });

  it("reports isReconnect=true and resumed=true on reconnect with buffer replay", () => {
    const onSessionAttached = vi.fn();
    const { socket } = createSocket({ onSessionAttached });
    socket.connect();
    const ws1 = lastMock();
    ws1.simulateOpen();
    ws1.simulateText({ type: "ready" });

    // Unexpected close → reconnect
    ws1.simulateClose();
    vi.advanceTimersByTime(1000);
    const ws2 = lastMock();
    ws2.simulateOpen();
    ws2.simulateBinary(new TextEncoder().encode("replayed"));
    ws2.simulateText({ type: "ready" });

    expect(onSessionAttached).toHaveBeenLastCalledWith({
      resumed: true,
      isReconnect: true,
    });
  });

  it("reports isReconnect=true and resumed=false on reconnect without buffer (container restart)", () => {
    const onSessionAttached = vi.fn();
    const { socket } = createSocket({ onSessionAttached });
    socket.connect();
    const ws1 = lastMock();
    ws1.simulateOpen();
    ws1.simulateText({ type: "ready" });

    // Unexpected close → reconnect
    ws1.simulateClose();
    vi.advanceTimersByTime(1000);
    const ws2 = lastMock();
    ws2.simulateOpen();
    // No binary frames before ready → container restarted
    ws2.simulateText({ type: "ready" });

    expect(onSessionAttached).toHaveBeenLastCalledWith({
      resumed: false,
      isReconnect: true,
    });
  });

  // ---- disconnect ----

  it("transitions to disconnected on intentional close", () => {
    const { socket, onStateChange } = createSocket();
    socket.connect();
    lastMock().simulateOpen();

    socket.disconnect();
    expect(onStateChange).toHaveBeenCalledWith("disconnected", undefined);
  });
});
