export interface TabRecord {
  /** Stable UI-side identifier for this tab. */
  id: string;
  /** Stable backend session ID that this tab connects to. */
  sessionId: string;
  /** Human-readable tab title (e.g., "Terminal 1"). */
  title: string;
  /** ISO timestamp when this tab was created. */
  createdAt: string;
}
