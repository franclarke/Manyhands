import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Stage 3 productive development entrypoint", () => {
  it("starts the daemon before the web process and shuts down both children", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-entrypoint-"));
    roots.push(root);
    const fixture = path.join(root, "child.mjs");
    await writeFile(fixture, `
const role = process.argv[2] ?? "daemon";
const event = role === "daemon" ? "manyhands.daemon.ready" : "fixture.web.ready";
process.stdout.write(JSON.stringify({ event, role, pid: process.pid }) + "\\n");
setInterval(() => {}, 1_000);
`, "utf8");

    const child = spawn(process.execPath, [
      path.resolve("scripts/manyhands-dev.mjs"),
      "--plain",
      "--",
      process.execPath,
      fixture,
      "web"
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: "true",
        MANYHANDS_DEV_DAEMON_ENTRYPOINT: fixture,
        MANYHANDS_DEV_DAEMON_READY_TIMEOUT_MS: "3000"
      }
    });
    children.push(child);

    const observations = await waitForObservations(child, new Set([
      "manyhands.daemon.ready",
      "fixture.web.ready"
    ]));
    expect(observations.map((item) => item.event)).toEqual([
      "manyhands.daemon.ready",
      "fixture.web.ready"
    ]);

    child.kill("SIGTERM");
    await waitForExit(child);
    await waitUntil(() => observations.every((item) => !isAlive(item.pid)));
    expect(observations.every((item) => !isAlive(item.pid))).toBe(true);
  }, 15_000);
});

async function waitForObservations(
  child: ChildProcess,
  expected: ReadonlySet<string>
): Promise<Array<{ event: string; pid: number }>> {
  return new Promise((resolve, reject) => {
    const observations: Array<{ event: string; pid: number }> = [];
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for stack readiness. stdout=${stdout} stderr=${stderr}`));
    }, 5_000);
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split(/\r?\n/u).slice(0, -1)) {
        try {
          const value = JSON.parse(line) as { event?: unknown; pid?: unknown };
          if (
            typeof value.event === "string" &&
            typeof value.pid === "number" &&
            expected.has(value.event) &&
            !observations.some((item) => item.event === value.event)
          ) {
            observations.push({ event: value.event, pid: value.pid });
          }
        } catch {
          // The monitor also emits human-readable status lines.
        }
      }
      stdout = stdout.slice(stdout.lastIndexOf("\n") + 1);
      if (observations.length === expected.size) {
        clearTimeout(timeout);
        resolve(observations);
      }
    });
    child.once("exit", (code) => {
      if (observations.length === expected.size) return;
      clearTimeout(timeout);
      reject(new Error(`Stack exited before readiness (${code}). stdout=${stdout} stderr=${stderr}`));
    });
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Stack did not stop.")), 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Child processes did not reach quiescence.");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
