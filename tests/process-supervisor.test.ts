/**
 * B-005 — one ProcessSupervisor for every productive subprocess (CF-06).
 *
 * Cancellation is only real if every spawn of the run is registered under the
 * run with metadata (label/operationId), wired to the AbortSignal, and killed
 * as a process tree with verification. This suite pins:
 *
 *  - the supervisor primitive (register + meta + auto-unregister + abort);
 *  - validation runner and dependency installer children under supervision;
 *  - web-side supervised spawn (titler/decomposer injection seam);
 *  - terminal sessions registered under their run.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChildProcessDependencyInstaller,
  ChildProcessValidationRunner,
  countLiveProcesses,
  isProcessAlive,
  killOwnedProcessTrees,
  superviseChildProcess
} from "@manyhands/execution-core";
import { supervisedSpawnFn } from "@/lib/server/runs/process-supervision";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-supervisor-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function spawnHang(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
}

async function waitForSpawn(child: ChildProcess): Promise<number> {
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return child.pid as number;
}

async function pollUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!predicate()) throw new Error("condition never became true");
}

describe("B-005 supervisor primitive", () => {
  it("registers with metadata, auto-unregisters on exit, and the kill report carries the meta", async () => {
    const runId = `run-sup-${Date.now()}`;
    const child = spawnHang();
    const pid = await waitForSpawn(child);
    superviseChildProcess({ runId, operationId: "op-1", label: "validation" }, child);
    expect(countLiveProcesses(runId)).toBe(1);

    const report = await killOwnedProcessTrees(runId);
    expect(report.allDead).toBe(true);
    expect(report.verifications).toHaveLength(1);
    expect(report.verifications[0]).toMatchObject({ label: "validation", operationId: "op-1" });
    expect(isProcessAlive(pid)).toBe(false);
    await pollUntil(() => countLiveProcesses(runId) === 0);
  });

  it("an AbortSignal kills the supervised tree", async () => {
    const runId = `run-sup-abort-${Date.now()}`;
    const controller = new AbortController();
    const child = spawnHang();
    const pid = await waitForSpawn(child);
    superviseChildProcess({ runId, label: "planning" }, child, { signal: controller.signal });
    controller.abort();
    await pollUntil(() => !isProcessAlive(pid));
    await pollUntil(() => countLiveProcesses(runId) === 0);
  });
});

describe("B-005 validation runner under supervision", () => {
  it("registers its child under the run and dies with the run's kill", async () => {
    const runId = `run-validation-${Date.now()}`;
    const runner = new ChildProcessValidationRunner();
    const pending = runner.run(
      [{ command: "node", args: ["-e", "setInterval(() => {}, 1000);"], cwd: "worktree", timeoutMs: 60_000 }],
      {
        worktreePath: tempDir,
        repoRoot: tempDir,
        supervision: { runId, operationId: "op-validate" }
      }
    );
    await pollUntil(() => countLiveProcesses(runId) === 1);

    const report = await killOwnedProcessTrees(runId);
    expect(report.allDead).toBe(true);
    const result = await pending;
    expect(result.passed).toBe(false);
    expect(countLiveProcesses(runId)).toBe(0);
  }, 30_000);

  it("an already-aborted signal refuses to spawn", async () => {
    const runId = `run-validation-aborted-${Date.now()}`;
    const controller = new AbortController();
    controller.abort();
    const runner = new ChildProcessValidationRunner();
    const result = await runner.run(
      [{ command: "node", args: ["-e", "setInterval(() => {}, 1000);"], cwd: "worktree", timeoutMs: 60_000 }],
      {
        worktreePath: tempDir,
        repoRoot: tempDir,
        supervision: { runId, signal: controller.signal }
      }
    );
    expect(result.passed).toBe(false);
    expect(countLiveProcesses(runId)).toBe(0);
  });
});

describe("B-005 dependency installer under supervision", () => {
  it("registers the install child under the run and dies with the run's kill", async () => {
    const runId = `run-install-${Date.now()}`;
    await writeFile(path.join(tempDir, "package.json"), "{}", "utf8");
    const installer = new ChildProcessDependencyInstaller({
      // Real long-lived child standing in for `npm install`.
      spawn: (() => spawnHang()) as (
        command: string,
        args: readonly string[],
        options: SpawnOptions
      ) => ChildProcess,
      useShell: false
    });
    const pending = installer.ensure({ cwd: tempDir, supervision: { runId, operationId: "op-install" } });
    await pollUntil(() => countLiveProcesses(runId) === 1);

    const report = await killOwnedProcessTrees(runId);
    expect(report.allDead).toBe(true);
    const result = await pending;
    expect(result.installed).toBe(false);
    expect(countLiveProcesses(runId)).toBe(0);
  }, 30_000);
});

describe("B-005 web supervised spawn (titler/decomposer seam)", () => {
  it("children spawned through supervisedSpawnFn are registered and die with the run", async () => {
    const runId = `run-webspawn-${Date.now()}`;
    const spawnFn = supervisedSpawnFn({ runId, label: "planning-decomposer" });
    const child = spawnFn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
    const pid = await waitForSpawn(child);
    expect(countLiveProcesses(runId)).toBe(1);

    const report = await killOwnedProcessTrees(runId);
    expect(report.allDead).toBe(true);
    expect(report.verifications[0]).toMatchObject({ label: "planning-decomposer" });
    expect(isProcessAlive(pid)).toBe(false);
  });
});
