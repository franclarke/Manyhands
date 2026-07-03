import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectWorkspaceCommands,
  hasDetectedCommands
} from "@/lib/server/providers/command-detection";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-cmd-detect-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("detectWorkspaceCommands", () => {
  it("derives commands from scripts and prefixes the detected package manager", async () => {
    await writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", build: "tsup", typecheck: "tsc --noEmit" } })
    );

    const commands = await detectWorkspaceCommands(tempDir);

    expect(commands.packageManager).toBe("pnpm");
    expect(commands.test).toBe("pnpm run test");
    expect(commands.build).toBe("pnpm run build");
    expect(commands.typecheck).toBe("pnpm run typecheck");
    expect(commands.lint).toBeUndefined();
    expect(hasDetectedCommands(commands)).toBe(true);
  });

  it("honors the packageManager field over lockfile inference", async () => {
    await writeFile(path.join(tempDir, "package-lock.json"), "{}");
    await writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.1.0", scripts: { test: "jest" } })
    );

    const commands = await detectWorkspaceCommands(tempDir);

    expect(commands.packageManager).toBe("yarn");
    expect(commands.test).toBe("yarn run test");
  });

  it("returns unknown with no commands when there is no package.json", async () => {
    const commands = await detectWorkspaceCommands(tempDir);
    expect(commands.packageManager).toBe("unknown");
    expect(hasDetectedCommands(commands)).toBe(false);
  });
});
