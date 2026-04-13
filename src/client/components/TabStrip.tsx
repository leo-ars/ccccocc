import { useWorkspaceStore } from "../workspace/store";
import type { SocketState } from "../terminal/socket";

const STATE_DOT_COLOR: Record<SocketState, string> = {
  disconnected: "#888",
  connecting: "#f39c12",
  connected: "#27ae60",
  reconnecting: "#f39c12",
  ended: "#e74c3c",
  error: "#e74c3c",
};

export function TabStrip() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const connectionStates = useWorkspaceStore((s) => s.connectionStates);
  const switchTab = useWorkspaceStore((s) => s.switchTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const newTab = useWorkspaceStore((s) => s.newTab);

  return (
    <div className="tab-strip">
      <div className="tab-strip-tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const state: SocketState = connectionStates[tab.id] ?? "disconnected";

          return (
            <button key={tab.id} className={`tab-item${isActive ? " active" : ""}`} onClick={() => switchTab(tab.id)}>
              <span className="tab-state-dot" style={{ backgroundColor: STATE_DOT_COLOR[state] }} />
              <span className="tab-title">{tab.title}</span>
              <span
                className="tab-close"
                role="button"
                title="Detach tab (session stays alive)"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                &times;
              </span>
            </button>
          );
        })}
      </div>
      <button className="tab-new" onClick={newTab} title="New terminal tab">
        +
      </button>
    </div>
  );
}
