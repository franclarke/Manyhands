import { describe, expect, it } from "vitest";
import { apiKeyReachesExecutor, evaluateClaudeCredential } from "@/lib/server/providers/credentials";

// Fixed "now": 2026-06-25T14:00:00Z (epoch ms).
const NOW = Date.UTC(2026, 5, 25, 14, 0, 0);

function credsFile(expiresAt: number, options: { refreshToken?: boolean } = {}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: "redacted",
      ...(options.refreshToken === false ? {} : { refreshToken: "redacted" }),
      expiresAt,
      scopes: ["user:inference"]
    }
  });
}

/**
 * The preflight has to ask about the credential the executor will actually
 * receive, not the one the server happens to hold.
 *
 * Agent subprocesses no longer inherit metered API keys: the runs bill against
 * the subscription credentials the CLIs keep under HOME. So a bare
 * `ANTHROPIC_API_KEY` in the server's environment authorizes nothing downstream,
 * and counting it would report a ready run whose every leaf then 401s — the
 * exact F-001 false-ready this module exists to prevent, reintroduced from the
 * other side.
 */
describe("does an API key reach the executor at all", () => {
  it("does not, when the operator has not allowed it through", () => {
    expect(apiKeyReachesExecutor({ ANTHROPIC_API_KEY: "metered-key" })).toBe(false);
  });

  it("does, when the operator opted in explicitly", () => {
    expect(
      apiKeyReachesExecutor({ ANTHROPIC_API_KEY: "metered-key", MANYHANDS_AGENT_ENV_ALLOW: "ANTHROPIC_API_KEY" })
    ).toBe(true);
  });

  it("is false when there is no key at all", () => {
    expect(apiKeyReachesExecutor({ MANYHANDS_AGENT_ENV_ALLOW: "ANTHROPIC_API_KEY" })).toBe(false);
  });
});

describe("evaluateClaudeCredential (F-001 / F-028: validity, not mere presence)", () => {
  it("is usable when an ANTHROPIC_API_KEY is present, regardless of the token file", () => {
    expect(
      evaluateClaudeCredential({ apiKeyPresent: true, credentialsFileContent: null, now: NOW })
    ).toEqual({ ok: true });
  });

  it("is usable when the on-disk OAuth token has not expired", () => {
    expect(
      evaluateClaudeCredential({ apiKeyPresent: false, credentialsFileContent: credsFile(NOW + 60_000), now: NOW })
    ).toEqual({ ok: true });
  });

  it("is usable (with a refreshable note) when the token expired but a refresh token exists", () => {
    // Empirically (CLI 2.1.x): a headless `claude` call refreshes the access
    // token from the refresh token and PERSISTS it back to the file. Blocking
    // run creation here was a false negative that disabled "Generar plan"
    // every time the last CLI use was more than ~1h ago.
    expect(
      evaluateClaudeCredential({ apiKeyPresent: false, credentialsFileContent: credsFile(NOW - 60_000), now: NOW })
    ).toEqual({ ok: true, note: "refreshable" });
  });

  it("reports `expired` when the token is past its expiry and there is no refresh token (the real F-001 cause)", () => {
    expect(
      evaluateClaudeCredential({
        apiKeyPresent: false,
        credentialsFileContent: credsFile(NOW - 60_000, { refreshToken: false }),
        now: NOW
      })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("reports `absent` when there is no credentials file", () => {
    expect(
      evaluateClaudeCredential({ apiKeyPresent: false, credentialsFileContent: null, now: NOW })
    ).toEqual({ ok: false, reason: "absent" });
  });

  it("reports `absent` when the credentials file is malformed or missing the oauth block", () => {
    expect(
      evaluateClaudeCredential({ apiKeyPresent: false, credentialsFileContent: "{not json", now: NOW })
    ).toEqual({ ok: false, reason: "absent" });
    expect(
      evaluateClaudeCredential({ apiKeyPresent: false, credentialsFileContent: "{}", now: NOW })
    ).toEqual({ ok: false, reason: "absent" });
  });
});
