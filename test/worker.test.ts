/**
 * Integration tests for the Worker terminal route.
 *
 * Covers:
 *  - auth validation (dev mode, Cloudflare Access)
 *  - ownership (sandbox ID derived from user identity)
 *  - terminal upgrade / proxy behavior
 *  - dimension clamping
 *  - session create / delete API
 *  - env variable sanitization
 *  - cwd validation
 *  - sandbox destruction
 *  - backup / restore
 *  - error responses
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTerminalResponse = new Response(null, { status: 200 });

const mockSandbox = {
  createSession: vi.fn().mockResolvedValue({}),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  createBackup: vi.fn().mockResolvedValue({ id: "backup-123" }),
  restoreBackup: vi.fn().mockResolvedValue({ success: true, dir: "/workspace", id: "backup-123" }),
};

const mockGetSandbox = vi.fn(() => mockSandbox);
const mockProxyTerminal = vi.fn().mockResolvedValue(mockTerminalResponse);

vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: (...args: unknown[]) => mockGetSandbox(...args),
  proxyTerminal: (...args: unknown[]) => mockProxyTerminal(...args),
  Sandbox: class MockSandbox {},
}));

// Import after mock
const workerModule = await import("../src/worker/index");
const worker = workerModule.default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dev-mode env: no Access configured, all requests pass with dev-user identity. */
function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    Sandbox: {} as DurableObjectNamespace,
    SANDBOX_TRANSPORT: "websocket",
    CF_ACCESS_AUD: "",
    CF_ACCESS_TEAM: "",
    ...overrides,
  };
}

/** Env with Access configured — requests without a valid JWT will be rejected. */
function makeAccessEnv(overrides: Record<string, unknown> = {}) {
  return makeEnv({
    CF_ACCESS_AUD: "test-aud-tag",
    CF_ACCESS_TEAM: "test-team",
    ...overrides,
  });
}

function makeRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    host?: string;
  } = {},
): Request {
  const host = options.host ?? "localhost";
  return new Request(`https://${host}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.headers ?? {}),
    },
    ...(options.body ? { body: options.body } : {}),
  });
}

function wsRequest(path: string, headers: Record<string, string> = {}, host?: string): Request {
  return makeRequest(path, {
    host,
    headers: { Upgrade: "websocket", ...headers },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Worker — terminal route", () => {
  it("rejects non-WebSocket requests to /ws/terminal", async () => {
    const res = await worker.fetch(makeRequest("/ws/terminal"), makeEnv());
    expect(res.status).toBe(426);
  });

  it("proxies via proxyTerminal for default session", async () => {
    const res = await worker.fetch(wsRequest("/ws/terminal"), makeEnv());
    expect(res.status).toBe(200);
    // Sandbox ID derived from dev-user + default workspace
    expect(mockGetSandbox).toHaveBeenCalledWith(expect.anything(), "dev-user-default");
    expect(mockProxyTerminal).toHaveBeenCalledWith(
      mockSandbox,
      "", // empty string for default session
      expect.any(Request),
      { cols: 80, rows: 24, shell: "/usr/local/bin/ccccocc-shell" },
    );
  });

  it("proxies via proxyTerminal for named session", async () => {
    const res = await worker.fetch(wsRequest("/ws/terminal?session=dev"), makeEnv());
    expect(res.status).toBe(200);
    expect(mockProxyTerminal).toHaveBeenCalledWith(mockSandbox, "dev", expect.any(Request), {
      cols: 80,
      rows: 24,
      shell: "/usr/local/bin/ccccocc-shell",
    });
  });

  it("uses workspace param to derive sandbox ID", async () => {
    await worker.fetch(wsRequest("/ws/terminal?workspace=myproject"), makeEnv());
    expect(mockGetSandbox).toHaveBeenCalledWith(expect.anything(), "dev-user-myproject");
  });

  it("passes cols/rows from query params", async () => {
    await worker.fetch(wsRequest("/ws/terminal?cols=120&rows=40"), makeEnv());
    expect(mockProxyTerminal).toHaveBeenCalledWith(mockSandbox, "", expect.any(Request), {
      cols: 120,
      rows: 40,
      shell: "/usr/local/bin/ccccocc-shell",
    });
  });

  it("clamps extreme dimensions", async () => {
    await worker.fetch(wsRequest("/ws/terminal?cols=9999&rows=-5"), makeEnv());
    expect(mockProxyTerminal).toHaveBeenCalledWith(mockSandbox, "", expect.any(Request), {
      cols: 500,
      rows: 1,
      shell: "/usr/local/bin/ccccocc-shell",
    });
  });

  it("falls back to defaults for non-numeric dimensions", async () => {
    await worker.fetch(wsRequest("/ws/terminal?cols=abc&rows="), makeEnv());
    expect(mockProxyTerminal).toHaveBeenCalledWith(mockSandbox, "", expect.any(Request), {
      cols: 80,
      rows: 24,
      shell: "/usr/local/bin/ccccocc-shell",
    });
  });
});

describe("Worker — auth", () => {
  it("allows requests in dev mode (no Access configured)", async () => {
    const res = await worker.fetch(wsRequest("/ws/terminal"), makeEnv());
    expect(res.status).toBe(200);
  });

  it("rejects requests without JWT when Access is configured", async () => {
    const res = await worker.fetch(wsRequest("/ws/terminal", {}, "ccccocc.example.com"), makeAccessEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("derives sandbox ID from dev-user identity in dev mode", async () => {
    await worker.fetch(wsRequest("/ws/terminal"), makeEnv());
    expect(mockGetSandbox).toHaveBeenCalledWith(expect.anything(), "dev-user-default");
  });

  it("rejects non-local hosts when Access is not configured", async () => {
    const res = await worker.fetch(wsRequest("/ws/terminal", {}, "ccccocc.example.com"), makeEnv());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ACCESS_REQUIRED");
  });

  it("allows non-local hosts when Access is configured", async () => {
    const res = await worker.fetch(makeRequest("/api/health", { host: "ccccocc.example.com" }), makeAccessEnv());
    expect(res.status).toBe(200);
  });
});

describe("Worker — ownership", () => {
  it("scopes sandbox to authenticated user via workspace param", async () => {
    await worker.fetch(wsRequest("/ws/terminal?workspace=project1"), makeEnv());
    expect(mockGetSandbox).toHaveBeenCalledWith(expect.anything(), "dev-user-project1");
  });

  it("ignores raw id param — derives sandbox from user identity", async () => {
    await worker.fetch(wsRequest("/ws/terminal?id=someone-elses-sandbox"), makeEnv());
    expect(mockGetSandbox).toHaveBeenCalledWith(expect.anything(), "dev-user-default");
  });
});

describe("Worker — session API", () => {
  it("creates a session", async () => {
    const res = await worker.fetch(
      makeRequest("/api/sessions?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "dev", cwd: "/workspace/app" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; cwd: string };
    expect(body.id).toBe("dev");
    expect(body.cwd).toBe("/workspace/app");
    expect(mockSandbox.createSession).toHaveBeenCalledWith({
      id: "dev",
      cwd: "/workspace/app",
      env: {},
    });
  });

  it("defaults cwd to /workspace", async () => {
    await worker.fetch(
      makeRequest("/api/sessions?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "sess1" }),
      }),
      makeEnv(),
    );
    expect(mockSandbox.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/workspace" }));
  });

  it("rejects session creation without id", async () => {
    const res = await worker.fetch(
      makeRequest("/api/sessions?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: "/workspace/app" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("rejects cwd outside /workspace", async () => {
    const res = await worker.fetch(
      makeRequest("/api/sessions?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "sess1", cwd: "/etc/passwd" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_CWD");
  });

  it("rejects cwd with path traversal", async () => {
    const res = await worker.fetch(
      makeRequest("/api/sessions?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "s", cwd: "/" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("deletes a session", async () => {
    const res = await worker.fetch(
      makeRequest("/api/sessions?workspace=default&session=dev", {
        method: "DELETE",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
    expect(mockSandbox.deleteSession).toHaveBeenCalledWith("dev");
  });

  it("rejects DELETE without session param", async () => {
    const res = await worker.fetch(makeRequest("/api/sessions?workspace=default", { method: "DELETE" }), makeEnv());
    expect(res.status).toBe(400);
  });

  it("rejects unsupported methods", async () => {
    const res = await worker.fetch(makeRequest("/api/sessions?workspace=default", { method: "PATCH" }), makeEnv());
    expect(res.status).toBe(405);
  });
});

describe("Worker — env sanitization", () => {
  it("strips dangerous env var keys", async () => {
    await worker.fetch(
      makeRequest("/api/sessions?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "s1",
          env: {
            TERM: "xterm-256color",
            AWS_SECRET_ACCESS_KEY: "hunter2",
            CF_API_TOKEN: "tok",
            MY_PASSWORD: "pass",
            NODE_ENV: "development",
            GITHUB_TOKEN: "ghp_xxx",
          },
        }),
      }),
      makeEnv(),
    );

    const call = mockSandbox.createSession.mock.calls[0][0];
    // Safe vars pass through
    expect(call.env.TERM).toBe("xterm-256color");
    expect(call.env.NODE_ENV).toBe("development");
    // Dangerous vars stripped
    expect(call.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(call.env.CF_API_TOKEN).toBeUndefined();
    expect(call.env.MY_PASSWORD).toBeUndefined();
    expect(call.env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe("Worker — sandbox destruction", () => {
  it("destroys sandbox via DELETE /api/sandbox", async () => {
    const res = await worker.fetch(makeRequest("/api/sandbox?workspace=default", { method: "DELETE" }), makeEnv());
    expect(res.status).toBe(204);
    expect(mockSandbox.destroy).toHaveBeenCalled();
  });

  it("requires auth for sandbox destruction when Access is configured", async () => {
    const res = await worker.fetch(
      makeRequest("/api/sandbox?workspace=default", { method: "DELETE" }),
      makeAccessEnv(),
    );
    expect(res.status).toBe(401);
  });
});

describe("Worker — backup / restore", () => {
  it("creates a backup", async () => {
    const res = await worker.fetch(
      makeRequest("/api/workspace/backup?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: "/workspace", name: "my-backup" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(201);
    expect(mockSandbox.createBackup).toHaveBeenCalledWith({
      dir: "/workspace",
      name: "my-backup",
    });
  });

  it("restores a backup", async () => {
    const res = await worker.fetch(
      makeRequest("/api/workspace/restore?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "backup-123", dir: "/workspace" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(mockSandbox.restoreBackup).toHaveBeenCalledWith({
      id: "backup-123",
      dir: "/workspace",
    });
  });

  it("rejects restore without backup id", async () => {
    const res = await worker.fetch(
      makeRequest("/api/workspace/restore?workspace=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});

describe("Worker — routing", () => {
  it("serves health check without auth", async () => {
    const res = await worker.fetch(
      makeRequest("/api/health"),
      makeAccessEnv(), // Access configured, but health needs no auth
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 404 for unknown API routes", async () => {
    const res = await worker.fetch(makeRequest("/api/unknown"), makeEnv());
    expect(res.status).toBe(404);
  });
});
