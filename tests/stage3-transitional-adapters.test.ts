import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEffectInput,
  buildEffectIntent,
  type DigestHasher,
  type EffectInputSpec,
  type EffectKind,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import { compileGraphRevision } from "@manyhands/decomposer";
import {
  buildRunCommandEnvelope,
  type DeliveryReceipt,
  type ProductRunDefinition,
  type RunCommandPayload,
  type RunEventInput,
  type RunProjection
} from "@manyhands/run-coordinator";
import type {
  PhysicalEffectAdapter,
  PhysicalEffectAdapterContext,
  PhysicalEffectObservationInput
} from "@manyhands/run-engine";
import { JsonlRunEventStore } from "@manyhands/run-store";
import { startProductiveDaemon } from "../apps/daemon/src/productive-daemon.js";
import { resolveDaemonProfile } from "../apps/daemon/src/daemon-profile.js";
import { createCurrentDeliveryPort } from "../apps/daemon/src/current-lifecycle-adapters.js";
import {
  createTransitionalUnsafeProfile,
  type TransitionalLifecycleResult,
  type TransitionalLifecycleResultStore
} from "../apps/daemon/src/transitional-unsafe-profile.js";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures.js";

const roots: string[] = [];
const at = "2026-08-13T05:00:00.000Z";
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Stage 3 transitional unsafe adapters", () => {
  it.each(["model_call", "delivery"] as const)(
    "does not restart invalidated %s recovery when its durable sidecar is absent",
    async (kind) => {
      const harness = await invalidatedRecoveryHarness(kind, false);

      await harness.adapter.reconcile(harness.intent, harness.context);

      expect(harness.plannerPlan).not.toHaveBeenCalled();
      expect(harness.deliveryPublish).not.toHaveBeenCalled();
      expect(harness.records).toEqual([]);
    }
  );

  it.each(["model_call", "delivery"] as const)(
    "adopts an existing %s sidecar even after the intent was invalidated",
    async (kind) => {
      const harness = await invalidatedRecoveryHarness(kind, true);

      await harness.adapter.reconcile(harness.intent, harness.context);

      expect(harness.plannerPlan).not.toHaveBeenCalled();
      expect(harness.deliveryPublish).not.toHaveBeenCalled();
      expect(harness.records).toEqual([expect.objectContaining({
        observation: "succeeded",
        resultDigest: expect.stringMatching(/^sha256:/u)
      })]);
    }
  );

  it("validates canonical delivery metadata and recovers an already published fast-forward", async () => {
    const repository = await deliveryRepository();
    const delivery = createCurrentDeliveryPort();
    const approval = {
      manifestId: "manifest-current",
      finalSha: repository.candidateSha,
      targetBranch: "main",
      targetHead: repository.baseSha,
      targetFingerprint: "target:delivery",
      actor: "operator",
      idempotencyKey: "delivery-current"
    };
    const definition = {
      ...definitionForTarget(repository.root, repository.baseSha),
      targetContext: {
        ...definitionForTarget(repository.root, repository.baseSha).targetContext,
        fingerprint: approval.targetFingerprint
      }
    };
    const projection = deliveryProjection({
      approval,
      candidateSha: repository.candidateSha,
      treeSha: repository.treeSha
    });
    const invalid = [
      withProjection(projection, (value) => { value.finalCandidate!.finalManifest!.commitSha = "wrong"; }),
      withProjection(projection, (value) => { value.approvedGraphRevision = 2; }),
      withProjection(projection, (value) => {
        value.evidenceMatrixSummaries["matrix-current"]!.validationRecipeDigest = "sha256:wrong";
      }),
      withProjection(projection, (value) => { value.adoptedArtifacts = {}; }),
      withProjection(projection, (value) => { value.finalCandidate!.finalManifest!.treeSha = "wrong"; })
    ];
    for (const candidate of invalid) {
      await expect(delivery.publish({
        runId: "run:delivery",
        definition,
        approval,
        projection: candidate,
        events: []
      })).rejects.toThrow();
      expect(await git(repository.root, "rev-parse", "HEAD")).toBe(repository.baseSha);
    }

    const first = await delivery.publish({
      runId: "run:delivery",
      definition,
      approval,
      projection,
      events: []
    });
    expect(first).toMatchObject({
      requestFingerprint: expect.any(String),
      finalSha: repository.candidateSha,
      targetHeadBefore: repository.baseSha,
      targetHeadAfter: repository.candidateSha,
      disposition: "delivered",
      confirmed: true
    });
    expect(await git(repository.root, "rev-parse", "HEAD")).toBe(repository.candidateSha);

    const recovered = await delivery.publish({
      runId: "run:delivery",
      definition,
      approval,
      projection,
      events: []
    });
    expect(recovered).toEqual(first);
  });

  it("is explicitly reachable from the CLI profile composition without invoking a model", () => {
    const stateRoot = path.resolve(".manyhands", "stage3-profile-test");
    const workerScriptPath = path.resolve(
      "apps/daemon/dist/transitional-unsafe-worker.js"
    );
    const resolved = resolveDaemonProfile({
      stateRoot,
      daemonDirectory: path.resolve("apps/daemon/dist"),
      cwd: process.cwd(),
      nodeExecutable: process.execPath,
      env: {
        MANYHANDS_DAEMON_PROFILE: "transitional_unsafe",
        MANYHANDS_TRANSITIONAL_WORKER_SCRIPT: workerScriptPath
      }
    });

    expect(resolved.name).toBe("transitional_unsafe");
    expect(resolved.profile.kind).toBe("transitional_unsafe");
    if (resolved.profile.kind !== "transitional_unsafe") {
      throw new Error("Expected the explicit transitional profile.");
    }
    expect(resolved.profile.adapters.map((adapter) => adapter.kind)).toEqual(
      expect.arrayContaining(["model_call", "delivery"])
    );
    expect(resolved.profile.executionProcess(definition(), {
      runId: "run:profile",
      attemptId: "stage3:execution"
    })).toMatchObject({
      executable: path.resolve(process.execPath),
      argv: [
        workerScriptPath,
        "--state-root", stateRoot,
        "--run-id", "run:profile",
        "--attempt-id", "stage3:execution"
      ]
    });
  });

  it("preserves current planning, execution evidence, candidate and delivery outputs", async () => {
    const root = await temporaryRoot();
    const runId = "run:stage3:transitional";
    const store = new MemoryLifecycleResultStore();
    await store.writeExecution(runId, "stage3:execution", executionResult());
    let planningCalls = 0;
    let deliveryCalls = 0;
    const profile = createTransitionalUnsafeProfile({
      stateRoot: root,
      nodeExecutable: process.execPath,
      workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
      cwd: process.cwd(),
      resultStore: store,
      planner: {
        async plan(input) {
          planningCalls += 1;
          expect(input.definition.userPrompt).toBe("Exercise the current lifecycle adapters");
          return planningResult();
        }
      },
      delivery: {
        async publish(input) {
          deliveryCalls += 1;
          expect(input.approval.manifestId).toBe("manifest-current");
          return deliveredReceipt();
        }
      },
      executionProcess: () => ({
        executable: process.execPath,
        argv: ["-e", ""],
        cwd: process.cwd(),
        env: {}
      }),
      processAdapters: successfulProcessAdapters()
    });
    expect(profile.kind).toBe("transitional_unsafe");

    const kernel = await startProductiveDaemon({
      stateRoot: root,
      endpoint: endpointFor("transitional"),
      processStartIdentity: "process:transitional:test",
      processIdentityProbe: { probe: async () => "dead" as const },
      createDaemonEpoch: () => "daemon:transitional:test",
      clock: () => at,
      production: false,
      profile
    });
    try {
      await kernel.engine.submit(command("command:create", runId, 0, {
        type: "create_run",
        definition: definition()
      }));
      await kernel.drainEffects();
      expect(planningCalls).toBe(1);
      let projection = await kernel.engine.query(runId);
      expect(projection.lifecycle).toBe("needs_approval");
      const compiled = (await kernel.eventStore.load(runId)).find((event) => event.type === "graph.compiled");
      expect(compiled?.type).toBe("graph.compiled");
      if (compiled?.type !== "graph.compiled") throw new Error("Missing compiled graph event.");
      expect(compiled.payload.contracts.length).toBeGreaterThan(1);
      expect((compiled.payload.graph as { seamBindings?: unknown[] }).seamBindings?.length).toBeGreaterThan(0);
      expect((compiled.payload.graph as { artifactRequirements?: unknown[] }).artifactRequirements?.length).toBeGreaterThan(0);

      const decision = Object.values(projection.decisions).find((item) =>
        item.kind === "approve_plan" && item.status === "pending");
      if (decision === undefined) throw new Error("Missing plan approval decision.");
      await kernel.engine.submit(command("command:approve", runId, projection.sequence, {
        type: "resolve_decision",
        decisionId: decision.id,
        optionId: "approve"
      }));
      await kernel.drainEffects();
      projection = await kernel.engine.query(runId);
      expect(projection).toMatchObject({
        lifecycle: "result_ready",
        outcomes: { execution: "succeeded", artifact: "verified", delivery: "ready" },
        finalCandidate: {
          manifestId: "manifest-current",
          commit: "candidate-current",
          evidenceMatrixId: "matrix-current"
        }
      });

      await kernel.engine.submit(command("command:deliver", runId, projection.sequence, {
        type: "deliver_run",
        approval: approval()
      }));
      await kernel.drainEffects();
      expect(deliveryCalls).toBe(1);
      expect(await kernel.engine.query(runId)).toMatchObject({
        lifecycle: "completed",
        deliveryReceipt: deliveredReceipt()
      });
    } finally {
      await kernel.close();
    }
  });
});

