import { describe, expect, it } from "vitest";
import { evaluateClaudeCredential } from "@/lib/server/providers/credentials";

// Fixed "now": 2026-06-25T14:00:00Z (epoch ms).
const NOW = Date.UTC(2026, 5, 25, 14, 0, 0);

function credsFile(expiresAt: number): string {
  return JSON.stringify({
    claudeAiOauth: { accessToken: "redacted", refreshToken: "redacted", expiresAt, scopes: ["user:inference"] }
  });
}

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

  it("reports `expired` when the on-disk OAuth token is past its expiry (the real F-001 cause)", () => {
    expect(
      evaluateClaudeCredential({ apiKeyPresent: false, credentialsFileContent: credsFile(NOW - 60_000), now: NOW })
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
