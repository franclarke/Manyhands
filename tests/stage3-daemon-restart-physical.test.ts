import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DigestHasher } from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  type ProductRunCommand,
  type ProductRunDefinition,
  type RunCommandPayload,
  type RunProjection
} from "@manyhands/run-coordinator";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
let root: string;
let helperPath: string;
let cliPath: string;
let workerPath: string;
let bundleRoot: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-daemon-restart-"));
  helperPath = process.env.MANYHANDS_WINDOWS_JOB_RUNNER
    ?? path.join(root, "manyhands-windows-job-runner.exe");
  if (process.platform === "win32" && process.env.MANYHANDS_WINDOWS_JOB_RUNNER === undefined) {
    await execFileAsync("rustc.exe", [
      "--edition=2021",
      path.resolve("native/windows-job-runner/src/main.rs"),
      "-O",
      "-o",
      helperPath
    ], { windowsHide: true });
  }
  if (process.platform === "win32") await access(helperPath);
  bundleRoot = path.join(process.cwd(), ".scratch", `stage3-restart-bundle-${randomUUID()}`);
  await execFileAsync(process.execPath, [
    path.resolve("node_modules/tsup/dist/cli-default.js"),
    path.resolve("apps/daemon/src/cli.ts"),
    "--format", "cjs",
    "--out-dir", bundleRoot,
    "--clean"
  ], { cwd: process.cwd(), windowsHide: true });
  await execFileAsync(process.execPath, [
    path.resolve("node_modules/tsup/dist/cli-default.js"),
    path.resolve("apps/daemon/src/deterministic-fake-worker.ts"),
    "--format", "esm",
    "--out-dir", bundleRoot
  ], { cwd: process.cwd(), windowsHide: true });
  cliPath = path.join(bundleRoot, "cli.cjs");
  workerPath = path.join(bundleRoot, "deterministic-fake-worker.js");
  await access(cliPath);
  await access(workerPath);
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(bundleRoot, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("Stage 3 daemon restart recovery", () => {
  it("recovers a running fake execution from journal/intents/receipts without duplicate work", async () => {
    const stateRoot = path.join(root, "state");
    const endpoint = `\\\\.\\pipe\\mh-stage3-restart-${randomUUID()}`;
    const pidEvidencePath = path.join(root, "restart-tree.json");
    const runId = "run:stage3:daemon-restart";

    let daemon = await startDaemon({ stateRoot, endpoint, pidEvidencePath });
    let client = createLocalIpcClient({
      endpoint,
      capabilityFilePath: path.join(stateRoot, "installation", "ipc-capability"),
      production: false
    });
    try {
      await client.submit(command("command:create:restart", runId, 0, {
        type: "create_run",
        definition: definition()
      }));
      let projection = await waitForProjection(client, runId, (item) => item.lifecycle === "needs_approval");
      const decisionId = Object.values(projection.decisions).find((item) =>
        item.kind === "approve_plan" && item.status === "pending")!.id;
      await client.submit(command("command:approve:restart", runId, projection.sequence, {
        type: "resolve_decision",
        decisionId,
        optionId: "approve"
      }));
      const firstTree = await waitForJson<{ child: number; grandchild: number }>(pidEvidencePath);
      expect(isAlive(firstTree.child)).toBe(true);
      expect(isAlive(firstTree.grandchild)).toBe(true);

      await crashDaemon(daemon);
      await waitUntil(() => !isAlive(firstTree.child) && !isAlive(firstTree.grandchild));

      daemon = await startDaemon({ stateRoot, endpoint, pidEvidencePath });
      client = createLocalIpcClient({
        endpoint,
        capabilityFilePath: path.join(stateRoot, "installation", "ipc-capability"),
        production: false
      });
      projection = await waitForProjection(client, runId, (item) =>
        item.lifecycle === "running"
        && Object.values(item.effectIntents).filter((intent) => intent.kind === "process_spawn").length === 2
      );
      const recoveredTree = await waitForJson<{ child: number; grandchild: number }>(
        pidEvidencePath,
        (item) => item.child !== firstTree.child
      );
      expect(isAlive(recoveredTree.child)).toBe(true);
      expect(isAlive(recoveredTree.grandchild)).toBe(true);
      expect(Object.values(projection.effectIntents).filter((intent) => intent.kind === "process_spawn"))
        .toHaveLength(2);
      expect(new Set(Object.values(projection.effectIntents)
        .filter((intent) => intent.kind === "process_spawn")
        .map((intent) => intent.effectId)).size).toBe(2);

      await client.submit(command("command:cancel:restart", runId, projection.sequence, {
        type: "cancel_run",
        reason: "finish restart gate"
      }));
      const terminal = await waitForProjection(client, runId, (item) => item.lifecycle === "interrupted");
      expect(terminal.lifecycle).toBe("interrupted");
      await waitUntil(() => !isAlive(recoveredTree.child) && !isAlive(recoveredTree.grandchild));
    } finally {
      if (daemon.exitCode === null) await crashDaemon(daemon);
    }
  }, 60_000);
});

async function startDaemon(input: {
  stateRoot: string;
  endpoint: string;
  pidEvidencePath: string;
}): Promise<ChildProcess> {
  const child = spawn(process.execPath, [cliPath], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      MANYHANDS_DAEMON_STATE_ROOT: input.stateRoot,
      MANYHANDS_DAEMON_ENDPOINT: input.endpoint,
      MANYHANDS_WINDOWS_JOB_RUNNER: helperPath,
      MANYHANDS_FAKE_WORKER_SCRIPT: workerPath,
      MANYHANDS_FAKE_PID_EVIDENCE: input.pidEvidencePath
    }
  });
  const ready = await waitForLine(child, (line) => {
    try {
      return JSON.parse(line).event === "manyhands.daemon.ready";
    } catch {
      return false;
    }
  });
  expect(ready).toBe(true);
  return child;
}

