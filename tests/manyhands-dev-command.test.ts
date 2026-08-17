import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const commandUrl = pathToFileURL(path.resolve("scripts/manyhands-dev-command.mjs")).href;

async function loadResolver(): Promise<{
  resolveDefaultDevSpawn: (
    args: string[],
    options: {
      platform: NodeJS.Platform;
      pathValue: string;
      comspec?: string;
      fileExists: (candidate: string) => boolean;
    }
  ) => { command: string; args: string[]; windowsVerbatimArguments: boolean };
}> {
  return (await import(commandUrl)) as never;
}

/**
 * The launcher spawned the first `pnpm` it found on PATH, and on a machine with
 * a standalone pnpm 7.29.3 installed under `%LOCALAPPDATA%\pnpm` that is not
 * the version this repo pins. `engines.pnpm` then rejected it before the build
 * ran: `pnpm web:dev` failed inside its own setup step even when the operator
 * had invoked it through corepack, because the child resolution started over.
 *
 * `packageManager` is where the version lives and corepack is what honours it,
 * so the child is spawned through corepack when it is available.
 */
describe("manyhands dev child command", () => {
  it("spawns the pinned pnpm through corepack when corepack is installed", async () => {
    const { resolveDefaultDevSpawn } = await loadResolver();
    const corepack = path.join("C:\Program Files\nodejs", "corepack.cmd");
    const standalone = path.join("C:\Users\me\AppData\Local\pnpm", "pnpm.exe");
    const result = resolveDefaultDevSpawn(["build:packages"], {
      platform: "win32",
      // The standalone pnpm sits earlier, exactly as it does on the machine
      // that produced ERR_PNPM_UNSUPPORTED_ENGINE.
      pathValue: "C:\Users\me\AppData\Local\pnpm;C:\Program Files\nodejs",
      comspec: "cmd.exe",
      fileExists: (candidate) => candidate === corepack || candidate === standalone
    });

    expect(result.command).toBe("cmd.exe");
    expect(result.args.join(" ")).toContain("corepack.cmd");
    expect(result.args.join(" ")).toContain("pnpm");
    expect(result.args.join(" ")).toContain("build:packages");
  });

  it("spawns corepack directly off Windows", async () => {
    const { resolveDefaultDevSpawn } = await loadResolver();
    const result = resolveDefaultDevSpawn(["web:dev:raw"], {
      platform: "linux",
      pathValue: "/usr/local/bin",
      fileExists: (candidate) => candidate === "/usr/local/bin/corepack"
    });

    expect(result).toEqual({
      command: "/usr/local/bin/corepack",
      args: ["pnpm", "web:dev:raw"],
      windowsVerbatimArguments: false
    });
  });

  it("uses pnpm.exe directly on Windows without shell argv forwarding", async () => {
    const { resolveDefaultDevSpawn } = await loadResolver();
    const expected = path.join("C:\\tools", "pnpm.exe");
    const result = resolveDefaultDevSpawn(["web:dev:raw"], {
      platform: "win32",
      pathValue: "C:\\tools;C:\\other",
      fileExists: (candidate) => candidate === expected
    });

    expect(result).toEqual({
      command: expected,
      args: ["web:dev:raw"],
      windowsVerbatimArguments: false
    });
  });

  it("falls back to an explicit cmd.exe invocation for a pnpm.cmd-only install", async () => {
    const { resolveDefaultDevSpawn } = await loadResolver();
    const shim = path.join("C:\\Program Files\\pnpm", "pnpm.cmd");
    const result = resolveDefaultDevSpawn(["web:dev:raw"], {
      platform: "win32",
      pathValue: '"C:\\Program Files\\pnpm"',
      comspec: "C:\\Windows\\System32\\cmd.exe",
      fileExists: (candidate) => candidate === shim
    });

    expect(result.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(result.args).toEqual([
      "/d",
      "/s",
      "/c",
      `""${shim}" "web:dev:raw""`
    ]);
    expect(result.windowsVerbatimArguments).toBe(true);
  });
});
