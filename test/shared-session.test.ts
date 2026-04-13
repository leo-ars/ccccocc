// @vitest-environment jsdom

/**
 * Unit tests for shared-session detection via BroadcastChannel.
 *
 * Covers:
 *  - detection when another tab announces the same session
 *  - clearing when peer leaves
 *  - query/response protocol
 *  - stale peer eviction
 *  - session change (leave old, announce new)
 *  - self-filtering
 *  - graceful degradation when BroadcastChannel is unavailable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock BroadcastChannel
// ---------------------------------------------------------------------------

type BCListener = (event: { data: unknown }) => void;

class MockBroadcastChannel {
  onmessage: BCListener | null = null;
  posted: unknown[] = [];
  closed = false;

  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    this.posted.push(data);
  }

  close() {
    this.closed = true;
  }

  // Test helper: simulate receiving a message from another tab
  receive(data: unknown) {
    this.onmessage?.({ data });
  }

  static instances: MockBroadcastChannel[] = [];
  static reset() {
    MockBroadcastChannel.instances = [];
  }
}

// ---------------------------------------------------------------------------
// Mock zustand store
// ---------------------------------------------------------------------------

let sharedSessionValue = false;
const mockSetSharedSession = vi.fn((val: boolean) => {
  sharedSessionValue = val;
});

vi.mock("../src/client/workspace/store", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const fakeState = {
      setSharedSession: mockSetSharedSession,
    };
    return selector(fakeState);
  },
}));

// ---------------------------------------------------------------------------
// Mock React hooks (minimal)
// ---------------------------------------------------------------------------

let effectCleanup: (() => void) | undefined;
const stableTabId = "test-tab-id-123";

vi.mock("react", () => ({
  useEffect: (fn: () => (() => void) | void, _deps: unknown[]) => {
    effectCleanup?.();
    const cleanup = fn();
    effectCleanup = cleanup ?? undefined;
  },
  useRef: () => {
    // Always return our stable test tab ID so we can match against it
    return { current: stableTabId };
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useSharedSessionDetection } from "../src/client/terminal/useSharedSessionDetection";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeEach(() => {
  MockBroadcastChannel.reset();
  (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel as unknown;
  sharedSessionValue = false;
  mockSetSharedSession.mockClear();
  effectCleanup = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  effectCleanup?.();
  effectCleanup = undefined;
  (globalThis as Record<string, unknown>).BroadcastChannel = originalBroadcastChannel;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChannel(): MockBroadcastChannel {
  return MockBroadcastChannel.instances[MockBroadcastChannel.instances.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSharedSessionDetection", () => {
  it("returns false when alone (no peers)", () => {
    useSharedSessionDetection("session-1");
    // setSharedSession called with false on init
    expect(sharedSessionValue).toBe(false);
  });

  it("broadcasts announce and query on mount", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    const announces = ch.posted.filter((m: any) => m.type === "announce" && m.sessionId === "session-1");
    const queries = ch.posted.filter((m: any) => m.type === "query" && m.sessionId === "session-1");
    expect(announces.length).toBeGreaterThanOrEqual(1);
    expect(queries.length).toBeGreaterThanOrEqual(1);
  });

  it("sets shared=true when peer announces same session", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    ch.receive({
      type: "announce",
      sessionId: "session-1",
      tabId: "other-tab-1",
    });

    expect(mockSetSharedSession).toHaveBeenCalledWith(true);
  });

  it("sets shared=false after peer sends leave", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    // Peer joins
    ch.receive({
      type: "announce",
      sessionId: "session-1",
      tabId: "other-tab-1",
    });
    expect(mockSetSharedSession).toHaveBeenCalledWith(true);

    mockSetSharedSession.mockClear();

    // Peer leaves
    ch.receive({
      type: "leave",
      sessionId: "session-1",
      tabId: "other-tab-1",
    });
    expect(mockSetSharedSession).toHaveBeenCalledWith(false);
  });

  it("responds to query with announce", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    // Clear initial posts
    ch.posted.length = 0;

    ch.receive({
      type: "query",
      sessionId: "session-1",
      tabId: "other-tab-2",
    });

    // Should have posted an announce in response
    const responseAnnounces = ch.posted.filter(
      (m: any) => m.type === "announce" && m.sessionId === "session-1" && m.tabId === stableTabId,
    );
    expect(responseAnnounces.length).toBe(1);
  });

  it("does not count self", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    // Simulate receiving own announce (same tabId)
    ch.receive({
      type: "announce",
      sessionId: "session-1",
      tabId: stableTabId,
    });

    // Should still be false — self is filtered
    const sharedCalls = mockSetSharedSession.mock.calls.filter((c) => c[0] === true);
    expect(sharedCalls).toHaveLength(0);
  });

  it("evicts stale peers after heartbeat timeout", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    // Peer joins
    ch.receive({
      type: "announce",
      sessionId: "session-1",
      tabId: "stale-peer",
    });
    expect(mockSetSharedSession).toHaveBeenCalledWith(true);

    mockSetSharedSession.mockClear();

    // Advance past stale threshold (15s) + heartbeat (10s)
    vi.advanceTimersByTime(20_000);

    // After heartbeat ran and evicted the stale peer
    expect(mockSetSharedSession).toHaveBeenCalledWith(false);
  });

  it("removes peer that switches to a different session", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    // Peer announces same session
    ch.receive({
      type: "announce",
      sessionId: "session-1",
      tabId: "peer-x",
    });
    expect(mockSetSharedSession).toHaveBeenCalledWith(true);

    mockSetSharedSession.mockClear();

    // Peer now announces a different session
    ch.receive({
      type: "announce",
      sessionId: "session-2",
      tabId: "peer-x",
    });
    // peer-x's sessionId is now session-2, which doesn't match ours
    expect(mockSetSharedSession).toHaveBeenCalledWith(false);
  });

  it("sends leave on cleanup", () => {
    useSharedSessionDetection("session-1");
    const ch = getChannel();

    ch.posted.length = 0;
    effectCleanup?.();
    effectCleanup = undefined;

    const leaves = ch.posted.filter((m: any) => m.type === "leave");
    expect(leaves.length).toBeGreaterThanOrEqual(1);
  });

  it("is graceful when BroadcastChannel is unavailable", () => {
    delete (globalThis as Record<string, unknown>).BroadcastChannel;

    // Should not throw
    expect(() => useSharedSessionDetection("session-1")).not.toThrow();
    // Should set false (default)
    expect(mockSetSharedSession).toHaveBeenCalledWith(false);
  });
});
