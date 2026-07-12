/**
 * B-006 — local API boundary (CF-08).
 *
 * ManyHands is local-first: the admin surface (runs, shell, filesystem) must
 * be reachable only by the local operator. Three complementary checks, all
 * pure so the Next middleware stays a thin wrapper:
 *
 *  1. Host allowlist (loopback by default) — defeats DNS rebinding: a hostile
 *     page resolving its own domain to 127.0.0.1 still sends its domain in
 *     the Host header.
 *  2. Origin allowlist — defeats browser CSRF: cross-site requests carry the
 *     attacker's Origin (or the opaque "null"), which is rejected.
 *  3. Session capability — mutations, SSE, terminal and filesystem routes
 *     additionally require the per-boot session token (SameSite=Strict
 *     cookie issued to the local UI, or an explicit header for scripts).
 *
 * This is NOT a sandbox and does not defend against a local same-user
 * attacker — see docs/system/security-boundary.md for the threat model.
 */

export const SESSION_COOKIE_NAME = "mh_session";
export const SESSION_HEADER_NAME = "x-manyhands-session";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface BoundaryRequestInput {
  method: string;
  pathname: string;
  /** Raw Host header (may include port); null when absent. */
  host: string | null;
  /** Raw Origin header; null when absent. */
  origin: string | null;
  /** Token presented via cookie or header; null when absent. */
  presentedToken: string | null;
  expectedToken: string;
  /** Operator-declared extra hostnames (e.g. a LAN alias), without port. */
  extraAllowedHosts?: readonly string[];
}

export type BoundaryDecision =
  | { allowed: true; issueSessionCookie: boolean }
  | { allowed: false; status: 401 | 403; reason: string };

function hostnameOf(hostHeader: string): string {
  // "[::1]:3000" | "127.0.0.1:3000" | "localhost" → hostname without port.
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function isAllowedHost(hostHeader: string | null, extraAllowedHosts: readonly string[] = []): boolean {
  if (hostHeader === null || hostHeader.trim().length === 0) return false;
  const hostname = hostnameOf(hostHeader);
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  return extraAllowedHosts.some((allowed) => allowed.trim().toLowerCase() === hostname);
}

export function isAllowedOrigin(origin: string | null, extraAllowedHosts: readonly string[] = []): boolean {
  if (origin === null) return true; // CLI/scripts and same-origin non-CORS requests.
  if (origin === "null") return false; // Opaque origins (file://, sandboxed iframes).
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  const bracketless = hostname.startsWith("[") ? hostname : hostname;
  if (LOOPBACK_HOSTNAMES.has(bracketless) || LOOPBACK_HOSTNAMES.has(`[${bracketless}]`)) return true;
  return extraAllowedHosts.some((allowed) => allowed.trim().toLowerCase() === hostname);
}

/**
 * Which requests need the session capability: every non-read API request,
 * plus the read endpoints that expose live streams, shell or filesystem.
 */
export function requiresSessionCapability(method: string, pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS") return true;
  return (
    /^\/api\/runs\/[^/]+\/(run-)?events(\/|$)/.test(pathname) ||
    /^\/api\/runs\/[^/]+\/terminals(\/|$)/.test(pathname) ||
    /^\/api\/runs\/[^/]+\/workspace-(file|tree)(\/|$)/.test(pathname) ||
    /^\/api\/runs\/[^/]+\/export(\/|$)/.test(pathname)
  );
}

export function evaluateRequestBoundary(input: BoundaryRequestInput): BoundaryDecision {
  const extra = input.extraAllowedHosts ?? [];
  if (!isAllowedHost(input.host, extra)) {
    return {
      allowed: false,
      status: 403,
      reason: `Host "${input.host ?? "(missing)"}" is not allowed on this local-only server.`
    };
  }
  if (!isAllowedOrigin(input.origin, extra)) {
    return {
      allowed: false,
      status: 403,
      reason: `Origin "${input.origin ?? ""}" is not allowed on this local-only server.`
    };
  }
  if (requiresSessionCapability(input.method, input.pathname)) {
    if (input.presentedToken === null || input.presentedToken !== input.expectedToken) {
      return {
        allowed: false,
        status: 401,
        reason:
          "Missing or invalid session token. Reload the ManyHands UI, or send the " +
          `"${SESSION_HEADER_NAME}" header (see MANYHANDS_SESSION_TOKEN).`
      };
    }
  }
  // Page loads (non-API) carry the cookie to the local UI.
  return { allowed: true, issueSessionCookie: !input.pathname.startsWith("/api/") };
}

/** Operator-declared extra hostnames, comma-separated (no ports). */
export function extraAllowedHostsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.MANYHANDS_ALLOWED_HOSTS;
  if (raw === undefined || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}
