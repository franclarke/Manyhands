import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_EXECUTOR_ID, CODEX_EXECUTOR_ID, agentEnvAllowFromEnv, type ExecutorId } from "@manyhands/execution-core";

/**
 * Whether a metered API key would actually reach an executor subprocess.
 *
 * Agent subprocesses no longer inherit `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`:
 * runs bill against the subscription credentials the CLIs keep under HOME, and
 * both CLIs would prefer an explicit key over them. So the preflight has to ask
 * about the credential the executor will receive, not the one the server holds
 * — counting a key the child never sees reports a ready run whose every leaf
 * then 401s, which is the F-001 false-ready this module exists to prevent,
 * arriving from the other direction.
 *
 * The operator's explicit allowlist is the one way a key gets through, and it
 * is therefore the one way it counts.
 */
export function apiKeyReachesExecutor(
  env: NodeJS.ProcessEnv = process.env,
  variable = "ANTHROPIC_API_KEY"
): boolean {
  const value = env[variable];
  if (value === undefined || value.length === 0) return false;
  return agentEnvAllowFromEnv(env).some((name) => name.toUpperCase() === variable.toUpperCase());
}

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
  /**
   * Whether a usable API key will reach the executor (it bypasses the OAuth
   * token). Not merely "is the variable set": see {@link apiKeyReachesExecutor}.
   */
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
    apiKeyPresent: apiKeyReachesExecutor(),
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
    const ok = apiKeyReachesExecutor(process.env, "OPENAI_API_KEY") || existsSync(join(homedir(), ".codex", "auth.json"));
    return ok ? { ok: true } : { ok: false, reason: "absent" };
  }
  return { ok: false, reason: "absent" };
}

/** Actionable message for a failed credential check, distinguishing expiry from absence. */
export function credentialMessageFor(executorId: ExecutorId, reason: CredentialReason): string {
  // La vía recomendada es la suscripción: los runs facturan contra las
  // credenciales que el CLI guarda en HOME. Una API key metered ya no llega
  // sola al subproceso, así que mencionarla sin el allowlist mandaría al
  // operador a configurar algo que el ejecutor nunca vería.
  const apiKeyRoute = (variable: string): string =>
    `, o facturá contra la API declarando ${variable} y MANYHANDS_AGENT_ENV_ALLOW=${variable}`;
  if (executorId === CODEX_EXECUTOR_ID) {
    return `Codex CLI no tiene credenciales. Corré codex una vez para autenticarte${apiKeyRoute("OPENAI_API_KEY")}.`;
  }
  if (reason === "expired") {
    return (
      "Claude Code CLI: el token OAuth en ~/.claude/.credentials.json está vencido; los subprocesos headless " +
      `fallarán con 401 a mitad de run. Reautenticá corriendo \`claude\`${apiKeyRoute("ANTHROPIC_API_KEY")}.`
    );
  }
  return `Claude Code CLI no tiene credenciales. Corré claude una vez para autenticarte${apiKeyRoute("ANTHROPIC_API_KEY")}.`;
}