class MemoryLifecycleResultStore implements TransitionalLifecycleResultStore {
  private readonly planning = new Map<string, TransitionalLifecycleResult>();
  private readonly execution = new Map<string, TransitionalLifecycleResult>();
  private readonly delivery = new Map<string, DeliveryReceipt>();

  async writePlanning(effectId: string, result: TransitionalLifecycleResult): Promise<void> {
    this.planning.set(effectId, structuredClone(result));
  }

  async readPlanning(effectId: string): Promise<TransitionalLifecycleResult | undefined> {
    return structuredClone(this.planning.get(effectId));
  }

  async writeExecution(runId: string, attemptId: string, result: TransitionalLifecycleResult): Promise<void> {
    this.execution.set(`${runId}:${attemptId}`, structuredClone(result));
  }

  async readExecution(runId: string, attemptId: string): Promise<TransitionalLifecycleResult | undefined> {
    return structuredClone(this.execution.get(`${runId}:${attemptId}`));
  }

  async writeDelivery(effectId: string, receipt: DeliveryReceipt): Promise<void> {
    this.delivery.set(effectId, structuredClone(receipt));
  }

  async readDelivery(effectId: string): Promise<DeliveryReceipt | undefined> {
    return structuredClone(this.delivery.get(effectId));
  }
}

