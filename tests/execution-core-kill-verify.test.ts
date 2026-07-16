/**
 * INV-2 — verified subprocess kill.
 *
 * Real processes, no fakes: spawn long-lived node children (mirroring how the
 * CLI executors run, shell on win32 / detached group on POSIX) and assert that
 * the registry-driven kill leaves them VERIFIED dead, not merely signalled.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countLiveProcesses,
  isProcessAlive,
  killOwnedProcessTrees,
  killProcessTreeVerified,
  registerLiveProcess,
  spawnExecutorProcess,
  unregisterLiveProcess
} from "@manyhands/execution-core";

const NODE = process.execPath;
/** A child that ignores polite signals where it can and never exits on its own. */
const HANG_FOREVER = "setInterval(() => {}, 1000);";

function spawnHanging(): ReturnType<typeof spawn> {
  return spawn(NODE, ["-e", HANG_FOREVER], { stdio: "ignore", detached: process.platform !== "win32" });
}

async function waitForPid(child: ReturnType<typeof spawn>): Promise<number> {
  if (typeof child.pid === "number") return child.pid;
  await new Promise((resolve) => child.once("spawn", resolve));
  return Number(child.pid);
}

describe("killProcessTreeVerified", () => {
  it("kills a live process and verifies it is gone", async () => {
    const child = spawnHanging();
    const pid = await waitForPid(child);
    expect(isProcessAlive(pid)).toBe(true);

    const verification = await killProcessTreeVerified(child, spawn);
    expect(verification.outcome).toBe("dead");
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("reports dead immediately for an already-exited process", async () => {
    const child = spawn(NODE, ["-e", "process.exit(0);"], { stdio: "ignore" });
    await new Promise((resolve) => child.once("close", resolve));
    const verification = await killProcessTreeVerified(child, spawn);
    expect(verification.outcome).toBe("dead");
    expect(verification.waitedMs).toBe(0);
  });
});

describe("live process registry", () => {
  it("kills every process registered for an owner and verifies the kill", async () => {
    const ownerId = `run-kill-${Date.now()}`;
    const children = [spawnHanging(), spawnHanging()];
    const pids = await Promise.all(children.map(waitForPid));
    for (const child of children) registerLiveProcess(ownerId, child);
    expect(countLiveProcesses(ownerId)).toBe(2);

    const report = await killOwnedProcessTrees(ownerId);
    expect(report.allDead).toBe(true);
    expect(report.verifications).toHaveLength(2);
    for (const pid of pids) expect(isProcessAlive(pid)).toBe(false);

    for (const child of children) unregisterLiveProcess(ownerId, child);
    expect(countLiveProcesses(ownerId)).toBe(0);
  });

  it("returns an empty all-dead report for an owner with nothing registered", async () => {
    const report = await killOwnedProcessTrees("run-without-processes");
    expect(report.allDead).toBe(true);
    expect(report.verifications).toHaveLength(0);
  });

  it("spawnExecutorProcess registers under processOwnerId and unregisters on close", async () => {
    const ownerId = `run-spawn-${Date.now()}`;
    const outcomePromise = spawnExecutorProcess({
      binaryPath: NODE,
      args: ["-e", "process.stdin.resume(); setTimeout(() => process.exit(0), 60_000);"],
      cwd: process.cwd(),
      useShell: false,
      timeoutMs: 60_000,
      processOwnerId: ownerId,
      spawnFn: spawn,
      readInstructions: async () => "noop",
      instructionFilePath: "unused"
    });

    // The child registers synchronously at spawn; give the event loop one turn.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(countLiveProcesses(ownerId)).toBe(1);

    const report = await killOwnedProcessTrees(ownerId);
    expect(report.allDead).toBe(true);

    const outcome = await outcomePromise;
    // Killed from outside the driver: surfaces as a non-zero/timed-out-free exit.
    expect(outcome.timedOut).toBe(false);
    // 'close' fired → the registry no longer tracks the child.
    expect(countLiveProcesses(ownerId)).toBe(0);
  });

  it("does not resolve a timeout while a descendant can still write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mh-timeout-tree-"));
    const started = join(directory, "descendant-started.txt");
    const lateWrite = join(directory, "late-write.txt");
    const descendant = [
      `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(lateWrite)}, "stale"), 800);`,
      "setInterval(() => {}, 1000);"
    ].join("");
    const parent = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });`,
      `require("node:fs").writeFileSync(${JSON.stringify(started)}, "started");`,
      "setInterval(() => {}, 1000);"
    ].join("");

    try {
      const outcome = await spawnExecutorProcess({
        binaryPath: NODE,
        args: ["-e", parent],
        cwd: directory,
        useShell: false,
        timeoutMs: 250,
        spawnFn: spawn,
        readInstructions: async () => "noop",
        instructionFilePath: "unused"
      });

      expect(outcome.timedOut).toBe(true);
      expect(existsSync(started)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(existsSync(lateWrite)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "POSIX: kills the whole detached process group, not just the direct child",
    async () => {
      // Parent spawns a grandchild and prints its PID, then hangs.
      const script = `
        const { spawn } = require("node:child_process");
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
        console.log("GRANDCHILD:" + grandchild.pid);
        setInterval(() => {}, 1000);
      `;
      const child = spawn(NODE, ["-e", script], {
        stdio: ["ignore", "pipe", "ignore"],
        detached: true
      });
      const grandchildPid = await new Promise<number>((resolve) => {
        let buffer = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const match = buffer.match(/GRANDCHILD:(\d+)/);
          if (match) resolve(Number(match[1]));
        });
      });
      expect(isProcessAlive(grandchildPid)).toBe(true);

      const verification = await killProcessTreeVerified(child, spawn);
      expect(verification.outcome).toBe("dead");
      // Group kill must have reached the grandchild too.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(isProcessAlive(grandchildPid)).toBe(false);
    }
  );
});
