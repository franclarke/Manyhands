import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_EXECUTOR_ID, CODEX_EXECUTOR_ID, type ExecutorId } from "@manyhands/execution-core";

/**
 * Why a token is unusable for a headless executor subprocess.
 * - `absent`: no API key and no parseable OAuth token on disk.
 * - `expired`: an OAuth token exists but its `expiresAt` is in the past AND
 *   there is no refresh token, so the standalone CLI the executor spawns will
 *   fail with a 401 mid-run (F-001).
 *
 * An expired access token WITH a refresh token is usable: the headless CLI
 * (2.1.x) refreshes it on start and persists the new token back to the file
 * (verified empirically). It carries a `note: "refreshable"` so the readiness
 * panel can surface it as a warning instead of a false hard block.
 */
export type CredentialReason = "absent" | "expired";
export type CredentialStatus =
  | { ok: true; note?: "refreshable" }
  | { ok: false; reason: CredentialReason };

export interface ClaudeCredentialProbe {
  /** Whether ANTHROPIC_API_KEY is set (API-key auth bypasses the OAuth token). */
  apiKeyPresent: boolean;
  /** Raw contents of ~/.claude/.credentials.json, or null if missing/unreadable. */
  credentialsFileContent: string | null;
  /** Current time in epoch ms (injected so the check is deterministic in tests). */
  now: number;
}

/**
 * Pure: does the on-disk Claude OAuth token (or an API key) authorize a headless
 * subprocess *right now*? Presence of the file is not enough — an expired token
 * is the exact F-001 failure, and a credential check that only tests existence
 * (the previous behaviour, F-028) reports a false "ready" while every leaf 401s.
 */
export function evaluateClaudeCredential(probe: ClaudeCredentialProbe): CredentialStatus {
  if (probe.apiKeyPresent) return { ok: true };
  if (probe.credentialsFileContent === null) return { ok: false, reason: "absent" };

  let expiresAt: unknown;
  let refreshToken: unknown;
  try {
    const parsed = JSON.parse(probe.credentialsFileContent) as {
      claudeAiOauth?: { expiresAt?: unknown; refreshToken?: unknown };
    };
    expiresAt = parsed.claudeAiOauth?.expiresAt;
    refreshToken = parsed.claudeAiOauth?.refreshToken;
  } catch {
    return { ok: false, reason: "absent" };
  }

  if (typeof expiresAt !== "number") return { ok: false, reason: "absent" };
  if (expiresAt <= probe.now) {
    // Expired access token + refresh token = usable: the headless CLI (2.1.x)
    // refreshes on start and persists the new token back to the file.
    if (typeof refreshToken === "string" && refreshToken.length > 0) {
      return { ok: true, note: "refreshable" };
    }
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

function readClaudeCredentialProbe(now: number): ClaudeCredentialProbe {
  const file = join(homedir(), ".claude", ".credentials.json");
  let credentialsFileContent: string | null = null;
  try {
    credentialsFileContent = readFileSync(file, "utf8");
  } catch {
    credentialsFileContent = null;
  }
  return {
    apiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    credentialsFileContent,
    now
  };
}

/**
 * Single source of truth for "can this executor authenticate a headless run?".
 * Shared by the readiness endpoint and the blocking execution preflight so the
 * two never disagree (they previously had duplicate presence-only checks).
 */
export function defaultCredentialStatus(executorId: ExecutorId, now: number = Date.now()): CredentialStatus {
  if (executorId === CLAUDE_CODE_EXECUTOR_ID) {
    return evaluateClaudeCredential(readClaudeCredentialProbe(now));
  }
  if (executorId === CODEX_EXECUTOR_ID) {
    // Codex auth stays presence-only: its real failure mode is a usage/quota
    // limit, which cannot be detected without spending a model call.
    const ok = Boolean(process.env.OPENAI_API_KEY) || existsSync(join(homedir(), ".codex", "auth.json"));
    return ok ? { ok: true } : { ok: false, reason: "absent" };
  }
  return { ok: false, reason: "absent" };
}

/** Actionable message for a failed credential check, distinguishing expiry from absence. */
export function credentialMessageFor(executorId: ExecutorId, reason: CredentialReason): string {
  if (executorId === CODEX_EXECUTOR_ID) {
    return "Codex CLI no tiene credenciales. Corré codex una vez para autenticarte, o configurá OPENAI_API_KEY.";
  }
  if (reason === "expired") {
    return (
      "Claude Code CLI: el token OAuth en ~/.claude/.credentials.json está vencido; los subprocesos headless " +
      "fallarán con 401 a mitad de run. Reautenticá corriendo `claude`, o configurá ANTHROPIC_API_KEY."
    );
  }
  return "Claude Code CLI no tiene credenciales. Corré claude una vez para autenticarte, o configurá ANTHROPIC_API_KEY.";
}
