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

describe("manyhands dev child command", () => {
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
