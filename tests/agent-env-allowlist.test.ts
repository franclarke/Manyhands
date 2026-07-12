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

  it("keeps declared provider credentials for agents but not for terminals", () => {
    const base = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "declared-key",
      [CANARY]: "leaked-if-visible",
      AWS_SECRET_ACCESS_KEY: "cloud-secret"
    } as NodeJS.ProcessEnv;
    const agentEnv = buildAgentEnvironment({ base });
    expect(agentEnv.ANTHROPIC_API_KEY).toBe("declared-key");
    expect(agentEnv[CANARY]).toBeUndefined();
    expect(agentEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();

    const terminalEnv = buildAgentEnvironment({ base, includeProviderCredentials: false });
    expect(terminalEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(terminalEnv[CANARY]).toBeUndefined();
    expect(terminalEnv.PATH).toBe("/usr/bin");
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
