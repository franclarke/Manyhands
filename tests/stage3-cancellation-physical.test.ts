import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DigestHasher } from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  type ProductRunDefinition,
  type RunCommandPayload
} from "@manyhands/run-coordinator";
import { readProcessSupervisorReceipts } from "@manyhands/execution-core";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const at = () => new Date().toISOString();
let root: string;
let helperPath: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-cancel-physical-"));
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
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("Stage 3 physical cancellation", () => {
  it("persists intent, kills child and grandchild, and only then publishes interrupted", async () => {
    const stateRoot = path.join(root, "state");
    const pidEvidencePath = path.join(root, "tree-pids.json");
    const kernel = await startProductiveDaemon({
      stateRoot,
      endpoint: `\\\\.\\pipe\\mh-stage3-cancel-${randomUUID()}`,
      processStartIdentity: "process:stage3-cancel:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:stage3-cancel",
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: {
        kind: "deterministic_fake",
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("tests/fixtures/stage3-fake-worker.mjs"),
        cwd: process.cwd(),
        pidEvidencePath
      }
    });
    try {
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const runId = "run:stage3:physical-cancel";
      await client.submit(command("command:create:physical", runId, 0, {
        type: "create_run",
        definition: definition()
      }));
      await kernel.drainEffects();
      let projection = await kernel.engine.query(runId);
      const decisionId = Object.values(projection.decisions).find((item) =>
        item.kind === "approve_plan" && item.status === "pending")!.id;
      await client.submit(command("command:approve:physical", runId, projection.sequence, {
        type: "resolve_decision",
        decisionId,
        optionId: "approve"
      }));

      let pids: { child: number; grandchild: number };
      try {
        pids = await waitForJson<{ child: number; grandchild: number }>(pidEvidencePath);
      } catch (error) {
        const diagnostic = await kernel.engine.query(runId);
        const spawn = Object.values(diagnostic.effectIntents).find((intent) => intent.kind === "process_spawn");
        const supervisorReceipts = spawn === undefined
          ? []
          : await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), spawn.effectId);
        const started = supervisorReceipts.find((receipt) => receipt.phase === "started");
        const stderr = started === undefined
          ? undefined
          : await readFile(started.stderrPath, "utf8").catch(() => undefined);
        throw new Error(`Fake tree did not start: ${JSON.stringify({
          lifecycle: diagnostic.lifecycle,
          intents: diagnostic.effectIntents,
          terminals: diagnostic.effectTerminals,
          supervisorReceipts,
          stderr
        })}`, { cause: error });
      }
      expect(isAlive(pids.child)).toBe(true);
      expect(isAlive(pids.grandchild)).toBe(true);
      projection = await kernel.engine.query(runId);
      const spawnIntent = Object.values(projection.effectIntents).find((intent) =>
        intent.kind === "process_spawn")!;

      await client.submit(command("command:cancel:physical", runId, projection.sequence, {
        type: "cancel_run",
        reason: "physical GR cancellation"
      }));
      const cancellingEvents = await kernel.eventStore.load(runId);
      expect(cancellingEvents.some((event) => event.type === "operation.cancel_requested")).toBe(true);
      expect((await kernel.engine.query(runId)).lifecycle).toBe("cancelling");

      await kernel.drainEffects();
      await waitUntil(() => !isAlive(pids.child) && !isAlive(pids.grandchild));
      const terminal = await kernel.engine.query(runId);
      expect(terminal.lifecycle).toBe("interrupted");
      expect(isAlive(pids.child)).toBe(false);
      expect(isAlive(pids.grandchild)).toBe(false);
      expect(await readProcessSupervisorReceipts(
        path.join(stateRoot, "processes"),
        spawnIntent.effectId
      )).toEqual([
        expect.objectContaining({ phase: "started" }),
        expect.objectContaining({ phase: "final", outcome: "terminated" })
      ]);
      const events = await kernel.eventStore.load(runId);
      expect(events.findIndex((event) => event.type === "operation.cancel_requested"))
        .toBeLessThan(events.findIndex((event) => event.type === "operation.interrupted"));
    } finally {
      await kernel.close();
    }
  }, 45_000);
});

function command(
  commandId: string,
  runId: string,
  expectedRevision: number,
  payload: Record<string, unknown>
) {
  return buildRunCommandEnvelope({
    commandId,
    runId,
    expectedRevision,
    submittedAt: at(),
    command: payload as unknown as RunCommandPayload
  }, sha256);
}

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:physical",
    userPrompt: "Run a deterministic process tree",
    acceptanceCriteria: ["all descendants die"],
    title: "Physical cancellation",
    planningSelection: { executorId: "codex-cli", model: "fake" },
    executionSelection: { executorId: "codex-cli", model: "fake" },
    repairSelection: { executorId: "codex-cli", model: "fake" },
    executionConfig: {},
    targetContext: { fingerprint: "target:physical", sourceBaseCommit: "abc", sourceRealPath: process.cwd() }
  };
}

async function waitForJson<T>(filePath: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw last;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
