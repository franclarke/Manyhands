/**
 * B-006 — runtime enforcement of the local API boundary (CF-08).
 *
 * Every request crosses this middleware before any route handler:
 * Host/Origin validation plus the session capability for mutations, SSE,
 * terminal and filesystem routes. The session token lives for the server's
 * lifetime: `MANYHANDS_SESSION_TOKEN` when the launcher provides it (so
 * scripts can authenticate with the `x-manyhands-session` header), otherwise
 * a random per-boot token distributed to the local UI as a SameSite=Strict
 * cookie on page loads.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_HEADER_NAME,
  evaluateRequestBoundary,
  extraAllowedHostsFromEnv
} from "@/lib/server/security/boundary";

// Module scope: stable for this middleware runtime instance's lifetime.
const bootToken = crypto.randomUUID();

function expectedToken(): string {
  const fromEnv = process.env.MANYHANDS_SESSION_TOKEN;
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : bootToken;
}

export function middleware(request: NextRequest): NextResponse {
  const token = expectedToken();
  const presented =
    request.headers.get(SESSION_HEADER_NAME) ?? request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  const decision = evaluateRequestBoundary({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    contentType: request.headers.get("content-type"),
    presentedToken: presented,
    expectedToken: token,
    extraAllowedHosts: extraAllowedHostsFromEnv()
  });

  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status });
  }

  const response = NextResponse.next();
  if (decision.issueSessionCookie && presented !== token) {
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: false, // The local UI reads it for SSE/EventSource fallbacks.
      sameSite: "strict",
      path: "/"
    });
  }
  return response;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
