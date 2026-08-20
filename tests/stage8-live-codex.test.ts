import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DigestHasher, SemanticPlanMaterial } from "@manyhands/contracts";
import type { PlanningModelInput, PlanningModelProposal } from "@manyhands/decomposer";
import type { RepositoryView } from "@manyhands/repository-index";
import { buildRunCommandEnvelope, type ProductRunDefinition, type RunCommandPayload, type RunProjection } from "@manyhands/run-coordinator";
import { readProcessSupervisorReceipts } from "@manyhands/execution-core";
import { createCurrentSandboxedLiveProfile } from "../apps/daemon/src/current-lifecycle-adapters.js";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const execFileAsync = promisify(execFile);
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const enabled = process.env.MANYHANDS_STAGE8_LIVE === "1";
const target = process.env.MANYHANDS_STAGE8_TARGET ?? "C:\\mh8-r0";
let root: string;
let helperPath: string;

beforeAll(async () => {
  const preservedRoot = process.env.MANYHANDS_STAGE8_EVIDENCE_ROOT;
  root = preservedRoot === undefined
    ? await mkdtemp(path.join(os.tmpdir(), "mh-stage8-live-codex-"))
    : path.resolve(preservedRoot);
  if (preservedRoot !== undefined) await mkdir(root, { recursive: true });
  helperPath = path.join(root, "manyhands-windows-job-runner.exe");
  await execFileAsync("rustc.exe", [
    path.resolve("native/windows-job-runner/src/main.rs"),
    "--edition=2021", "-O", "-o", helperPath
  ], { windowsHide: true });
  await access(helperPath);
}, 90_000);

