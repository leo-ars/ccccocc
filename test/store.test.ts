// @vitest-environment jsdom

/**
 * Unit tests for the workspace zustand store.
 *
 * Covers:
 *  - tab CRUD (new, close, switch)
 *  - session replacement (new session, reconnect)
 *  - connection state tracking
 *  - default initialization
 *  - close-tab edge cases (last tab, active tab neighbor selection)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "../src/client/workspace/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
}

function getState() {
  return useWorkspaceStore.getState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
});

describe("WorkspaceStore — initialization", () => {
  it("starts with one default tab", () => {
    const { tabs, activeTabId, nextTabNumber } = getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(activeTabId);
    expect(tabs[0].title).toBe("Terminal 1");
    expect(tabs[0].sessionId).toMatch(/^s-/);
    expect(tabs[0].id).toMatch(/^t-/);
    expect(nextTabNumber).toBe(2);
  });

  it("starts with empty ephemeral state", () => {
    const { reconnectKeys, connectionStates, isSharedSession } = getState();
    expect(reconnectKeys).toEqual({});
    expect(connectionStates).toEqual({});
    expect(isSharedSession).toBe(false);
  });
});

describe("WorkspaceStore — newTab", () => {
  it("creates a new tab and activates it", () => {
    const originalTab = getState().tabs[0];
    getState().newTab();

    const { tabs, activeTabId, nextTabNumber } = getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toBe(originalTab);
    expect(tabs[1].title).toBe("Terminal 2");
    expect(tabs[1].id).toBe(activeTabId);
    expect(nextTabNumber).toBe(3);
  });

  it("increments tab number monotonically", () => {
    getState().newTab();
    getState().newTab();
    const { tabs, nextTabNumber } = getState();
    expect(tabs).toHaveLength(3);
    expect(tabs[2].title).toBe("Terminal 3");
    expect(nextTabNumber).toBe(4);
  });

  it("assigns unique session IDs", () => {
    getState().newTab();
    const { tabs } = getState();
    expect(tabs[0].sessionId).not.toBe(tabs[1].sessionId);
  });
});

describe("WorkspaceStore — closeTab", () => {
  it("removes a tab", () => {
    getState().newTab();
    const { tabs } = getState();
    expect(tabs).toHaveLength(2);

    getState().closeTab(tabs[0].id);
    expect(getState().tabs).toHaveLength(1);
    expect(getState().tabs[0].id).toBe(tabs[1].id);
  });

  it("activates left neighbor when closing active tab", () => {
    getState().newTab();
    getState().newTab();
    // tabs: [T1, T2, T3], active = T3
    const tabs = getState().tabs;
    const t3 = tabs[2];
    const t2 = tabs[1];

    getState().closeTab(t3.id);
    expect(getState().activeTabId).toBe(t2.id);
  });

  it("activates right neighbor when closing first active tab", () => {
    getState().newTab();
    // tabs: [T1, T2], active = T2
    const tabs = getState().tabs;
    const t1 = tabs[0];
    const t2 = tabs[1];

    // Switch to T1, then close it
    getState().switchTab(t1.id);
    getState().closeTab(t1.id);
    expect(getState().activeTabId).toBe(t2.id);
  });

  it("creates a new default tab when closing the last tab", () => {
    const original = getState().tabs[0];
    getState().closeTab(original.id);

    const { tabs, activeTabId } = getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).not.toBe(original.id);
    expect(tabs[0].id).toBe(activeTabId);
  });

  it("cleans up ephemeral state for closed tab", () => {
    getState().newTab();
    const tabs = getState().tabs;
    const tabToClose = tabs[0];

    // Set some ephemeral state
    getState().setConnectionState(tabToClose.id, "connected");
    useWorkspaceStore.setState({
      reconnectKeys: { [tabToClose.id]: 3 },
    });

    getState().closeTab(tabToClose.id);
    expect(getState().connectionStates[tabToClose.id]).toBeUndefined();
    expect(getState().reconnectKeys[tabToClose.id]).toBeUndefined();
  });
});

describe("WorkspaceStore — switchTab", () => {
  it("changes active tab without creating sessions", () => {
    getState().newTab();
    const tabs = getState().tabs;
    const t1 = tabs[0];

    getState().switchTab(t1.id);
    expect(getState().activeTabId).toBe(t1.id);
    // Still only 2 tabs
    expect(getState().tabs).toHaveLength(2);
  });
});

describe("WorkspaceStore — reconnect", () => {
  it("increments reconnect key for active tab", () => {
    const { activeTabId } = getState();
    expect(getState().reconnectKeys[activeTabId]).toBeUndefined();

    getState().reconnect();
    expect(getState().reconnectKeys[activeTabId]).toBe(1);

    getState().reconnect();
    expect(getState().reconnectKeys[activeTabId]).toBe(2);
  });

  it("does not affect other tabs", () => {
    getState().newTab();
    const tabs = getState().tabs;
    const t1 = tabs[0];
    // Active is T2

    getState().reconnect();
    expect(getState().reconnectKeys[t1.id]).toBeUndefined();
  });
});

describe("WorkspaceStore — newSession", () => {
  it("replaces active tab's session ID", () => {
    const oldSessionId = getState().tabs[0].sessionId;
    getState().newSession();

    const { tabs } = getState();
    expect(tabs[0].sessionId).not.toBe(oldSessionId);
    expect(tabs[0].sessionId).toMatch(/^s-/);
  });

  it("increments reconnect key", () => {
    const { activeTabId } = getState();
    getState().newSession();
    expect(getState().reconnectKeys[activeTabId]).toBe(1);
  });

  it("does not create a new tab", () => {
    getState().newSession();
    expect(getState().tabs).toHaveLength(1);
  });
});

describe("WorkspaceStore — setConnectionState", () => {
  it("updates per-tab connection state", () => {
    const { activeTabId } = getState();
    getState().setConnectionState(activeTabId, "connected");
    expect(getState().connectionStates[activeTabId]).toBe("connected");
  });

  it("tracks multiple tabs independently", () => {
    getState().newTab();
    const tabs = getState().tabs;

    getState().setConnectionState(tabs[0].id, "connected");
    getState().setConnectionState(tabs[1].id, "connecting");

    expect(getState().connectionStates[tabs[0].id]).toBe("connected");
    expect(getState().connectionStates[tabs[1].id]).toBe("connecting");
  });
});

describe("WorkspaceStore — setSharedSession", () => {
  it("updates shared session flag", () => {
    expect(getState().isSharedSession).toBe(false);
    getState().setSharedSession(true);
    expect(getState().isSharedSession).toBe(true);
    getState().setSharedSession(false);
    expect(getState().isSharedSession).toBe(false);
  });
});
