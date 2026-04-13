import { getSandbox, proxyTerminal } from "@cloudflare/sandbox";
import { authenticateRequest, deriveSandboxId, validateHostAccessPolicy, type AuthResult } from "./auth";

export { Sandbox } from "@cloudflare/sandbox";

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostPolicyError = validateHostAccessPolicy(request, env);
    if (hostPolicyError) {
      return jsonError(hostPolicyError, "ACCESS_REQUIRED", 403);
    }

    // ---- Health check (no auth) ----
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    // ---- Terminal WebSocket upgrade ----
    if (url.pathname === "/ws/terminal") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return jsonError("Expected WebSocket upgrade", "UPGRADE_REQUIRED", 426);
      }
      return handleTerminal(request, env, url);
    }

    // ---- Session management API ----
    if (url.pathname === "/api/sessions") {
      return handleSessionApi(request, env, url);
    }

    // ---- Sandbox destruction ----
    if (url.pathname === "/api/sandbox" && request.method === "DELETE") {
      return handleSandboxDestroy(request, env, url);
    }

    // ---- Workspace backup ----
    if (url.pathname === "/api/workspace/backup" && request.method === "POST") {
      return handleBackup(request, env, url);
    }

    // ---- Workspace restore ----
    if (url.pathname === "/api/workspace/restore" && request.method === "POST") {
      return handleRestore(request, env, url);
    }

    // Static assets and SPA fallback are handled by the platform
    // (not_found_handling: "single-page-application" in wrangler.jsonc).
    return jsonError("Not found", "NOT_FOUND", 404);
  },
};

// ---------------------------------------------------------------------------
// Auth helper — authenticate and derive owned sandbox
// ---------------------------------------------------------------------------

async function authenticateAndResolveSandbox(
  request: Request,
  env: Env,
  url: URL,
): Promise<{ auth: AuthResult; sandboxId: string } | { error: Response }> {
  const auth = await authenticateRequest(request, env);
  if (!auth.authenticated) {
    return { error: jsonError(auth.error || "Unauthorized", "AUTH_REQUIRED", 401) };
  }

  const workspace = url.searchParams.get("workspace") ?? "default";
  const sandboxId = deriveSandboxId(auth.userId, workspace);
  return { auth, sandboxId };
}

// ---------------------------------------------------------------------------
// Terminal WebSocket handler
// ---------------------------------------------------------------------------

async function handleTerminal(request: Request, env: Env, url: URL): Promise<Response> {
  const result = await authenticateAndResolveSandbox(request, env, url);
  if ("error" in result) return result.error;

  const sandbox = getSandbox(env.Sandbox, result.sandboxId);
  const sessionId = url.searchParams.get("session") ?? "";

  // Parse initial dimensions from query params, with safe clamping.
  const cols = clampDimension(url.searchParams.get("cols"), 80, 1, 500);
  const rows = clampDimension(url.searchParams.get("rows"), 24, 1, 200);

  return proxyTerminal(sandbox, sessionId, request, {
    cols,
    rows,
    shell: "/usr/local/bin/ccccocc-shell",
  });
}

// ---------------------------------------------------------------------------
// Session API handler
// ---------------------------------------------------------------------------

async function handleSessionApi(request: Request, env: Env, url: URL): Promise<Response> {
  const result = await authenticateAndResolveSandbox(request, env, url);
  if ("error" in result) return result.error;

  const sandbox = getSandbox(env.Sandbox, result.sandboxId);

  // POST — create a new session
  if (request.method === "POST") {
    let body: {
      id?: string;
      cwd?: string;
      env?: Record<string, string>;
      labels?: Record<string, string>;
    };
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", "INVALID_BODY", 400);
    }

    if (!body.id) {
      return jsonError("Missing session id", "MISSING_SESSION_ID", 400);
    }

    // Validate cwd — must be under /workspace to prevent path traversal
    const cwd = body.cwd || "/workspace";
    if (!isAllowedCwd(cwd)) {
      return jsonError("cwd must be under /workspace", "INVALID_CWD", 400);
    }

    await sandbox.createSession({
      id: body.id,
      cwd,
      env: sanitizeEnv(body.env || {}),
    });

    // Labels are client-side metadata — the Sandbox SDK does not persist
    // them, but we echo them back so the caller can track them.
    return Response.json({ id: body.id, cwd, labels: body.labels }, { status: 201 });
  }

  // DELETE — remove a session
  if (request.method === "DELETE") {
    const sessionId = url.searchParams.get("session");
    if (!sessionId) {
      return jsonError("Missing session id", "MISSING_SESSION_ID", 400);
    }
    await sandbox.deleteSession(sessionId);
    return new Response(null, { status: 204 });
  }

  return jsonError("Method not allowed", "METHOD_NOT_ALLOWED", 405);
}

// ---------------------------------------------------------------------------
// Sandbox destruction
// ---------------------------------------------------------------------------

async function handleSandboxDestroy(request: Request, env: Env, url: URL): Promise<Response> {
  const result = await authenticateAndResolveSandbox(request, env, url);
  if ("error" in result) return result.error;

  const sandbox = getSandbox(env.Sandbox, result.sandboxId);
  await sandbox.destroy();
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Workspace backup / restore
// ---------------------------------------------------------------------------

async function handleBackup(request: Request, env: Env, url: URL): Promise<Response> {
  const result = await authenticateAndResolveSandbox(request, env, url);
  if ("error" in result) return result.error;

  const sandbox = getSandbox(env.Sandbox, result.sandboxId);

  let body: { dir?: string; name?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — use defaults
  }

  const backup = await sandbox.createBackup({
    dir: body.dir || "/workspace",
    name: body.name || `backup-${Date.now()}`,
  });

  return Response.json(backup, { status: 201 });
}

async function handleRestore(request: Request, env: Env, url: URL): Promise<Response> {
  const result = await authenticateAndResolveSandbox(request, env, url);
  if ("error" in result) return result.error;

  const sandbox = getSandbox(env.Sandbox, result.sandboxId);

  let body: { id?: string; dir?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", "INVALID_BODY", 400);
  }

  if (!body.id) {
    return jsonError("Missing backup id", "MISSING_BACKUP", 400);
  }

  const res = await sandbox.restoreBackup({
    id: body.id,
    dir: body.dir || "/workspace",
  });
  return Response.json(res);
}

// ---------------------------------------------------------------------------
// Environment variable sanitization
// ---------------------------------------------------------------------------

const ENV_DENY_PATTERNS = [
  /SECRET/i,
  /TOKEN/i,
  /KEY/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /^AUTH/i,
  /^AWS_/i,
  /^AZURE_/i,
  /^GCP_/i,
  /^GOOGLE_/i,
  /^CF_/i,
  /^CLOUDFLARE/i,
  /^SANDBOX_/i,
];

export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (ENV_DENY_PATTERNS.some((p) => p.test(key))) continue;
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// cwd validation
// ---------------------------------------------------------------------------

function isAllowedCwd(cwd: string): boolean {
  // Normalize and check it's under /workspace
  const normalized = cwd.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "/workspace" || normalized.startsWith("/workspace/");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(message: string, code: string, status: number): Response {
  return Response.json({ error: message, code }, { status });
}

function clampDimension(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}