afterAll(async () => {
  if (process.env.MANYHANDS_STAGE8_EVIDENCE_ROOT === undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe.skipIf(!enabled || process.platform !== "win32")("Stage 8 live Codex leaf", () => {
  it("runs exactly one Codex leaf through the sandboxed daemon profile", async () => {
    const authPath = process.env.MANYHANDS_CODEX_AUTH_PATH;
    if (authPath === undefined) throw new Error("MANYHANDS_CODEX_AUTH_PATH is required for the opt-in live test.");
    await access(authPath);
    const baseCommit = (await execFileAsync("git", ["-C", target, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    const stateRoot = path.join(root, "state");
    const kernel = await startProductiveDaemon({
      stateRoot,
      endpoint: `\\\\.\\pipe\\mh-stage8-live-${Date.now()}`,
      processStartIdentity: "process:stage8-live:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot,
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
        cwd: process.cwd(),
        codexCredentialPath: authPath,
        codexWindowsSandbox: stage8WindowsSandbox(),
        planningProposal: async (input, view) => stage8PlanningProposal(input, view)
      })
    });
    try {
      const client = createLocalIpcClient({ endpoint: kernel.endpoint, capabilityFilePath: kernel.capabilityFilePath, production: false });
      const runId = `run:stage8:live-codex:${Date.now()}`;
      await client.submit(command("create", runId, 0, { type: "create_run", definition: definition(baseCommit) }));
      await kernel.drainEffects();
      let projection = await waitForProjection(client, runId, (value) =>
        value.lifecycle === "needs_approval" || value.lifecycle === "failed");
      if (projection.lifecycle === "failed") {
        throw new Error(`Live planner failed: ${projection.failureReason ?? "unknown reason"}`);
      }
      const compiled = (await kernel.eventStore.load(runId)).find((event) => event.type === "graph.compiled");
      if (compiled?.type !== "graph.compiled") throw new Error("Live planner produced no compiled graph.");
      const leaves = Object.values((compiled.payload.graph as { nodes: Record<string, { kind?: string }> }).nodes)
        .filter((node) => node.kind === "leaf");
      expect(leaves).toHaveLength(1);
      const decision = Object.values(projection.decisions).find((item) => item.kind === "approve_plan" && item.status === "pending");
      if (decision === undefined) throw new Error("Live plan lacks an approval decision.");
      await client.submit(command("approve", runId, projection.sequence, {
        type: "resolve_decision", decisionId: decision.id, optionId: "approve"
      }));
      await kernel.drainEffects();
      projection = await waitForProjection(client, runId, (value) => value.lifecycle === "result_ready" || value.lifecycle === "failed", 900_000);
      expect(projection.lifecycle).toBe("result_ready");
      expect(projection.finalCandidate).toBeDefined();
      const candidateCommit = projection.finalCandidate?.commit;
      if (candidateCommit === undefined) throw new Error("Live run has no candidate commit.");
      const spawn = Object.values(projection.effectIntents).find((intent) => intent.kind === "process_spawn");
      if (spawn === undefined) throw new Error("Live run has no supervised process effect.");
      const receipts = await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), spawn.effectId);
      expect(receipts.map((receipt) => receipt.phase)).toEqual(["started", "final"]);
      const candidateSource = (await execFileAsync("git", [
        "-C", target, "show", `${candidateCommit}:src/stage8-probe.js`
      ], { windowsHide: true })).stdout;
      expect(candidateSource).toContain("stage8-ok");
      const source = await readFile(path.join(target, "src", "stage8-probe.js"), "utf8");
      expect(source).toContain("baseline");
    } finally {
      await kernel.close();
    }
  }, 960_000);

  it("blocks the live path when the declared Codex sandbox marker is unavailable", async () => {
    const baseCommit = (await execFileAsync("git", ["-C", target, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    const stateRoot = path.join(root, "r14-state");
    const credentialPath = path.join(root, "r14-credential", "auth.json");
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(credentialPath, "{}", "utf8");
    const kernel = await startProductiveDaemon({
      stateRoot,
      endpoint: `\\\\.\\pipe\\mh-stage8-r14-${Date.now()}`,
      processStartIdentity: "process:stage8-r14:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot,
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
        cwd: process.cwd(),
        codexCredentialPath: credentialPath,
        codexWindowsSandbox: stage8WindowsSandbox(),
        planningProposal: async (input, view) => stage8PlanningProposal(input, view)
      })
    });
    try {
      const client = createLocalIpcClient({ endpoint: kernel.endpoint, capabilityFilePath: kernel.capabilityFilePath, production: false });
      const runId = `run:stage8:r14:${Date.now()}`;
      await client.submit(command("r14-create", runId, 0, { type: "create_run", definition: definition(baseCommit) }));
      await kernel.drainEffects();
      let projection = await waitForProjection(client, runId, (value) => value.lifecycle === "needs_approval");
      const decision = Object.values(projection.decisions).find((item) => item.kind === "approve_plan" && item.status === "pending");
      if (decision === undefined) throw new Error("R14 plan lacks an approval decision.");
      await client.submit(command("r14-approve", runId, projection.sequence, {
        type: "resolve_decision", decisionId: decision.id, optionId: "approve"
      }));
      await kernel.drainEffects();
      projection = await waitForProjection(client, runId, (value) =>
        Object.values(value.attempts).some((attempt) => attempt.status === "failed"));
      const failedAttempt = Object.values(projection.attempts).find((attempt) => attempt.status === "failed");
      expect(failedAttempt?.failureReason).toContain("SANDBOX_UNAVAILABLE:");
      expect(failedAttempt?.failureReason).toContain("setup marker is unavailable");
      const recoveryDecision = Object.values(projection.decisions).find((item) =>
        item.kind === "resolve_conflict" && item.status === "pending");
      expect(recoveryDecision?.question).toContain("SANDBOX_UNAVAILABLE:");
      const spawn = Object.values(projection.effectIntents).find((intent) => intent.kind === "process_spawn");
      if (spawn === undefined) throw new Error("R14 run has no supervised worker effect.");
      const receipts = await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), spawn.effectId);
      expect(receipts.map((receipt) => receipt.phase)).toEqual(["started", "final"]);
    } finally {
      await kernel.close();
    }
  }, 180_000);

  it("cancels a running Codex process tree without leaving a candidate or descendant", async () => {
    const authPath = process.env.MANYHANDS_CODEX_AUTH_PATH;
    if (authPath === undefined) throw new Error("MANYHANDS_CODEX_AUTH_PATH is required for the opt-in R10 test.");
    await access(authPath);
    const baseCommit = (await execFileAsync("git", ["-C", target, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    const stateRoot = path.join(root, "r10-state");
    const kernel = await startProductiveDaemon({
      stateRoot,
      endpoint: `\\\\.\\pipe\\mh-stage8-r10-${Date.now()}`,
      processStartIdentity: "process:stage8-r10:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot,
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
        cwd: process.cwd(),
        codexCredentialPath: authPath,
        codexWindowsSandbox: stage8WindowsSandbox(),
        planningProposal: async (input, view) => stage8PlanningProposal(input, view)
      })
    });
    try {
      const client = createLocalIpcClient({ endpoint: kernel.endpoint, capabilityFilePath: kernel.capabilityFilePath, production: false });
      const runId = `run:stage8:r10:${Date.now()}`;
      await client.submit(command("r10-create", runId, 0, {
        type: "create_run",
        definition: definition(baseCommit, {
          userPrompt: "Before changing any file, run a PowerShell command that waits for 120 seconds. Do not make any change before that wait completes. Afterward, modify the existing src/stage8-probe.js so its exported stage8Probe function returns the exact string stage8-ok. Update the existing src/stage8-probe.test.js to verify that value with node:test. Do not add files or directories; change only those two existing files."
        })
      }));
      await kernel.drainEffects();
      let projection = await waitForProjection(client, runId, (value) => value.lifecycle === "needs_approval");
      const decision = Object.values(projection.decisions).find((item) => item.kind === "approve_plan" && item.status === "pending");
      if (decision === undefined) throw new Error("R10 plan lacks an approval decision.");
      await client.submit(command("r10-approve", runId, projection.sequence, {
        type: "resolve_decision", decisionId: decision.id, optionId: "approve"
      }));
      await waitForTraceOutput(stateRoot, runId);
      projection = await client.query({ runId, query: "projection" }) as unknown as RunProjection;
      const spawn = Object.values(projection.effectIntents).find((intent) => intent.kind === "process_spawn");
      if (spawn === undefined) throw new Error("R10 run has no supervised worker effect.");
      await client.submit(command("r10-cancel", runId, projection.sequence, {
        type: "cancel_run", reason: "R10 cancellation after Codex emitted live output"
      }));
      await kernel.drainEffects();
      const terminal = await waitForProjection(client, runId, (value) => value.lifecycle === "interrupted");
      expect(terminal.finalCandidate).toBeUndefined();
      expect(await codexProcessIdsFor(runId)).toEqual([]);
      expect(await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), spawn.effectId)).toEqual([
        expect.objectContaining({ phase: "started" }),
        expect.objectContaining({ phase: "final", outcome: "terminated" })
      ]);
      const events = await kernel.eventStore.load(runId);
      expect(events.findIndex((event) => event.type === "operation.cancel_requested"))
        .toBeLessThan(events.findIndex((event) => event.type === "operation.interrupted"));
    } finally {
      await kernel.close();
    }
  }, 300_000);

  it("times out a running Codex process tree without a candidate or scoped Codex process afterward", async () => {
    const authPath = process.env.MANYHANDS_CODEX_AUTH_PATH;
    if (authPath === undefined) throw new Error("MANYHANDS_CODEX_AUTH_PATH is required for the opt-in R10 timeout test.");
    await access(authPath);
    const baseCommit = (await execFileAsync("git", ["-C", target, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    const stateRoot = path.join(root, "r10-timeout-state");
    const kernel = await startProductiveDaemon({
      stateRoot,
      endpoint: `\\\\.\\pipe\\mh-stage8-r10-timeout-${Date.now()}`,
      processStartIdentity: "process:stage8-r10-timeout:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot,
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
        cwd: process.cwd(),
        codexCredentialPath: authPath,
        codexWindowsSandbox: stage8WindowsSandbox(),
        planningProposal: async (input, view) => stage8PlanningProposal(input, view)
      })
    });
    try {
      const client = createLocalIpcClient({ endpoint: kernel.endpoint, capabilityFilePath: kernel.capabilityFilePath, production: false });
      const runId = `run:stage8:r10-timeout:${Date.now()}`;
      await client.submit(command("r10-timeout-create", runId, 0, {
        type: "create_run",
        definition: definition(baseCommit, {
          userPrompt: "Before changing any file, run a PowerShell command that waits for 120 seconds. Do not make any change before that wait completes.",
          executionConfig: { leafTimeoutMs: 15_000, scopePolicy: "strict" }
        })
      }));
      await kernel.drainEffects();
      let projection = await waitForProjection(client, runId, (value) => value.lifecycle === "needs_approval");
      const decision = Object.values(projection.decisions).find((item) => item.kind === "approve_plan" && item.status === "pending");
      if (decision === undefined) throw new Error("R10 timeout plan lacks an approval decision.");
      await client.submit(command("r10-timeout-approve", runId, projection.sequence, {
        type: "resolve_decision", decisionId: decision.id, optionId: "approve"
      }));
      await kernel.drainEffects();
      projection = await waitForProjection(client, runId, (value) =>
        Object.values(value.attempts).some((attempt) => attempt.status === "failed"), 180_000);
      const failedAttempt = Object.values(projection.attempts).find((attempt) => attempt.status === "failed");
      expect(failedAttempt?.failureReason).toMatch(/timed? out|timeout/i);
      expect(projection.finalCandidate).toBeUndefined();
      expect(await codexProcessIdsFor(runId)).toEqual([]);
      expect(await brokeredCredentialFiles(path.join(stateRoot, "credential-broker"))).toEqual([]);
      const spawn = Object.values(projection.effectIntents).find((intent) => intent.kind === "process_spawn");
      if (spawn === undefined) throw new Error("R10 timeout run has no supervised worker effect.");
      expect(await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), spawn.effectId)).toEqual([
        expect.objectContaining({ phase: "started" }),
        expect.objectContaining({ phase: "final", outcome: "succeeded" })
      ]);
    } finally {
      await kernel.close();
    }
  }, 300_000);

  it("reconciles a crashed live daemon before recovering exactly one Codex execution", async () => {
    const authPath = process.env.MANYHANDS_CODEX_AUTH_PATH;
    if (authPath === undefined) throw new Error("MANYHANDS_CODEX_AUTH_PATH is required for the opt-in R10 restart test.");
    await access(authPath);
    const baseCommit = (await execFileAsync("git", ["-C", target, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    const stateRoot = path.join(root, "r10-restart-state");
    const endpoint = `\\\\.\\pipe\\mh-stage8-r10-restart-${Date.now()}`;
    const runId = `run:stage8:r10:restart:${Date.now()}`;
    const planner = await startProductiveDaemon({
      stateRoot,
      endpoint,
      processStartIdentity: "process:stage8-r10-restart:planning",
      processIdentityProbe: { probe: async () => "dead" as const },
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot,
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
        cwd: process.cwd(),
        codexCredentialPath: authPath,
        codexWindowsSandbox: stage8WindowsSandbox(),
        planningProposal: async (input, view) => stage8PlanningProposal(input, view)
      })
    });
    let daemon: ChildProcess | undefined;
    try {
      const planningClient = createLocalIpcClient({
        endpoint: planner.endpoint,
        capabilityFilePath: planner.capabilityFilePath,
        production: false
      });
      await planningClient.submit(command("r10-restart-create", runId, 0, {
        type: "create_run",
        definition: definition(baseCommit, {
          userPrompt: "Before changing any file, run a PowerShell command that waits for 120 seconds. Do not make any change before that wait completes.",
          executionConfig: { leafTimeoutMs: 120_000, scopePolicy: "strict" }
        })
      }));
      await planner.drainEffects();
      const planned = await waitForProjection(planningClient, runId, (value) => value.lifecycle === "needs_approval");
      expect(Object.values(planned.decisions).some((item) => item.kind === "approve_plan" && item.status === "pending")).toBe(true);
    } finally {
      await planner.close();
    }

    try {
      daemon = await startExternalLiveDaemon({ stateRoot, endpoint, authPath });
      let client = externalClient(stateRoot, endpoint);
      let projection = await waitForProjection(client, runId, (value) => value.lifecycle === "needs_approval");
      const decision = Object.values(projection.decisions).find((item) => item.kind === "approve_plan" && item.status === "pending");
      if (decision === undefined) throw new Error("R10 restart plan lacks an approval decision.");
      await client.submit(command("r10-restart-approve", runId, projection.sequence, {
        type: "resolve_decision", decisionId: decision.id, optionId: "approve"
      }));
      await waitForTraceOutput(stateRoot, runId);
      projection = await client.query({ runId, query: "projection" }) as unknown as RunProjection;
      const firstSpawn = Object.values(projection.effectIntents).find((intent) => intent.kind === "process_spawn");
      if (firstSpawn === undefined) throw new Error("R10 restart run has no initial supervised worker effect.");

      await crashExternalDaemon(daemon);
      daemon = undefined;
      await waitUntil(async () => (await codexProcessIdsFor(runId)).length === 0, "The crashed daemon left a scoped Codex process alive.");

      daemon = await startExternalLiveDaemon({ stateRoot, endpoint, authPath });
      client = externalClient(stateRoot, endpoint);
      projection = await waitForProjection(client, runId, (value) =>
        value.lifecycle === "running"
        && Object.values(value.effectIntents).filter((intent) => intent.kind === "process_spawn").length === 2
      );
      const spawns = Object.values(projection.effectIntents).filter((intent) => intent.kind === "process_spawn");
      expect(spawns).toHaveLength(2);
      expect(new Set(spawns.map((intent) => intent.effectId)).size).toBe(2);
      const recoveredSpawn = spawns.find((intent) => intent.effectId !== firstSpawn.effectId);
      if (recoveredSpawn === undefined) throw new Error("R10 restart did not create a distinct recovered process effect.");
      await waitUntil(async () => {
        const receipts = await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), recoveredSpawn.effectId);
        return receipts.some((receipt) => receipt.phase === "started");
      }, "The recovered process effect never acquired a supervised identity.");
      expect(await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), firstSpawn.effectId)).toEqual([
        expect.objectContaining({ phase: "started" }),
        expect.objectContaining({ phase: "final", outcome: "terminated" })
      ]);

      await client.submit(command("r10-restart-cancel", runId, projection.sequence, {
        type: "cancel_run", reason: "R10 restart recovery proved; terminate the recovered Codex tree"
      }));
      const terminal = await waitForProjection(client, runId, (value) => value.lifecycle === "interrupted");
      expect(terminal.finalCandidate).toBeUndefined();
      await waitUntil(async () => (await codexProcessIdsFor(runId)).length === 0, "The recovered Codex process survived cancellation.");
      await waitUntil(
        async () => (await brokeredCredentialFiles(path.join(stateRoot, "credential-broker"))).length === 0,
        "A brokered credential survived the recovered worker termination."
      );
    } finally {
      if (daemon?.exitCode === null) await crashExternalDaemon(daemon);
    }
  }, 420_000);

  it("repairs a live sandbox failure with immutable retry lineage and a new fingerprint", async () => {
    const authPath = process.env.MANYHANDS_CODEX_AUTH_PATH;
    if (authPath === undefined) throw new Error("MANYHANDS_CODEX_AUTH_PATH is required for the opt-in R17 test.");
    const markerPath = path.join(path.dirname(authPath), ".sandbox", "setup_marker.json");
    await Promise.all([access(authPath), access(markerPath)]);
    const baseCommit = (await execFileAsync("git", ["-C", target, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    const stateRoot = path.join(root, "r17-state");
    const credentialPath = path.join(root, "r17-credential", "auth.json");
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await link(authPath, credentialPath);
    const kernel = await startProductiveDaemon({
      stateRoot,
      endpoint: `\\\\.\\pipe\\mh-stage8-r17-${Date.now()}`,
      processStartIdentity: "process:stage8-r17:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      windowsJobRunnerPath: helperPath,
      production: false,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot,
        nodeExecutable: process.execPath,
        workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
        cwd: process.cwd(),
        codexCredentialPath: credentialPath,
        codexWindowsSandbox: stage8WindowsSandbox(),
        planningProposal: async (input, view) => stage8PlanningProposal(input, view)
      })
    });
    try {
      const client = createLocalIpcClient({ endpoint: kernel.endpoint, capabilityFilePath: kernel.capabilityFilePath, production: false });
      const runId = `run:stage8:r17:${Date.now()}`;
      await client.submit(command("r17-create", runId, 0, { type: "create_run", definition: definition(baseCommit) }));
      await kernel.drainEffects();
      let projection = await waitForProjection(client, runId, (value) => value.lifecycle === "needs_approval");
      const approval = Object.values(projection.decisions).find((item) => item.kind === "approve_plan" && item.status === "pending");
      if (approval === undefined) throw new Error("R17 plan lacks an approval decision.");
      await client.submit(command("r17-approve", runId, projection.sequence, {
        type: "resolve_decision", decisionId: approval.id, optionId: "approve"
      }));
      await kernel.drainEffects();
      projection = await waitForProjection(client, runId, (value) =>
        Object.values(value.attempts).some((attempt) => attempt.status === "failed"));
      const firstAttempt = Object.values(projection.attempts).find((attempt) => attempt.status === "failed");
      if (firstAttempt === undefined) throw new Error("R17 did not retain the first failed attempt.");
      expect(firstAttempt.failureReason).toContain("SANDBOX_UNAVAILABLE:");
      const repairedMarkerPath = path.join(path.dirname(credentialPath), ".sandbox", "setup_marker.json");
      await mkdir(path.dirname(repairedMarkerPath), { recursive: true });
      await copyFile(markerPath, repairedMarkerPath);
      const recovery = Object.values(projection.decisions).find((item) => item.kind === "resolve_conflict" && item.status === "pending");
      if (recovery === undefined) throw new Error("R17 failure lacks a recovery decision.");
      await client.submit(command("r17-retry", runId, projection.sequence, {
        type: "resolve_decision", decisionId: recovery.id, optionId: "retry"
      }));
      await kernel.drainEffects();
      const repaired = await waitForProjection(client, runId, (value) => value.lifecycle === "result_ready" || value.lifecycle === "failed", 900_000);
      expect(repaired.lifecycle).toBe("result_ready");
      const retry = Object.values(repaired.attempts).find((attempt) => attempt.retryOfAttemptId === firstAttempt.attemptId);
      expect(retry).toEqual(expect.objectContaining({ retryOfAttemptId: firstAttempt.attemptId }));
      expect(retry?.inputFingerprint).not.toBe(firstAttempt.inputFingerprint);
      expect(repaired.attempts[firstAttempt.attemptId]?.failureReason).toBe(firstAttempt.failureReason);
      expect(repaired.finalCandidate).toBeDefined();
    } finally {
      await kernel.close();
      await rm(credentialPath, { force: true });
    }
  }, 960_000);
});

