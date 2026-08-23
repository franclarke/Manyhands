import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createViajeEnFamiliaAttempt } from "../scripts/experiments/create-viaje-en-familia-attempt.mjs";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: ReturnType<typeof spawn>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(stopServer));
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

  it("serves ESM entry modules as JavaScript when started through npm start", async () => {
    const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "mh-viaje-scaffold-"));
    roots.push(baseDirectory);
    const created = await createViajeEnFamiliaAttempt({ attempt: 8, baseDirectory });
    const publicDirectory = path.join(created.repoDirectory, "public");
    await mkdir(publicDirectory);
    await writeFile(path.join(publicDirectory, "main.mjs"), "export const loaded = true;\n", "utf8");

    const port = await startServer(created.repoDirectory);
    const response = await fetch(`http://127.0.0.1:${port}/main.mjs`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    await expect(response.text()).resolves.toContain("loaded = true");
  });
});

async function startServer(cwd: string): Promise<number> {
  const port = await availablePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  servers.push(server);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("scaffold server did not become ready")), 5_000);
    server.once("error", reject);
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk: string) => {
      if (!chunk.includes(`127.0.0.1:${port}`)) return;
      clearTimeout(timeout);
      resolve(port);
    });
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not allocate a loopback port"));
        return;
      }
      probe.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
  });
}
