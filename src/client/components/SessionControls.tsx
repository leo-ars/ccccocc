import { useWorkspaceStore } from "../workspace/store";
import type { SocketState } from "../terminal/socket";

const STATE_COLOR: Record<SocketState, string> = {
  disconnected: "#888",
  connecting: "#f39c12",
  connected: "#27ae60",
  reconnecting: "#f39c12",
  ended: "#e74c3c",
  error: "#e74c3c",
};

const STATE_LABEL: Record<SocketState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  reconnecting: "Reconnecting\u2026",
  ended: "Session Ended",
  error: "Error",
};

export function SessionControls() {
  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const connectionState: SocketState = useWorkspaceStore((s) => s.connectionStates[s.activeTabId] ?? "disconnected");
  const isSharedSession = useWorkspaceStore((s) => s.isSharedSession);
  const reconnect = useWorkspaceStore((s) => s.reconnect);
  const newSession = useWorkspaceStore((s) => s.newSession);
  const resetSession = useWorkspaceStore((s) => s.resetSession);

  const socketBusy = connectionState === "connecting" || connectionState === "reconnecting";

  return (
    <>
      {isSharedSession && (
        <div className="shared-banner">Shared session — other users may be connected and can send input</div>
      )}

      <div className="session-bar">
        {/* ---- identifiers ---- */}
        <div className="session-info">
          <span className="label">Workspace</span>
          <span className="value">default</span>
          <span className="divider" aria-hidden>
            |
          </span>
          <span className="label">Session</span>
          <span className="value" title={activeTab?.sessionId ?? ""}>
            {activeTab?.sessionId ?? ""}
          </span>
        </div>

        {/* ---- connection state ---- */}
        <div className="session-state">
          <span className="state-dot" style={{ backgroundColor: STATE_COLOR[connectionState] }} />
          <span>{STATE_LABEL[connectionState]}</span>
        </div>

        {/* ---- actions ---- */}
        <div className="session-actions">
          <button onClick={reconnect} disabled={socketBusy}>
            Reconnect
          </button>
          <button onClick={resetSession} disabled={socketBusy}>
            Reset Session
          </button>
          <button onClick={newSession}>New Session</button>
        </div>
      </div>
    </>
  );
}