function stage8WindowsSandbox(): "elevated" | "unelevated" {
  const value = process.env.MANYHANDS_STAGE8_WINDOWS_SANDBOX ?? "unelevated";
  if (value === "elevated" || value === "unelevated") return value;
  throw new Error("MANYHANDS_STAGE8_WINDOWS_SANDBOX must be elevated or unelevated.");
}

function definition(
  baseCommit: string,
  overrides: Partial<Pick<ProductRunDefinition, "userPrompt" | "executionConfig">> = {}
): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage8-live",
    title: "Stage 8 live Codex leaf",
    userPrompt: overrides.userPrompt ?? "Modify the existing src/stage8-probe.js so its exported stage8Probe function returns the exact string stage8-ok. Update the existing src/stage8-probe.test.js to verify that value with node:test. Do not add files or directories; change only those two existing files.",
    acceptanceCriteria: ["src/stage8-probe.js returns stage8-ok and node --test passes"],
    planningSelection: { executorId: "codex-cli", model: "gpt-5.5" },
    executionSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    repairSelection: { executorId: "codex-cli", model: "gpt-5.4-mini", effort: "medium" },
    executionConfig: overrides.executionConfig ?? { leafTimeoutMs: 600_000, scopePolicy: "strict" },
    targetContext: {
      fingerprint: "stage8-live-clean-clone",
      sourceBaseCommit: baseCommit,
      sourceBranch: "codex/correctness-first-full-implementation",
      sourceRealPath: target
    }
  };
}