function planningResult(): TransitionalLifecycleResult {
  const snapshot = bookingSnapshot();
  const breakdown = bookingBreakdown();
  const compiled = compileGraphRevision({ breakdown, repositorySnapshot: snapshot }, compilerDependencies);
  const graph = compiled.graph;
  const decisionId = `approve-plan:${graph.graphId}:r${graph.revision}`;
  return {
    events: [
      input("repository.inspected", {
        snapshotId: snapshot.snapshotId,
        disposition: snapshot.inspectionDisposition,
        snapshot: snapshot as unknown as Record<string, unknown>
      }),
      input("planning.completed", {
        breakdownId: breakdown.breakdownId,
        breakdown: breakdown as unknown as Record<string, unknown>
      }),
      input("graph.compiled", {
        graphId: graph.graphId,
        revision: graph.revision,
        graph: graph as unknown as Record<string, unknown>,
        contracts: compiled.contracts as unknown as Array<Record<string, unknown>>,
        review: compiled.review as unknown as Record<string, unknown>,
        trace: compiled.trace as unknown as Record<string, unknown>
      }),
      input("graph.revision.proposed", { graphId: graph.graphId, revision: graph.revision }),
      input("decision.raised", {
        decision: {
          id: decisionId,
          kind: "approve_plan",
          question: "Approve the current compiled graph?",
          options: [{ id: "approve", label: "Approve plan" }, { id: "request_changes", label: "Request changes" }],
          affectedNodeIds: [graph.rootId],
          evidenceRefs: [`graph:${graph.graphId}:r${graph.revision}`],
          impact: "acceptance"
        }
      })
    ]
  };
}