async function crashDaemon(child: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

async function waitForLine(child: ChildProcess, predicate: (line: string) => boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => reject(new Error("Daemon did not become ready.")), 20_000);
    child.stderr?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Daemon exited before ready (${code}): ${buffered}`));
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() ?? "";
      if (lines.some(predicate)) {
        clearTimeout(timeout);
        resolve(true);
      }
    });
  });
}

async function waitForProjection(
  client: ReturnType<typeof createLocalIpcClient>,
  runId: string,
  predicate: (projection: RunProjection) => boolean
): Promise<RunProjection> {
  let last: unknown;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const projection = await client.query({ runId, query: "projection" }) as unknown as RunProjection;
      last = projection;
      if (predicate(projection)) return projection;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Projection did not converge: ${JSON.stringify(last)}`);
}

function command(
  commandId: string,
  runId: string,
  expectedRevision: number,
  payload: ProductRunCommand
) {
  return buildRunCommandEnvelope({
    commandId,
    runId,
    expectedRevision,
    submittedAt: new Date().toISOString(),
    command: payload as unknown as RunCommandPayload
  }, sha256);
}

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:restart",
    userPrompt: "Survive a daemon restart",
    acceptanceCriteria: ["one recovered execution"],
    title: "Daemon restart",
    planningSelection: { executorId: "codex-cli", model: "fake" },
    executionSelection: { executorId: "codex-cli", model: "fake" },
    repairSelection: { executorId: "codex-cli", model: "fake" },
    executionConfig: {},
    targetContext: { fingerprint: "target:restart", sourceBaseCommit: "abc", sourceRealPath: process.cwd() }
  };
}

async function waitForJson<T>(filePath: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const value = JSON.parse(await readFile(filePath, "utf8")) as T;
      if (predicate(value)) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`PID evidence did not converge: ${JSON.stringify(last)}`);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Process tree did not reach quiescence.");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
