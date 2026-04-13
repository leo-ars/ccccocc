import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TabRecord } from "./types";
import type { SocketState } from "../terminal/socket";

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

export function makeTabId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

type PersistedWorkspaceState = Pick<WorkspaceState, "tabs" | "activeTabId" | "nextTabNumber">;

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  // ---- Persisted (sessionStorage via zustand persist) ----
  tabs: TabRecord[];
  activeTabId: string;
  nextTabNumber: number;

  // ---- Ephemeral (NOT persisted) ----
  reconnectKeys: Record<string, number>;
  connectionStates: Record<string, SocketState>;
  isSharedSession: boolean;

  // ---- Actions ----
  newTab: () => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  reconnect: () => void;
  newSession: () => void;
  resetSession: () => Promise<void>;
  setConnectionState: (tabId: string, state: SocketState) => void;
  setSharedSession: (shared: boolean) => void;
}

// ---------------------------------------------------------------------------
// Default tab factory
// ---------------------------------------------------------------------------

function createTab(number: number): TabRecord {
  return {
    id: makeTabId(),
    sessionId: makeSessionId(),
    title: `Terminal ${number}`,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>()(
  persist<WorkspaceState, [], [], PersistedWorkspaceState>(
    (set, get) => {
      const defaultTab = createTab(1);

      return {
        // ---- persisted ----
        tabs: [defaultTab],
        activeTabId: defaultTab.id,
        nextTabNumber: 2,

        // ---- ephemeral ----
        reconnectKeys: {},
        connectionStates: {},
        isSharedSession: false,

        // ---- actions ----

        newTab() {
          const { nextTabNumber } = get();
          const tab = createTab(nextTabNumber);
          set((s) => ({
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            nextTabNumber: s.nextTabNumber + 1,
          }));
        },

        closeTab(tabId: string) {
          const { tabs, activeTabId } = get();

          // If this is the last tab, replace it with a fresh default
          if (tabs.length === 1) {
            const { nextTabNumber } = get();
            const tab = createTab(nextTabNumber);
            set((s) => ({
              tabs: [tab],
              activeTabId: tab.id,
              nextTabNumber: s.nextTabNumber + 1,
              reconnectKeys: {},
              connectionStates: {},
            }));
            return;
          }

          // Determine new active tab if we're closing the active one
          let newActiveId = activeTabId;
          if (tabId === activeTabId) {
            const idx = tabs.findIndex((t) => t.id === tabId);
            // Prefer the tab to the left, fall back to the right
            const neighbor = tabs[idx - 1] ?? tabs[idx + 1];
            newActiveId = neighbor.id;
          }

          set((s) => {
            const { [tabId]: _rk, ...reconnectKeys } = s.reconnectKeys;
            const { [tabId]: _cs, ...connectionStates } = s.connectionStates;
            return {
              tabs: s.tabs.filter((t) => t.id !== tabId),
              activeTabId: newActiveId,
              reconnectKeys,
              connectionStates,
            };
          });
        },

        switchTab(tabId: string) {
          set({ activeTabId: tabId });
        },

        reconnect() {
          const { activeTabId } = get();
          set((s) => ({
            reconnectKeys: {
              ...s.reconnectKeys,
              [activeTabId]: (s.reconnectKeys[activeTabId] ?? 0) + 1,
            },
          }));
        },

        newSession() {
          const { activeTabId } = get();
          const newSessionId = makeSessionId();
          set((s) => ({
            tabs: s.tabs.map((t) => (t.id === activeTabId ? { ...t, sessionId: newSessionId } : t)),
            reconnectKeys: {
              ...s.reconnectKeys,
              [activeTabId]: (s.reconnectKeys[activeTabId] ?? 0) + 1,
            },
          }));
        },

        async resetSession() {
          const { activeTabId, tabs } = get();
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (!activeTab) return;

          // Delete the backend session
          try {
            const params = new URLSearchParams({
              workspace: "default",
              session: activeTab.sessionId,
            });
            const res = await fetch(`/api/sessions?${params}`, {
              method: "DELETE",
            });
            if (!res.ok && res.status !== 404) {
              throw new Error(`Failed to reset session (${res.status})`);
            }
          } catch (error) {
            console.error("[ccccocc] reset session:", error);
          }

          // Replace with a new session
          const newSessionId = makeSessionId();
          set((s) => ({
            tabs: s.tabs.map((t) => (t.id === activeTabId ? { ...t, sessionId: newSessionId } : t)),
            reconnectKeys: {
              ...s.reconnectKeys,
              [activeTabId]: (s.reconnectKeys[activeTabId] ?? 0) + 1,
            },
          }));
        },

        setConnectionState(tabId: string, state: SocketState) {
          set((s) => ({
            connectionStates: { ...s.connectionStates, [tabId]: state },
          }));
        },

        setSharedSession(shared: boolean) {
          set({ isSharedSession: shared });
        },
      };
    },
    {
      name: "ccccocc:workspace",
      storage: {
        getItem: (name) => {
          const raw = sessionStorage.getItem(name);
          return raw ? JSON.parse(raw) : null;
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
        },
      },
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        nextTabNumber: state.nextTabNumber,
      }),
    },
  ),
);
