import { useEffect, useRef } from "react";
import { GhosttyTerminalAdapter } from "../terminal/adapter";
import { TerminalSocket } from "../terminal/socket";
import type { SocketState } from "../terminal/socket";
import { BrowserOpenHandler } from "../terminal/browser-open";

interface TerminalPaneProps {
  /** Workspace name — the server derives the actual sandbox ID from user identity + workspace. */
  workspace: string;
  sessionId?: string;
  onStateChange?: (state: SocketState) => void;
}

export interface TerminalPaneHandle {
  sendCtrlC(): void;
  sendCtrlD(): void;
  focus(): void;
}

/**
 * TerminalPane — renders a ghostty-web terminal connected to a Cloudflare
 * Sandbox PTY via WebSocket.
 *
 * The component owns the full lifecycle:
 *   create adapter → mount → connect socket → wire I/O → cleanup on unmount
 *
 * Reconnecting to the same session resets the terminal before the server
 * replays its PTY buffer, avoiding duplicate output.
 */
export function TerminalPane({ workspace, sessionId, onStateChange }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Use a ref so the effect closure always has the latest callback
  // without re-running the effect on every parent render.
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let socket: TerminalSocket | null = null;

    // ---- terminal adapter ----
    const terminal = new GhosttyTerminalAdapter({
      cursorBlink: true,
      fontSize: 14,
    });
    terminal.mount(container);

    // ---- browser open handler (detects [[BROWSER_OPEN:url]] markers) ----
    const browserOpenHandler = new BrowserOpenHandler();

    // ---- wire user input → socket ----
    terminal.onInput((data) => socket?.sendInput(data));

    // ---- debounced resize → socket ----
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    terminal.onResize((cols, rows) => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (cols > 0 && rows > 0) {
          socket?.sendResize(cols, rows);
        }
      }, 150);
    });

    // ---- resize observers ----
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => terminal.fit());
    });
    observer.observe(container);

    const onWindowResize = () => terminal.fit();
    window.addEventListener("resize", onWindowResize);

    // ---- connect ----
    void (async () => {
      const initialSize = await terminal.prepareForAttach();
      if (disposed) return;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        workspace,
        cols: String(initialSize.cols),
        rows: String(initialSize.rows),
      });
      if (sessionId) params.set("session", sessionId);
      const wsUrl = `${proto}//${location.host}/ws/terminal?${params}`;

      const activeSocket = new TerminalSocket({
        url: wsUrl,

        onOutput(data) {
          // Process data for browser open markers before writing to terminal
          browserOpenHandler.process(new Uint8Array(data));
          terminal.write(new Uint8Array(data));
        },

        onStateChange(state, error) {
          onStateChangeRef.current?.(state);
          // Reset terminal before server replays the PTY buffer
          // to prevent duplicate output on reconnect.
          if (state === "reconnecting") {
            terminal.reset();
            browserOpenHandler.reset();
          }
          if (error) {
            console.error("[ccccocc] terminal:", error.message);
          }
        },

        onReady() {
          // Send actual dimensions once the terminal is live.
          const { cols, rows } = terminal;
          if (cols > 0 && rows > 0) {
            activeSocket.sendResize(cols, rows);
          }
          terminal.focus();
        },

        onSessionAttached({ resumed, isReconnect }) {
          if (isReconnect && !resumed) {
            // Reconnect got a fresh shell — container likely restarted
            terminal.write(
              "\r\n\x1b[93m[Container restarted \u2014 previous shell state and files are gone unless persisted]\x1b[0m\r\n",
            );
          } else if (isReconnect && resumed) {
            terminal.write("\r\n\x1b[90m[Resumed existing PTY session]\x1b[0m\r\n");
          }
          // First connect: no message needed — the shell prompt speaks for itself
        },

        onExit(code, signal) {
          const sig = signal ? `, signal ${signal}` : "";
          terminal.write(`\r\n\x1b[90m[Process exited: code ${code}${sig}]\x1b[0m\r\n`);
        },
      });

      socket = activeSocket;
      if (disposed) {
        activeSocket.disconnect();
        return;
      }
      activeSocket.connect();
    })();

    // ---- cleanup ----
    return () => {
      disposed = true;
      window.removeEventListener("resize", onWindowResize);
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      socket?.disconnect();
      terminal.dispose();
    };
  }, [workspace, sessionId]);

  return (
    <div ref={containerRef} className="terminal-pane" style={{ width: "100%", height: "100%", overflow: "hidden" }} />
  );
}
