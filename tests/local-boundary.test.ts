/**
 * B-006 — local API boundary (CF-08).
 *
 * The admin surface (runs, shell, filesystem) must be reachable only by the
 * local operator: loopback Host (blocks DNS rebinding), loopback Origin
 * (blocks browser CSRF) and a session capability for mutations, SSE, terminal
 * and filesystem routes. Pure evaluator — the Next middleware is a thin
 * wrapper around this.
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_HEADER_NAME,
  evaluateRequestBoundary,
  requiresSessionCapability
} from "@/lib/server/security/boundary";

const TOKEN = "test-session-token";

function evaluate(overrides: Partial<Parameters<typeof evaluateRequestBoundary>[0]>) {
  return evaluateRequestBoundary({
    method: "GET",
    pathname: "/api/runs",
    host: "localhost:3000",
    origin: null,
    presentedToken: null,
    expectedToken: TOKEN,
    ...overrides
  });
}

describe("B-006 boundary: Host validation (DNS rebinding)", () => {
  it("allows loopback hosts with and without port", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost", "127.0.0.1"]) {
      expect(evaluate({ host }).allowed, host).toBe(true);
    }
  });

  it("rejects an external Host header", () => {
    const decision = evaluate({ host: "attacker.example.com:3000" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(403);
  });

  it("rejects a missing Host header", () => {
    expect(evaluate({ host: null }).allowed).toBe(false);
  });

  it("accepts explicitly-allowed extra hosts", () => {
    expect(
      evaluate({ host: "devbox.local:3000", extraAllowedHosts: ["devbox.local"] }).allowed
    ).toBe(true);
  });
});

describe("B-006 boundary: Origin validation (CSRF)", () => {
  it("rejects a hostile Origin on any API request", () => {
    const decision = evaluate({ method: "POST", origin: "https://evil.example.com", presentedToken: TOKEN });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(403);
  });

  it('rejects the opaque "null" Origin', () => {
    expect(evaluate({ origin: "null" }).allowed).toBe(false);
  });

  it("allows loopback origins", () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect(evaluate({ origin, presentedToken: TOKEN, method: "POST" }).allowed, origin).toBe(true);
    }
  });

  it("allows API requests without an Origin (CLI/scripts) when the rest passes", () => {
    expect(evaluate({ origin: null }).allowed).toBe(true);
  });
});

describe("B-006 boundary: session capability", () => {
  it("classifies mutations, SSE, terminal and filesystem routes as capability-gated", () => {
    expect(requiresSessionCapability("POST", "/api/runs")).toBe(true);
    expect(requiresSessionCapability("POST", "/api/runs/r1/cancel")).toBe(true);
    expect(requiresSessionCapability("GET", "/api/runs/r1/events")).toBe(true);
    expect(requiresSessionCapability("GET", "/api/runs/r1/run-events")).toBe(true);
    expect(requiresSessionCapability("GET", "/api/runs/r1/terminals/t1/stream")).toBe(true);
    expect(requiresSessionCapability("POST", "/api/runs/r1/terminals")).toBe(true);
    expect(requiresSessionCapability("GET", "/api/runs/r1/workspace-file")).toBe(true);
    expect(requiresSessionCapability("GET", "/api/runs/r1/workspace-tree")).toBe(true);
    // Plain read-only listings stay open for the local UI shell.
    expect(requiresSessionCapability("GET", "/api/runs")).toBe(false);
    expect(requiresSessionCapability("GET", "/api/health")).toBe(false);
  });

  it("rejects a mutation without the session token", () => {
    const decision = evaluate({ method: "POST", pathname: "/api/runs/r1/cancel" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(401);
  });

  it("rejects SSE and terminal streams without the session token", () => {
    expect(evaluate({ pathname: "/api/runs/r1/events" }).allowed).toBe(false);
    expect(evaluate({ pathname: "/api/runs/r1/terminals/t1/stream" }).allowed).toBe(false);
  });

  it("rejects a wrong token and accepts the right one", () => {
    expect(
      evaluate({ method: "POST", pathname: "/api/runs", presentedToken: "wrong" }).allowed
    ).toBe(false);
    expect(
      evaluate({ method: "POST", pathname: "/api/runs", presentedToken: TOKEN }).allowed
    ).toBe(true);
  });

  it("issues the session cookie on page (non-API) responses", () => {
    const decision = evaluate({ pathname: "/runs/r1" });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.issueSessionCookie).toBe(true);
  });

  it("names a stable cookie and header for clients", () => {
    expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0);
    expect(SESSION_HEADER_NAME.startsWith("x-")).toBe(true);
  });
});