function executionResult(): TransitionalLifecycleResult {
  return {
    events: [
      input("evidence.matrix_recorded", { matrix: verifiedMatrix() }),
      input("final_candidate.verified", {
        manifestId: "manifest-current",
        commit: "candidate-current",
        evidenceMatrixId: "matrix-current",
        evidenceEligible: true,
        executionSucceeded: true,
        sourceTargetFingerprint: "target:current",
        targetBranch: "main",
        targetHead: "base-current",
        finalManifest: {
          commitSha: "candidate-current",
          treeSha: "tree-current",
          graphRevision: 1,
          artifactIds: ["artifact-current"],
          evidenceMatrixId: "matrix-current",
          validationRecipeDigest: "sha256:recipe-current",
          deliveryTarget: "main"
        }
      })
    ]
  };
}

function verifiedMatrix() {
  return {
    matrixId: "matrix-current",
    candidateCommit: "candidate-current",
    validationContract: { id: "validation-current", revision: "revision-1" },
    criteria: [{
      criterionId: "criterion-current",
      obligationId: "obligation-current",
      status: "satisfied" as const,
      justification: "The current validator checked the exact candidate.",
      evidenceRefs: ["evidence-current"]
    }],
    outcome: "verified" as const,
    validationRecipeDigest: "sha256:recipe-current",
    observations: []
  };
}

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:transitional",
    userPrompt: "Exercise the current lifecycle adapters",
    acceptanceCriteria: ["preserve current outputs"],
    title: "Transitional adapters",
    planningSelection: { executorId: "codex-cli", model: "gpt-current" },
    executionSelection: { executorId: "codex-cli", model: "gpt-current" },
    repairSelection: { executorId: "codex-cli", model: "gpt-current" },
    executionConfig: {},
    targetContext: {
      fingerprint: "target:current",
      sourceBaseCommit: "base-current",
      sourceBranch: "main",
      sourceRealPath: process.cwd()
    }
  };
}

function approval() {
  return {
    manifestId: "manifest-current",
    finalSha: "candidate-current",
    targetBranch: "main",
    targetHead: "base-current",
    targetFingerprint: "target:current",
    actor: "operator",
    idempotencyKey: "delivery-current"
  };
}

function deliveredReceipt(): DeliveryReceipt {
  return {
    receiptId: "receipt-current",
    manifestId: "manifest-current",
    finalSha: "candidate-current",
    targetBranch: "main",
    targetHeadBefore: "base-current",
    targetHeadAfter: "candidate-current",
    disposition: "delivered",
    destination: "main",
    confirmed: true
  };
}

function successfulProcessAdapters(): PhysicalEffectAdapter[] {
  const kinds: EffectKind[] = ["process_spawn", "process_terminate"];
  return kinds.map((kind) => ({
    kind,
    execute: async (intent, context) => {
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    },
    reconcile: async (intent, context) => {
      if (context.priorReceipts.some((receipt) => receipt.observation !== "started")) return;
      await context.record({
        observation: "succeeded",
        resultDigest: sha256(`${kind}:${intent.effectId}`),
        observedAt: at
      });
    }
  }));
}

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
    submittedAt: at,
    command: payload as unknown as RunCommandPayload
  }, sha256);
}