function stage8PlanningProposal(
  input: PlanningModelInput,
  view: RepositoryView
): PlanningModelProposal {
  const sourceResources = ["src/stage8-probe.js", "src/stage8-probe.test.js"].map((path) => {
    const resource = Object.values(view.catalog.resources).find((candidate) => candidate.canonicalLocator === `path:${path}`);
    if (resource === undefined || resource.generated.state !== "source") {
      throw new Error(`R0 requires a source-classified resource for ${path}.`);
    }
    return resource;
  });
  const criterion = input.goal.acceptanceCriteria[0];
  if (criterion === undefined) throw new Error("R0 requires one acceptance criterion.");
  const artifactId = "artifact:stage8-probe";
  const obligationId = "validation:stage8-probe";
  const evidenceRefs = sourceResources.flatMap((resource) => resource.evidenceRefs);
  const epistemic = { state: "known" as const, confidence: "high" as const, evidenceRefs };
  const material: SemanticPlanMaterial = {
    id: `plan:${input.goal.id}`,
    revision: 1,
    goalContract: { id: input.goal.id, revision: input.goal.revision, digest: input.goal.digest },
    repositorySnapshot: { ...view.model.snapshot },
    repositoryView: {
      digest: view.digest,
      treeSha: view.treeSha,
      resourceCatalogDigest: view.catalog.digest
    },
    rootUnitId: "unit:stage8-probe",
    units: {
      "unit:stage8-probe": {
        id: "unit:stage8-probe",
        role: "leaf",
        title: "Update the Stage 8 probe",
        objective: "Change the existing probe and its focused test within the declared source files.",
        boundary: { kind: "module", evidenceRefs },
        outcomes: [{ id: "outcome:stage8-probe", statement: "The probe returns stage8-ok and its focused test passes." }],
        criteria: [{ criterionId: criterion.id, statement: criterion.statement, sourceCriterionId: criterion.id }],
        repositorySurface: { resourceRefs: sourceResources.map((resource) => resource.id), pathHints: sourceResources.map((resource) => resource.path!) },
        resourceIntents: sourceResources.map((resource) => ({
          resourceId: resource.id,
          access: "modify" as const,
          ownerPhase: "implementation" as const,
          outputArtifactId: artifactId,
          evidenceRefs: resource.evidenceRefs,
          epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: resource.evidenceRefs }
        })),
        consumes: [],
        produces: [artifactId],
        seamRefs: [],
        validation: [{
          obligationId,
          criterionId: criterion.id,
          proofStrategyId: `proof:${obligationId}`,
          layer: "unit",
          severity: "required",
          acceptableEvidence: ["test_result"],
          baselinePolicy: "required",
          negativeControl: "when_feasible",
          flakyPolicy: "forbid",
          evidence: {
            kind: "focused_command",
            selectors: ["src/stage8-probe.test.js"],
            references: ["src/stage8-probe.test.js"]
          }
        }],
        uncertainty: [],
        granularity: {
          disposition: "leaf",
          feasibility: {
            coherentResponsibility: true,
            boundedContext: "yes",
            boundedChangeSurface: "yes",
            independentlyValidatable: "yes",
            unresolvedArchitectureDecision: false
          },
          splitReasons: [],
          expectedBenefits: [],
          expectedCosts: [],
          evidenceRefs,
          epistemic
        },
        expansion: "leaf"
      }
    },
    seams: {},
    artifacts: {
      [artifactId]: {
        id: artifactId,
        producerUnitId: "unit:stage8-probe",
        consumerUnitIds: [],
        artifactType: "source_change",
        materialization: "patch",
        expectedPaths: sourceResources.map((resource) => resource.path!)
      }
    },
    decisions: [],
    evidence: structuredClone(view.model.evidence),
    status: "ready"
  };
  return { kind: "candidate", material };
}

