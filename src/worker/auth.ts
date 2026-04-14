/**
 * Authentication module — Cloudflare Access JWT validation with dev-mode
 * fallback.
 *
 * Two modes (checked in order):
 *  1. CF_ACCESS_AUD + CF_ACCESS_TEAM set → validate Cf-Access-Jwt-Assertion JWT
 *  2. Neither set                        → open dev mode (synthetic identity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthResult {
  authenticated: boolean;
  userId: string;
  email: string;
  error?: string;
}

interface AccessJWTPayload {
  iss: string;
  sub: string;
  aud: string[];
  email: string;
  iat: number;
  exp: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function authenticateRequest(request: Request, env: Env): Promise<AuthResult> {
  // Production: Cloudflare Access JWT
  if (isAccessConfigured(env)) {
    return authenticateAccess(request, env);
  }

  // Local dev: no Access configured — allow all with synthetic identity
  return { authenticated: true, userId: "dev-user", email: "dev@localhost" };
}

/**
 * Derive a deterministic sandbox ID scoped to a user.
 * Prevents cross-user access regardless of query params.
 */
export function deriveSandboxId(userId: string, workspace: string): string {
  return `${userId}-${workspace || "default"}`;
}

export function validateHostAccessPolicy(
  request: Request,
  env: Pick<Env, "CF_ACCESS_AUD" | "CF_ACCESS_TEAM">,
): string | null {
  if (isAccessConfigured(env)) return null;

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (isLocalDevHost(hostname)) return null;
  if (isWorkersDevHost(hostname)) return null;

  return "Cloudflare Access must be configured for non-local hosts";
}

function isAccessConfigured(env: Pick<Env, "CF_ACCESS_AUD" | "CF_ACCESS_TEAM">): boolean {
  return Boolean(env.CF_ACCESS_AUD && env.CF_ACCESS_TEAM);
}

function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isWorkersDevHost(hostname: string): boolean {
  return hostname.endsWith(".workers.dev");
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT
// ---------------------------------------------------------------------------

/** In-memory JWKS cache — lost on isolate eviction, which is fine. */
let jwksCache: { keys: CryptoKey[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function authenticateAccess(request: Request, env: Env): Promise<AuthResult> {
  const fail = (msg: string): AuthResult => ({
    authenticated: false,
    userId: "",
    email: "",
    error: msg,
  });

  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return fail("Missing Cf-Access-Jwt-Assertion header");

  // Decode header + payload (without verification first, to get kid)
  const parts = jwt.split(".");
  if (parts.length !== 3) return fail("Malformed JWT");

  let header: { alg: string; kid?: string };
  let payload: AccessJWTPayload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return fail("Invalid JWT encoding");
  }

  // Check expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return fail("JWT expired");
  }

  // Check audience
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.CF_ACCESS_AUD)) {
    return fail("JWT audience mismatch");
  }

  // Check issuer
  const expectedIssuer = `https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com`;
  if (payload.iss !== expectedIssuer) {
    return fail("JWT issuer mismatch");
  }

  // Verify signature
  const keys = await fetchJWKS(env.CF_ACCESS_TEAM);
  const verified = await verifySignature(parts, header, keys);
  if (!verified) return fail("JWT signature verification failed");

  return {
    authenticated: true,
    userId: payload.sub,
    email: payload.email || "",
  };
}

async function fetchJWKS(team: string): Promise<CryptoKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  const url = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);

  const body: {
    keys: JsonWebKey[];
    public_certs: unknown[];
  } = await res.json();

  const keys = await Promise.all(
    body.keys
      .filter((k) => k.kty === "RSA" && k.use === "sig")
      .map((k) => crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])),
  );

  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function verifySignature(
  parts: string[],
  header: { alg: string; kid?: string },
  keys: CryptoKey[],
): Promise<boolean> {
  if (header.alg !== "RS256") return false;

  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = b64urlToUint8Array(parts[2]);

  // Try each key — Access rotates keys and the JWT may match any
  for (const key of keys) {
    try {
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
      if (ok) return true;
    } catch {
      // wrong key, try next
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

function b64urlToUint8Array(input: string): Uint8Array {
  const raw = b64urlDecode(input);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}