function input<T extends RunEventInput["type"]>(
  type: T,
  payload: Extract<RunEventInput, { type: T }>["payload"]
): Extract<RunEventInput, { type: T }> {
  return {
    eventId: `transitional:${type}:${randomUUID()}`,
    occurredAt: at,
    type,
    payload
  } as Extract<RunEventInput, { type: T }>;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-stage3-transitional-"));
  roots.push(root);
  return root;
}

async function invalidatedRecoveryHarness(
  kind: "model_call" | "delivery",
  withSidecar: boolean
) {
  const root = await temporaryRoot();
  const recoveryRunId = `run:stage3:invalidated:${kind}`;
  const store = new MemoryLifecycleResultStore();
  const plannerPlan = vi.fn(async () => planningResult());
  const deliveryPublish = vi.fn(async () => deliveredReceipt());
  const profile = createTransitionalUnsafeProfile({
    stateRoot: root,
    nodeExecutable: process.execPath,
    workerScriptPath: path.resolve("apps/daemon/dist/transitional-unsafe-worker.js"),
    cwd: process.cwd(),
    resultStore: store,
    planner: { plan: plannerPlan },
    delivery: { publish: deliveryPublish }
  });
  const adapter = profile.adapters.find((candidate) => candidate.kind === kind);
  if (adapter === undefined) throw new Error(`Missing ${kind} adapter.`);
  const effect = recoveryEffect(kind, recoveryRunId);
  await seedRecoveryRun(root, recoveryRunId, kind);
  if (withSidecar) {
    if (kind === "model_call") {
      await store.writePlanning(effect.intent.effectId, planningResult());
    } else {
      await store.writeDelivery(effect.intent.effectId, deliveredReceipt());
    }
  }
  const records: PhysicalEffectObservationInput[] = [];
  const context: PhysicalEffectAdapterContext = {
    observerDaemonEpoch: "daemon:stage3:recovery",
    inputSpec: effect.inputSpec,
    priorReceipts: [],
    invalidationReason: async () => "operation.cancel_requested is durable",
    async record(observation) {
      records.push(structuredClone(observation));
      return {} as PhysicalEffectReceipt;
    }
  };
  return {
    adapter,
    intent: effect.intent,
    context,
    records,
    plannerPlan,
    deliveryPublish
  };
}

function recoveryEffect(kind: "model_call" | "delivery", runId: string) {
  const inputSpec: EffectInputSpec = kind === "model_call"
    ? {
        schemaVersion: 1,
        kind,
        payload: {
          repositoryViewDigest: sha256("repository"),
          requestDigest: sha256("request"),
          modelProfileDigest: sha256("model")
        }
      }
    : {
        schemaVersion: 1,
        kind,
        payload: {
          destinationRef: "main",
          expectedHeadSha: "base-current",
          expectedTreeSha: "tree-current",
          candidateCommitSha: "candidate-current",
          candidateTreeSha: "tree-current"
        }
      };
  return {
    inputSpec,
    intent: buildEffectIntent({
      runId,
      attemptId: kind === "model_call" ? "stage3:planning" : "stage3:delivery",
      kind,
      inputDigest: buildEffectInput(inputSpec, sha256).inputDigest,
      daemonEpoch: "daemon:stage3:original",
      idempotency: "reconcile_then_repeat",
      requestedAt: at
    }, sha256)
  };
}

