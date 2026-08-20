import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import type { DigestHasher, EffectKind } from "@manyhands/contracts";
import {
  CredentialBroker,
  readProcessSupervisorReceipts,
  SimpleGitRunner,
  WorktreeManager
} from "@manyhands/execution-core";
import {
  buildRunCommandEnvelope,
  type ProductRunDefinition,
  type RunCommandPayload,
  type RunEventInput
} from "@manyhands/run-coordinator";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";
import { executionCredentialScopeId } from "../apps/daemon/src/process-effect-adapters.js";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";
import { withTransitionalRepositoryLease } from "../apps/daemon/src/transitional-repository-lease.js";
import { createLocalIpcClient } from "../apps/web/src/lib/server/daemon/local-ipc-client.js";

const roots: string[] = [];
const at = "2026-08-13T02:00:00.000Z";
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const execFileAsync = promisify(execFile);
const physicalIt = process.platform === "win32" ? it : it.skip;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Stage 3 productive daemon boundary", () => {
  physicalIt("owns create, idempotent multi-client commands and pure query/event pages", async () => {
    const root = await temporaryRoot();
    const { repositoryRoot, baseSha } = await initializeRepository(root);
    const windowsJobRunnerPath = await windowsJobRunnerFor(root);
    const counts = new Map<EffectKind, number>();
    const kernel = await startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("product"),
      processStartIdentity: "process:test:1",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:product:test",
      clock: () => at,
      production: false,
      ...(windowsJobRunnerPath === undefined ? {} : { windowsJobRunnerPath }),
      profile: {
        kind: "transitional_unsafe",
        adapters: adapters(counts).filter((adapter) =>
          adapter.kind !== "process_spawn" && adapter.kind !== "process_terminate"),
        loadPlanningResult: async (effectId) => deterministicPlanningResult(effectId),
        executionProcess: () => ({
          executable: process.execPath,
          argv: ["-e", "process.exit(0)"],
          cwd: process.cwd(),
          env: workerEnvironment()
        })
      }
    });
    try {
      const first = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const second = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const runId = "run:stage3:product";
      const create = buildRunCommandEnvelope({
        commandId: "command:create:stage3",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: {
          type: "create_run",
          definition: definitionForTarget(repositoryRoot, baseSha)
        } as unknown as RunCommandPayload
      }, sha256);

      const [left, right] = await Promise.all([first.submit(create), second.submit(create)]);
      expect(left).toEqual(right);
      await kernel.drainEffects();
      expect(counts.get("model_call")).toBe(1);

      const projection = await first.query({ runId, query: "projection" });
      expect(projection).toMatchObject({
        runId,
        lifecycle: "needs_approval",
        definition: { userPrompt: "Build deterministic stage three" }
      });

      const domain = await kernel.engine.query(runId);
      const decisionId = Object.values(domain.decisions).find((decision) =>
        decision.kind === "approve_plan" && decision.status === "pending")?.id;
      expect(decisionId).toBeDefined();
      const approve = buildRunCommandEnvelope({
        commandId: "command:approve:stage3",
        runId,
        expectedRevision: domain.sequence,
        submittedAt: at,
        command: { type: "resolve_decision", decisionId: decisionId!, optionId: "approve" }
      }, sha256);
      const approvals = await Promise.all([first.submit(approve), second.submit(approve)]);
      expect(approvals[0]).toEqual(approvals[1]);
      await kernel.drainEffects();
      const afterExecution = await kernel.engine.query(runId);
      const spawn = Object.values(afterExecution.effectIntents).find((intent) => intent.kind === "process_spawn");
      expect(spawn).toBeDefined();
      expect(await readProcessSupervisorReceipts(path.join(root, "processes"), spawn!.effectId))
        .toEqual([
          expect.objectContaining({ phase: "started" }),
          expect.objectContaining({ phase: "final", outcome: "succeeded" })
        ]);
      expect(afterExecution.effectTerminals[spawn!.effectId]).toMatchObject({ status: "completed" });

      const runFiles = (await readdir(path.join(root, "runs")))
        .filter((name) => name.endsWith(".events.v2.jsonl"));
      expect(runFiles).toHaveLength(1);
      const journalPath = path.join(root, "runs", runFiles[0]!);
      const before = await readFile(journalPath, "utf8");
      for (let index = 0; index < 5; index += 1) {
        await second.query({ runId, query: "projection" });
        const page = await second.eventsReady({ runId, afterSequence: 0 });
        expect(page).toMatchObject({ nextSequence: expect.any(Number) });
      }
      expect(await readFile(journalPath, "utf8")).toBe(before);

      const listed = await first.query({
        runId: "installation:runs",
        query: "list",
        arguments: { workspaceId: "workspace:stage3", limit: 10 }
      });
      expect(listed).toMatchObject([{ runId }]);
    } finally {
      await kernel.close();
    }
  });

  it("fails closed when a command id is reused with different content", async () => {
    const root = await temporaryRoot();
    const kernel = await startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("conflict"),
      processStartIdentity: "process:test:2",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:conflict:test",
      clock: () => at,
      production: false,
      profile: {
        kind: "transitional_unsafe",
        adapters: adapters(new Map()).filter((adapter) =>
          adapter.kind !== "process_spawn" && adapter.kind !== "process_terminate"),
        executionProcess: () => ({
          executable: process.execPath,
          argv: ["-e", "process.exit(0)"],
          cwd: process.cwd(),
          env: workerEnvironment()
        }),
        // This profile has no planner. Saying so as a durable fact keeps the
        // run in a state the reducer accepts; returning nothing would leave it
        // planning forever and make a real planning bug look like patience.
        loadPlanningResult: async () => [{
          eventId: "planning:stage3:conflict:no-planner",
          occurredAt: at,
          type: "planning.failed" as const,
          payload: { reason: "This profile has no planner; the boundary under test is command identity." }
        }]
      }
    });
    try {
      const client = createLocalIpcClient({
        endpoint: kernel.endpoint,
        capabilityFilePath: kernel.capabilityFilePath,
        production: false
      });
      const runId = "run:stage3:conflict";
      await client.submit(buildRunCommandEnvelope({
        commandId: "command:reused",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: { type: "create_run", definition: definition() } as unknown as RunCommandPayload
      }, sha256));
      await expect(client.submit(buildRunCommandEnvelope({
        commandId: "command:reused",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: {
          type: "create_run",
          definition: { ...definition(), title: "Different" }
        } as unknown as RunCommandPayload
      }, sha256))).rejects.toMatchObject({ code: "request_failed" });
    } finally {
      await kernel.close();
    }
  });

  it("refuses live profiles that replace daemon-owned process adapters", async () => {
    const root = await temporaryRoot();
    await expect(startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("process-adapter-override"),
      processStartIdentity: "process:test:override",
      processIdentityProbe: { probe: async () => "dead" as const },
      production: false,
      profile: {
        kind: "transitional_unsafe",
        adapters: adapters(new Map()),
        loadPlanningResult: async (effectId) => deterministicPlanningResult(effectId),
        executionProcess: () => ({
          executable: process.execPath,
          argv: ["-e", "process.exit(0)"],
          cwd: process.cwd(),
          env: workerEnvironment()
        })
      }
    })).rejects.toThrow(/process adapters must remain daemon-owned/u);
  });

  physicalIt("reclaims transitional execution resources after the supervised process is physically final", async () => {
    const root = await temporaryRoot();
    const runId = "run:collision:4319";
    const otherRunId = "run:collision:428410";
    const attemptId = "stage3:execution";
    const { repositoryRoot, baseSha } = await initializeRepository(root);
    const runDefinition = definitionForTarget(repositoryRoot, baseSha);
    const orphan = await createOrphanWorktree(repositoryRoot, baseSha, runId);
    const credentialSource = path.join(root, "codex-auth.json");
    await writeFile(credentialSource, "{}", "utf8");
    const windowsJobRunnerPath = await windowsJobRunnerFor(root);
    const processBoundaryAdapters = adapters(new Map()).filter((adapter) =>
      adapter.kind !== "process_spawn" && adapter.kind !== "process_terminate");
    const startCleanupDaemon = (identity: string) => startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("transitional-cleanup"),
      processStartIdentity: `process:test:transitional-cleanup:${identity}`,
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => `daemon:transitional-cleanup:${identity}`,
      clock: () => at,
      production: false,
      ...(windowsJobRunnerPath === undefined ? {} : { windowsJobRunnerPath }),
      profile: {
        kind: "transitional_unsafe" as const,
        adapters: processBoundaryAdapters,
        loadPlanningResult: async (effectId: string) => deterministicPlanningResult(effectId),
        executionProcess: () => ({
          executable: process.execPath,
          argv: ["-e", "process.exit(0)"],
          cwd: process.cwd(),
          env: workerEnvironment()
        })
      }
    });
    let kernel = await startCleanupDaemon("initial");
    try {
      await kernel.startupRecovery;
      const broker = new CredentialBroker({
        rootDirectory: path.join(root, "credential-broker")
      });
      const brokered = await broker.create(
        "leaf:one",
        [{ provider: "codex", sourcePath: credentialSource }],
        executionCredentialScopeId(runId, attemptId)
      );
      const otherBrokered = await broker.create(
        "leaf:one",
        [{ provider: "codex", sourcePath: credentialSource }],
        executionCredentialScopeId(otherRunId, attemptId)
      );
      await kernel.engine.submit(buildRunCommandEnvelope({
        commandId: "command:create:transitional-cleanup",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: { type: "create_run", definition: runDefinition } as unknown as RunCommandPayload
      }, sha256));
      await kernel.drainEffects();
      const projection = await kernel.engine.query(runId);
      const decisionId = Object.values(projection.decisions).find((decision) =>
        decision.kind === "approve_plan" && decision.status === "pending")?.id;
      if (decisionId === undefined) throw new Error("Missing plan approval decision.");
      let spawnEffectId: string | undefined;
      let physicalReceipts: Awaited<ReturnType<typeof readProcessSupervisorReceipts>> | undefined;
      await withTransitionalRepositoryLease({ repoRoot: repositoryRoot, runId: otherRunId }, async () => {
        await kernel.engine.submit(buildRunCommandEnvelope({
          commandId: "command:approve:transitional-cleanup",
          runId,
          expectedRevision: projection.sequence,
          submittedAt: at,
          command: { type: "resolve_decision", decisionId, optionId: "approve" }
        }, sha256));
        await expect(kernel.drainEffects()).rejects.toSatisfy((error: unknown) => (
          error instanceof AggregateError
          && error.errors.some((cause) => (
            cause instanceof Error && /Repository is owned by run/u.test(cause.message)
          ))
        ));

        const blocked = await kernel.engine.query(runId);
        const spawn = Object.values(blocked.effectIntents).find((intent) => intent.kind === "process_spawn");
        expect(spawn).toBeDefined();
        spawnEffectId = spawn!.effectId;
        physicalReceipts = await readProcessSupervisorReceipts(path.join(root, "processes"), spawn!.effectId);
        expect(physicalReceipts).toEqual([
          expect.objectContaining({ phase: "started" }),
          expect.objectContaining({ phase: "final", outcome: "succeeded" })
        ]);
        expect(blocked.effectTerminals[spawn!.effectId]).toBeUndefined();
        expect(await git(repositoryRoot, "worktree", "list", "--porcelain"))
          .toContain(orphan.path.replaceAll("\\", "/"));
      });

      await kernel.close();
      kernel = await startCleanupDaemon("recovered");
      await kernel.startupRecovery;
      await kernel.drainEffects();
      if (spawnEffectId === undefined) throw new Error("Missing physically final spawn effect identity.");
      if (physicalReceipts === undefined) throw new Error("Missing physically final supervisor receipts.");

      const recovered = await kernel.engine.query(runId);
      expect(recovered.effectTerminals[spawnEffectId]).toMatchObject({ status: "completed" });
      expect(await readProcessSupervisorReceipts(path.join(root, "processes"), spawnEffectId))
        .toEqual(physicalReceipts);

      expect(await git(repositoryRoot, "worktree", "list", "--porcelain"))
        .not.toContain(orphan.path.replaceAll("\\", "/"));
      await expect(readFile(path.join(brokered.homeDirectory, ".codex", "auth.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(otherBrokered.homeDirectory, ".codex", "auth.json"), "utf8"))
        .toBe("{}");
    } finally {
      await kernel.close();
    }
  }, 60_000);

  physicalIt("reclaims transitional execution resources after physical cancellation", async () => {
    const root = await temporaryRoot();
    const runId = "run:stage3:transitional-cancel-cleanup";
    const attemptId = "stage3:execution";
    const { repositoryRoot, baseSha } = await initializeRepository(root);
    const orphan = await createOrphanWorktree(repositoryRoot, baseSha, runId);
    const credentialSource = path.join(root, "codex-auth.json");
    await writeFile(credentialSource, "{}", "utf8");
    const windowsJobRunnerPath = await windowsJobRunnerFor(root);
    const kernel = await startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("transitional-cancel-cleanup"),
      processStartIdentity: "process:test:transitional-cancel-cleanup",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:transitional-cancel-cleanup:test",
      clock: () => at,
      production: false,
      ...(windowsJobRunnerPath === undefined ? {} : { windowsJobRunnerPath }),
      profile: {
        kind: "transitional_unsafe",
        adapters: adapters(new Map()).filter((adapter) =>
          adapter.kind !== "process_spawn" && adapter.kind !== "process_terminate"),
        loadPlanningResult: async (effectId) => deterministicPlanningResult(effectId),
        executionProcess: () => ({
          executable: process.execPath,
          argv: ["-e", "setInterval(() => undefined, 1_000)"],
          cwd: process.cwd(),
          env: workerEnvironment(),
          timeoutMs: 30_000
        })
      }
    });
    try {
      await kernel.startupRecovery;
      const brokered = await new CredentialBroker({
        rootDirectory: path.join(root, "credential-broker")
      }).create(
        "leaf:one",
        [{ provider: "codex", sourcePath: credentialSource }],
        executionCredentialScopeId(runId, attemptId)
      );
      await kernel.engine.submit(buildRunCommandEnvelope({
        commandId: "command:create:transitional-cancel-cleanup",
        runId,
        expectedRevision: 0,
        submittedAt: at,
        command: {
          type: "create_run",
          definition: definitionForTarget(repositoryRoot, baseSha)
        } as unknown as RunCommandPayload
      }, sha256));
      await kernel.drainEffects();
      let projection = await kernel.engine.query(runId);
      const decisionId = Object.values(projection.decisions).find((decision) =>
        decision.kind === "approve_plan" && decision.status === "pending")?.id;
      if (decisionId === undefined) throw new Error("Missing plan approval decision.");
      await kernel.engine.submit(buildRunCommandEnvelope({
        commandId: "command:approve:transitional-cancel-cleanup",
        runId,
        expectedRevision: projection.sequence,
        submittedAt: at,
        command: { type: "resolve_decision", decisionId, optionId: "approve" }
      }, sha256));
      const running = await waitForStartedProcess(kernel, root, runId);
      projection = running.projection;

      await kernel.engine.submit(buildRunCommandEnvelope({
        commandId: "command:cancel:transitional-cancel-cleanup",
        runId,
        expectedRevision: projection.sequence,
        submittedAt: at,
        command: { type: "cancel_run", reason: "verify daemon-owned cleanup" }
      }, sha256));
      await kernel.drainEffects();

      expect((await kernel.engine.query(runId)).lifecycle).toBe("interrupted");
      expect(await readProcessSupervisorReceipts(
        path.join(root, "processes"),
        running.spawn.effectId
      )).toEqual([
        expect.objectContaining({ phase: "started" }),
        expect.objectContaining({ phase: "final", outcome: "terminated" })
      ]);
      expect(await git(repositoryRoot, "worktree", "list", "--porcelain"))
        .not.toContain(orphan.path.replaceAll("\\", "/"));
      await expect(readFile(path.join(brokered.homeDirectory, ".codex", "auth.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await kernel.close().catch(() => undefined);
    }
  }, 60_000);
});

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage3",
    userPrompt: "Build deterministic stage three",
    acceptanceCriteria: ["survives restarts"],
    title: "Stage three",
    planningSelection: { executorId: "codex-cli", model: "fake" },
    executionSelection: { executorId: "codex-cli", model: "fake" },
    repairSelection: { executorId: "codex-cli", model: "fake" },
    executionConfig: {},
    targetContext: {
      fingerprint: "target:fingerprint",
      sourceBaseCommit: "0123456789abcdef",
      sourceRealPath: process.cwd()
    }
  };
}

