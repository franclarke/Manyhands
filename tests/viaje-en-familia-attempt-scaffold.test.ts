import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createViajeEnFamiliaAttempt } from "../scripts/experiments/create-viaje-en-familia-attempt.mjs";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Viaje en Familia attempt scaffold", () => {
  it("creates a runnable, functionally empty folder without initializing Git", async () => {
    const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "mh-viaje-scaffold-"));
    roots.push(baseDirectory);

    const created = await createViajeEnFamiliaAttempt({ attempt: 7, baseDirectory });

    expect(created.workspaceName).toBe("Viaje Familia A007");
    expect(created.attemptDirectory).toBe(path.join(baseDirectory, "attempt-007"));
    expect(created.files).toEqual([
      ".gitignore",
      "README.md",
      "package.json",
      "server.mjs",
      "test/baseline.test.mjs"
    ]);
    await expect(access(path.join(created.repoDirectory, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(path.join(created.repoDirectory, "package.json"), "utf8"))).toMatchObject({
      private: true,
      type: "module",
      scripts: { start: "node server.mjs", test: "node --test" }
    });

    const testRun = await execFileAsync(process.execPath, ["--test"], {
      cwd: created.repoDirectory,
      windowsHide: true
    });
    expect(testRun.stdout).toContain("pass 1");
  });

  it("fails closed instead of reusing an attempt directory", async () => {
    const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "mh-viaje-scaffold-"));
    roots.push(baseDirectory);
    await createViajeEnFamiliaAttempt({ attempt: 1, baseDirectory });

    await expect(createViajeEnFamiliaAttempt({ attempt: 1, baseDirectory })).rejects.toThrow(
      /attempt directory already exists/u
    );
  });
});