async function seedRecoveryRun(
  root: string,
  runId: string,
  kind: "model_call" | "delivery"
): Promise<void> {
  const events = new JsonlRunEventStore({ directory: path.join(root, "runs") });
  const authority = { operationId: "test:invalidated-recovery", fencingToken: 1 };
  await events.advanceFence(runId, authority);
  const initial: RunEventInput[] = [{
    eventId: `${runId}:created`,
    occurredAt: at,
    type: "run.created",
    payload: { goal: definition().userPrompt, definition: definition() }
  }];
  if (kind === "delivery") {
    initial.push(
      input("graph.revision.proposed", { graphId: "graph-current", revision: 1 }),
      input("graph.revision.approved", { graphId: "graph-current", revision: 1 }),
      input("evidence.matrix_recorded", { matrix: verifiedMatrix() }),
      ...executionResult().events.filter((event) => event.type === "final_candidate.verified"),
      input("delivery.started", { approval: approval() })
    );
  }
  await events.appendFenced(runId, 0, authority, initial);
}

async function deliveryRepository(): Promise<{
  root: string;
  baseSha: string;
  candidateSha: string;
  treeSha: string;
}> {
  const root = await temporaryRoot();
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "stage3@example.test");
  await git(root, "config", "user.name", "Stage 3 Test");
  // Delivery must inspect the target under its native line-ending policy.  The
  // artifact policy deliberately fixes autocrlf=false, which would otherwise
  // misclassify this clean checkout as dirty on Windows.
  await git(root, "config", "core.autocrlf", "true");
  await writeFile(path.join(root, "result.txt"), "base\n", "utf8");
  await git(root, "add", "result.txt");
  await git(root, "commit", "-m", "base");
  const baseSha = await git(root, "rev-parse", "HEAD");
  await git(root, "checkout", "-b", "candidate");
  await writeFile(path.join(root, "result.txt"), "candidate\n", "utf8");
  await git(root, "add", "result.txt");
  await git(root, "commit", "-m", "candidate");
  const candidateSha = await git(root, "rev-parse", "HEAD");
  const treeSha = await git(root, "rev-parse", `${candidateSha}^{tree}`);
  await git(root, "checkout", "main");
  return { root, baseSha, candidateSha, treeSha };
}

function definitionForTarget(root: string, baseSha: string): ProductRunDefinition {
  return {
    ...definition(),
    targetContext: {
      fingerprint: "target:delivery",
      sourceBaseCommit: baseSha,
      sourceBranch: "main",
      sourceRealPath: root
    }
  };
}

function deliveryProjection(input: {
  approval: ReturnType<typeof approval>;
  candidateSha: string;
  treeSha: string;
}): RunProjection {
  return {
    approvedGraphRevision: 1,
    deliveryApproval: input.approval,
    finalCandidate: {
      manifestId: input.approval.manifestId,
      commit: input.candidateSha,
      evidenceMatrixId: "matrix-current",
      sourceTargetFingerprint: input.approval.targetFingerprint,
      targetBranch: input.approval.targetBranch,
      targetHead: input.approval.targetHead,
      evidenceEligible: true,
      finalManifest: {
        commitSha: input.candidateSha,
        treeSha: input.treeSha,
        graphRevision: 1,
        artifactIds: ["artifact-current"],
        evidenceMatrixId: "matrix-current",
        validationRecipeDigest: "sha256:recipe-current",
        deliveryTarget: "main"
      }
    },
    evidenceMatrixSummaries: {
      "matrix-current": {
        candidateCommit: input.candidateSha,
        outcome: "verified",
        validationRecipeDigest: "sha256:recipe-current"
      }
    },
    adoptedArtifacts: {
      "artifact-instance": {
        contract: { id: "artifact-current", revision: "revision-1" }
      }
    }
  } as unknown as RunProjection;
}

function withProjection(
  source: RunProjection,
  mutate: (projection: RunProjection) => void
): RunProjection {
  const copy = structuredClone(source);
  mutate(copy);
  return copy;
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    encoding: "utf8"
  });
  return stdout.trim();
}

function endpointFor(label: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mh-stage3-${label}-${randomUUID()}`
    : path.join(os.tmpdir(), `mh-stage3-${label}-${randomUUID()}.sock`);
}