function definitionForTarget(repositoryRoot: string, baseSha: string): ProductRunDefinition {
  return {
    ...definition(),
    targetContext: {
      fingerprint: "target:transitional-cleanup",
      sourceBaseCommit: baseSha,
      sourceBranch: "main",
      sourceRealPath: repositoryRoot
    }
  };
}

function adapters(counts: Map<EffectKind, number>): PhysicalEffectAdapter[] {
  const kinds: EffectKind[] = [
    "model_call", "process_spawn", "process_terminate", "sandbox_create", "git_mutation",
    "artifact_materialize", "validation", "delivery", "cleanup"
  ];
  return kinds.map((kind) => ({
    kind,
    execute: async (intent, context) => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    },
    reconcile: async (intent, context) => {
      if (context.priorReceipts.some((receipt) => receipt.observation !== "started")) return;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    }
  }));
}

function deterministicPlanningResult(effectId: string): RunEventInput[] {
  const suffix = createHash("sha256").update(effectId).digest("hex").slice(0, 16);
  const graphId = `graph:stage3:${suffix}`;
  const decisionId = `approve-plan:${graphId}:r1`;
  return [
    {
      eventId: `planning:${suffix}`,
      occurredAt: at,
      type: "planning.completed",
      payload: { semanticPlan: { id: `plan:stage3:${suffix}`, revision: 1 }, trace: {} }
    },
    {
      eventId: `compiled:${suffix}`,
      occurredAt: at,
      type: "graph.compiled",
      payload: { graphId, revision: 1, graph: {}, contracts: [], review: {}, trace: {} }
    },
    {
      eventId: `proposed:${suffix}`,
      occurredAt: at,
      type: "graph.revision.proposed",
      payload: { graphId, revision: 1 }
    },
    {
      eventId: decisionId,
      occurredAt: at,
      type: "decision.raised",
      payload: {
        decision: {
          id: decisionId,
          kind: "approve_plan",
          question: "Approve deterministic planning result?",
          options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
          affectedNodeIds: ["node:stage3"],
          evidenceRefs: [],
          impact: "architecture",
          raisedAtGraphRevision: 1
        }
      }
    }
  ];
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-product-"));
  roots.push(root);
  return root;
}

