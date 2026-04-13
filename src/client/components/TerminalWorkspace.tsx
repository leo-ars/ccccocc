import { useWorkspaceStore } from "../workspace/store";
import { useSharedSessionDetection } from "../terminal/useSharedSessionDetection";
import { BootstrapOverlay } from "./BootstrapOverlay";
import { SessionControls } from "./SessionControls";
import { TabStrip } from "./TabStrip";
import { TerminalPane } from "./TerminalPane";

export function TerminalWorkspace({ workspace }: { workspace: string }) {
  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const reconnectKey = useWorkspaceStore((s) => s.reconnectKeys[s.activeTabId] ?? 0);
  const setConnectionState = useWorkspaceStore((s) => s.setConnectionState);
  const connectionState = useWorkspaceStore((s) => s.connectionStates[s.activeTabId] ?? "disconnected");

  useSharedSessionDetection(activeTab?.sessionId ?? "");

  if (!activeTab) return null;

  const showOverlay =
    connectionState === "disconnected" || connectionState === "connecting" || connectionState === "reconnecting";

  return (
    <>
      <SessionControls />
      <TabStrip />
      <div className="terminal-container">
        <TerminalPane
          key={`${activeTab.id}-${reconnectKey}`}
          workspace={workspace}
          sessionId={activeTab.sessionId}
          onStateChange={(state) => setConnectionState(activeTab.id, state)}
        />
        {showOverlay && <BootstrapOverlay reconnecting={connectionState === "reconnecting"} />}
      </div>
    </>
  );
}
