import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../workspace/store";

/**
 * Detects when another browser window/tab is attached to the same session
 * using the BroadcastChannel API. Updates the zustand store's
 * `isSharedSession` flag accordingly.
 *
 * Only detects same-browser, same-origin sharing. Cross-device or
 * cross-browser sharing is not detectable without server-side tracking.
 */

interface PresenceMessage {
  type: "announce" | "query" | "leave";
  sessionId: string;
  tabId: string;
}

interface PeerEntry {
  sessionId: string;
  lastSeen: number;
}

const CHANNEL_NAME = "ccccocc:session-presence";
const HEARTBEAT_MS = 10_000;
const STALE_THRESHOLD_MS = 15_000;

export function useSharedSessionDetection(sessionId: string): void {
  const setSharedSession = useWorkspaceStore((s) => s.setSharedSession);
  const tabIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!sessionId || typeof BroadcastChannel === "undefined") {
      setSharedSession(false);
      return;
    }

    const tabId = tabIdRef.current;
    const peers = new Map<string, PeerEntry>();
    const channel = new BroadcastChannel(CHANNEL_NAME);

    function recalculate() {
      let shared = false;
      for (const peer of peers.values()) {
        if (peer.sessionId === sessionId) {
          shared = true;
          break;
        }
      }
      setSharedSession(shared);
    }

    function post(msg: PresenceMessage) {
      try {
        channel.postMessage(msg);
      } catch {
        // Channel may be closed during cleanup race
      }
    }

    channel.onmessage = (event: MessageEvent) => {
      const msg = event.data as PresenceMessage;
      if (!msg || msg.tabId === tabId) return;

      switch (msg.type) {
        case "announce":
          peers.set(msg.tabId, {
            sessionId: msg.sessionId,
            lastSeen: Date.now(),
          });
          recalculate();
          break;

        case "query":
          peers.set(msg.tabId, {
            sessionId: msg.sessionId,
            lastSeen: Date.now(),
          });
          // Respond so the querying tab discovers us
          post({ type: "announce", sessionId, tabId });
          recalculate();
          break;

        case "leave":
          peers.delete(msg.tabId);
          recalculate();
          break;
      }
    };

    // Announce ourselves and query for existing peers
    post({ type: "announce", sessionId, tabId });
    post({ type: "query", sessionId, tabId });

    // Heartbeat: re-announce and evict stale peers
    const heartbeat = setInterval(() => {
      post({ type: "announce", sessionId, tabId });

      const now = Date.now();
      for (const [id, peer] of peers) {
        if (now - peer.lastSeen > STALE_THRESHOLD_MS) {
          peers.delete(id);
        }
      }
      recalculate();
    }, HEARTBEAT_MS);

    // Announce departure on tab close
    const onUnload = () => {
      post({ type: "leave", sessionId, tabId });
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", onUnload);
      post({ type: "leave", sessionId, tabId });
      channel.close();
      peers.clear();
      setSharedSession(false);
    };
  }, [sessionId, setSharedSession]);
}