function command(commandId: string, runId: string, expectedRevision: number, payload: Record<string, unknown>) {
  return buildRunCommandEnvelope({
    commandId: `stage8-live:${commandId}`,
    runId,
    expectedRevision,
    submittedAt: new Date().toISOString(),
    command: payload as RunCommandPayload
  }, sha256);
}

async function waitForProjection(
  client: ReturnType<typeof createLocalIpcClient>,
  runId: string,
  predicate: (value: RunProjection) => boolean,
  timeoutMs = 120_000
): Promise<RunProjection> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const projection = await client.query({ runId, query: "projection" }) as unknown as RunProjection;
      if (predicate(projection)) return projection;
      last = projection;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Live daemon did not converge: ${JSON.stringify(last)}`);
}

async function waitForTraceOutput(stateRoot: string, runId: string, timeoutMs = 180_000): Promise<void> {
  const tracePath = path.join(stateRoot, "traces", runId.replaceAll(":", "_"), "traces.jsonl");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const trace = await readFile(tracePath, "utf8").catch(() => "");
    if (trace.includes('"type":"executor_output"')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Codex did not emit output before R10 cancellation: ${tracePath}`);
}

async function codexProcessIdsFor(runId: string): Promise<number[]> {
  const worktreeSegment = runId.replaceAll(":", "_").replaceAll("'", "''");
  const script = `$matches = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -like '*${worktreeSegment}*' } | Select-Object -ExpandProperty ProcessId; @($matches) | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
  const parsed: unknown = JSON.parse(stdout.trim() || "[]");
  return Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
}

function externalClient(stateRoot: string, endpoint: string) {
  return createLocalIpcClient({
    endpoint,
    capabilityFilePath: path.join(stateRoot, "installation", "ipc-capability"),
    production: false
  });
}

async function startExternalLiveDaemon(input: {
  stateRoot: string;
  endpoint: string;
  authPath: string;
}): Promise<ChildProcess> {
  const child = spawn(process.execPath, [path.resolve("apps/daemon/dist/cli.cjs")], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      MANYHANDS_DAEMON_STATE_ROOT: input.stateRoot,
      MANYHANDS_DAEMON_ENDPOINT: input.endpoint,
      MANYHANDS_DAEMON_PROFILE: "sandboxed_live",
      MANYHANDS_WINDOWS_JOB_RUNNER: helperPath,
      MANYHANDS_TRANSITIONAL_WORKER_SCRIPT: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
      MANYHANDS_CODEX_AUTH_PATH: input.authPath,
      MANYHANDS_STAGE8_WINDOWS_SANDBOX: stage8WindowsSandbox()
    }
  });
  await waitForDaemonReady(child);
  return child;
}

async function crashExternalDaemon(child: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

async function waitForDaemonReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Live daemon did not become ready: ${output}`)), 20_000);
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Live daemon exited before ready (${code}): ${output}`));
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.split(/\r?\n/u).some((line) => {
        try {
          return JSON.parse(line).event === "manyhands.daemon.ready";
        } catch {
          return false;
        }
      })) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function waitUntil(predicate: () => Promise<boolean>, failure: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failure);
}

async function brokeredCredentialFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.name === "auth.json" || entry.name === ".credentials.json") result.push(entryPath);
    }
  }
  await visit(root);
  return result;
}
