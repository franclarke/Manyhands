/**
 * B-006 — environment allowlist for agent and terminal subprocesses (CF-28).
 *
 * Server processes accumulate secrets (session tokens, cloud credentials,
 * unrelated dev variables). Agent CLIs and terminal shells must only see:
 *
 *  - the system/toolchain variables they need to run at all (PATH, temp,
 *    Windows shims, HOME/APPDATA where CLI auth stores live, locale);
 *  - the DECLARED provider credentials the product's agents use
 *    (Anthropic/OpenAI keys) — omitted for human terminal shells;
 *  - whatever the operator explicitly allows via
 *    `MANYHANDS_AGENT_ENV_ALLOW` (comma-separated variable names).
 *
 * Everything else — including every `MANYHANDS_*` internal variable — is
 * dropped. This is secret REDUCTION, not a sandbox: the agent still has
 * shell, filesystem and network access as the local user (see the threat
 * model in docs/system/security-boundary.md).
 */

/** Variables any CLI/toolchain needs to function, matched case-insensitively. */
const SYSTEM_ALLOWLIST = new Set(
  [
    // Binary resolution + shells
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "SHELL",
    "TERM",
    "WINDIR",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PROGRAMDATA",
    "ALLUSERSPROFILE",
    // Temp dirs
    "TEMP",
    "TMP",
    "TMPDIR",
    // Home / per-user stores (CLI auth state lives here: ~/.claude, ~/.codex)
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    // Identity/locale/timezone
    "USER",
    "USERNAME",
    "LOGNAME",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    // Node toolchain (validation commands run node/npm/pnpm)
    "NODE",
    "NODE_ENV",
    "NODE_PATH",
    "NODE_OPTIONS",
    "COREPACK_HOME",
    "NPM_CONFIG_CACHE",
    "PNPM_HOME"
  ].map((name) => name.toUpperCase())
);

/** Credentials the product's agent executors are declared to use. */
const PROVIDER_CREDENTIAL_ALLOWLIST = new Set(
  ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"].map((name) =>
    name.toUpperCase()
  )
);

export interface BuildAgentEnvironmentOptions {
  /** Source environment. Defaults to `process.env`. */
  base?: NodeJS.ProcessEnv;
  /**
   * Include the declared provider credentials (agents need them; human
   * terminal shells do not). Defaults to true.
   */
  includeProviderCredentials?: boolean;
  /** Additional variable names to allow (exact names, case-insensitive). */
  extraAllow?: readonly string[];
}

/** Operator escape hatch: extra variable names, comma-separated. */
export function agentEnvAllowFromEnv(base: NodeJS.ProcessEnv = process.env): string[] {
  const raw = base.MANYHANDS_AGENT_ENV_ALLOW;
  if (raw === undefined || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function buildAgentEnvironment(options: BuildAgentEnvironmentOptions = {}): Record<string, string> {
  const base = options.base ?? process.env;
  const includeProviderCredentials = options.includeProviderCredentials ?? true;
  const extraAllow = new Set(
    [...(options.extraAllow ?? []), ...agentEnvAllowFromEnv(base)].map((name) => name.toUpperCase())
  );

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    const allowed =
      SYSTEM_ALLOWLIST.has(upper) ||
      (includeProviderCredentials && PROVIDER_CREDENTIAL_ALLOWLIST.has(upper)) ||
      extraAllow.has(upper);
    if (allowed) {
      result[key] = value;
    }
  }
  return result;
}
