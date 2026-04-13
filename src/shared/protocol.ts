// Terminal WebSocket protocol types — shared between client and worker.
//
// Wire format:
//   Binary frames  = terminal I/O (ANSI/VT byte stream)
//   Text frames    = JSON control / status messages

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export type ClientControlMessage = ResizeMessage;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface ReadyMessage {
  type: "ready";
}

export interface ExitMessage {
  type: "exit";
  code: number;
  signal?: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerStatusMessage = ReadyMessage | ExitMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Connection state (client-side)
// ---------------------------------------------------------------------------

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "ended" | "error";

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export interface CreateSessionRequest {
  id: string;
  cwd?: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface SessionInfo {
  id: string;
  cwd: string;
}

export interface ApiError {
  error: string;
  code: string;
}