async function initializeRepository(root: string): Promise<{
  repositoryRoot: string;
  baseSha: string;
}> {
  const repositoryRoot = path.join(root, "target");
  await mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, "init", "-b", "main");
  await git(repositoryRoot, "config", "user.email", "stage3@example.test");
  await git(repositoryRoot, "config", "user.name", "Stage 3 Test");
  await writeFile(path.join(repositoryRoot, "README.md"), "base\n", "utf8");
  await git(repositoryRoot, "add", "README.md");
  await git(repositoryRoot, "commit", "-m", "base");
  return {
    repositoryRoot,
    baseSha: await git(repositoryRoot, "rev-parse", "HEAD")
  };
}

async function createOrphanWorktree(repositoryRoot: string, baseSha: string, runId: string) {
  return new WorktreeManager({
    git: new SimpleGitRunner(),
    repoRoot: repositoryRoot
  }).create({
    taskId: "leaf:orphaned",
    runId,
    kind: "leaf",
    baseCommit: baseSha
  });
}

async function waitForStartedProcess(
  kernel: Awaited<ReturnType<typeof startProductiveDaemon>>,
  stateRoot: string,
  runId: string
) {
  let last: unknown;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const projection = await kernel.engine.query(runId);
    const spawn = Object.values(projection.effectIntents).find((intent) => intent.kind === "process_spawn");
    if (spawn !== undefined) {
      const receipts = await readProcessSupervisorReceipts(path.join(stateRoot, "processes"), spawn.effectId);
      last = { lifecycle: projection.lifecycle, receipts };
      if (receipts.some((receipt) => receipt.phase === "started")) return { projection, spawn };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Supervised process did not start: ${JSON.stringify(last)}`);
}

async function windowsJobRunnerFor(root: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  const configured = process.env.MANYHANDS_WINDOWS_JOB_RUNNER;
  if (configured !== undefined) return path.resolve(configured);
  const helperPath = path.join(root, "manyhands-windows-job-runner.exe");
  await execFileAsync("rustc.exe", [
    "--edition=2021",
    path.resolve("native/windows-job-runner/src/main.rs"),
    "-O",
    "-o",
    helperPath
  ], { windowsHide: true });
  return helperPath;
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    encoding: "utf8"
  });
  return stdout.trim();
}

function workerEnvironment(): Record<string, string> {
  const names = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"];
  return Object.fromEntries(names.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

function endpointFor(label: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mh-stage3-${label}-${randomUUID()}`
    : path.join(os.tmpdir(), `mh-stage3-${label}-${randomUUID()}.sock`);
}
