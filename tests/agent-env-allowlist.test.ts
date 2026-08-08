/**
 * B-006 — env allowlist for agent and terminal processes (CF-28).
 *
 * Executor CLIs and terminal shells must NOT inherit the whole server
 * environment (tokens, cloud credentials, unrelated secrets). Only an
 * explicit allowlist survives: system/toolchain variables, HOME/APPDATA (CLI
 * auth stores), locale — plus declared provider credentials for agents, and
 * anything the operator explicitly allows.
 */
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentEnvironment, spawnExecutorProcess } from "@manyhands/execution-core";

const CANARY = "MH_CANARY_SECRET_B006";

beforeEach(() => {
  process.env[CANARY] = "leaked-if-visible";
});

afterEach(() => {
  delete process.env[CANARY];
});

describe("B-006 buildAgentEnvironment", () => {
  it("drops undeclared secrets and keeps the toolchain basics", () => {
    const env = buildAgentEnvironment();
    expect(env[CANARY]).toBeUndefined();
    // PATH survives under its platform casing.
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
    expect(pathKey).toBeDefined();
  });

  /**
   * Billing is a property of which credential the CLI finds, and both CLIs
   * prefer an explicit API key over the subscription they have stored. So
   * forwarding a metered key is not a neutral convenience: it silently moves a
   * run onto API credits, with nothing in the run record to say so.
   *
   * Francisco's setup runs on subscriptions — `~/.claude/.credentials.json`
   * carries `subscriptionType: pro`, `~/.codex/auth.json` carries
   * `auth_mode: chatgpt`. Those live in HOME, which stays allowed. A metered key
   * appearing in the server's environment for some unrelated reason must not be
   * able to override them.
   */
  it("does not hand agents a metered API key, so the CLI uses its stored subscription", () => {
    const base = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "metered-key",
      OPENAI_API_KEY: "metered-key",
      CODEX_API_KEY: "metered-key",
      [CANARY]: "leaked-if-visible",
      AWS_SECRET_ACCESS_KEY: "cloud-secret"
    } as NodeJS.ProcessEnv;
    const agentEnv = buildAgentEnvironment({ base });

    expect(agentEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(agentEnv.OPENAI_API_KEY).toBeUndefined();
    expect(agentEnv.CODEX_API_KEY).toBeUndefined();
    expect(agentEnv[CANARY]).toBeUndefined();
    expect(agentEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  /**
   * `CLAUDE_CODE_OAUTH_TOKEN` is a long-lived subscription token for headless
   * use, not a metered key. Dropping it would break the very billing mode this
   * is protecting.
   */
  it("keeps a subscription token, which is the billing mode we want", () => {
    const base = { PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: "subscription-token" } as NodeJS.ProcessEnv;

    expect(buildAgentEnvironment({ base }).CLAUDE_CODE_OAUTH_TOKEN).toBe("subscription-token");
    // A terminal shell is not an agent and never needs it.
    expect(buildAgentEnvironment({ base, includeProviderCredentials: false }).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  /**
   * Deliberate API billing stays possible — it just has to be asked for. The
   * operator escape hatch that already existed is the opt-in; no second
   * mechanism is needed.
   */
  it("lets an operator opt back into API billing explicitly", () => {
    const base = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "metered-key" } as NodeJS.ProcessEnv;
    const env = buildAgentEnvironment({ base, extraAllow: ["ANTHROPIC_API_KEY"] });

    expect(env.ANTHROPIC_API_KEY).toBe("metered-key");
  });

  it("keeps the home directory where the subscription credentials live", () => {
    const base = { PATH: "/usr/bin", USERPROFILE: "C:/Users/franc", HOME: "/home/franc" } as NodeJS.ProcessEnv;
    const env = buildAgentEnvironment({ base });

    expect(env.USERPROFILE).toBe("C:/Users/franc");
    expect(env.HOME).toBe("/home/franc");
  });

  it("honors the operator's explicit extra allowlist", () => {
    const base = { PATH: "/usr/bin", MY_CUSTOM_VAR: "yes", [CANARY]: "leak" } as NodeJS.ProcessEnv;
    const env = buildAgentEnvironment({ base, extraAllow: ["MY_CUSTOM_VAR"] });
    expect(env.MY_CUSTOM_VAR).toBe("yes");
    expect(env[CANARY]).toBeUndefined();
  });
});

describe("B-006 executor spawn env (canary)", () => {
  it("the executor child cannot see an undeclared server secret", async () => {
    const outcome = await spawnExecutorProcess({
      binaryPath: process.execPath,
      args: ["-e", `console.log(process.env.${CANARY} ?? "CANARY_ABSENT")`],
      cwd: process.cwd(),
      useShell: false,
      timeoutMs: 30_000,
      spawnFn: spawn,
      readInstructions: async () => "",
      instructionFilePath: "unused"
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("CANARY_ABSENT");
    expect(outcome.stdout).not.toContain("leaked-if-visible");
  }, 30_000);
});
