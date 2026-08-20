import { createHash } from "node:crypto";
import path from "node:path";

import {
  computeCanonicalDigest,
  type DigestHasher,
  type EffectIntent,
  type EffectKind
} from "@manyhands/contracts";
import {
  ProcessSupervisor,
  SimpleGitRunner,
  WorktreeManager,
  type ProcessSupervisorFinalReceipt,
  ProcessSupervisorStartedReceiptSchema,
  discardBrokeredCredentialScope
} from "@manyhands/execution-core";
import {
  foldRun,
  type DeliveryReceipt,
  type IpcCapabilityOsProtection,
  type ProductRunDefinition,
  type RunEventInput
} from "@manyhands/run-coordinator";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";
import { JsonlRunEventStore } from "@manyhands/run-store";

import {
  startDaemonKernel,
  type DaemonKernel
} from "./daemon-kernel.js";
import type { ProcessIdentityProbe } from "./installation-lease.js";
import {
  createProcessSpawnPhysicalEffectAdapter,
  createProcessTerminatePhysicalEffectAdapter,
  executionCredentialScopeId
} from "./process-effect-adapters.js";
import {
  createProductRunApplication,
  type ActiveProductProcess
} from "./product-run-application.js";
import { withTransitionalRepositoryLease } from "./transitional-repository-lease.js";

export interface DeterministicFakeExecutionProfile {
  readonly kind: "deterministic_fake";
  readonly nodeExecutable: string;
  readonly workerScriptPath: string;
  readonly cwd: string;
  readonly pidEvidencePath?: string;
  readonly timeoutMs?: number;
}

export interface TransitionalUnsafeExecutionProfile {
  readonly kind: "transitional_unsafe";
  readonly adapters: readonly PhysicalEffectAdapter[];
  executionProcess(definition: ProductRunDefinition, context?: {
    runId: string;
    attemptId: string;
  }): {
    executable: string;
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs?: number;
  };
  /** Every transitional model effect must expose the durable facts the actor appends. */
  loadPlanningResult(effectId: string): Promise<readonly RunEventInput[]>;
  loadExecutionResult?(runId: string, attemptId: string): Promise<readonly RunEventInput[]>;
  loadDeliveryResult?(effectId: string): Promise<DeliveryReceipt>;
}

export interface SandboxedLiveExecutionProfile {
  readonly kind: "sandboxed_live";
  readonly adapters: readonly PhysicalEffectAdapter[];
  executionProcess: TransitionalUnsafeExecutionProfile["executionProcess"];
  loadPlanningResult: TransitionalUnsafeExecutionProfile["loadPlanningResult"];
  loadExecutionResult?: TransitionalUnsafeExecutionProfile["loadExecutionResult"];
  loadDeliveryResult?: TransitionalUnsafeExecutionProfile["loadDeliveryResult"];
}

export type ProductiveDaemonProfile =
  | DeterministicFakeExecutionProfile
  | TransitionalUnsafeExecutionProfile
  | SandboxedLiveExecutionProfile;

export interface StartProductiveDaemonOptions {
  readonly stateRoot: string;
  readonly endpoint: string;
  readonly processStartIdentity: string;
  readonly processIdentityProbe: ProcessIdentityProbe;
  readonly profile: ProductiveDaemonProfile;
  readonly windowsJobRunnerPath?: string;
  readonly production?: boolean;
  readonly protectCapabilityPath?: IpcCapabilityOsProtection;
  readonly assertOsRestrictedCapabilityPath?: IpcCapabilityOsProtection;
  readonly windowsPipeAclHelperPath?: string;
  readonly createDaemonEpoch?: () => string;
  readonly clock?: () => string;
  readonly ipcNow?: () => number;
  readonly onIpcError?: (error: Error) => void;
}

/** Productive Stage 3 composition: application policy + actors + physical adapters. */
export async function startProductiveDaemon(
  options: StartProductiveDaemonOptions
): Promise<DaemonKernel> {
  assertDaemonOwnedProcessAdapters(options.profile);
  const clock = options.clock ?? (() => new Date().toISOString());
  const processSupervisor = new ProcessSupervisor({
    receiptRoot: path.join(options.stateRoot, "processes"),
    ...(options.windowsJobRunnerPath === undefined
      ? {}
      : { windowsJobRunnerPath: options.windowsJobRunnerPath })
  });
  const hasher = sha256Digest;
  const liveProfile = options.profile.kind === "deterministic_fake"
    ? undefined
    : options.profile;
  const liveRunEvents = liveProfile === undefined
    ? undefined
    : new JsonlRunEventStore({ directory: path.join(options.stateRoot, "runs") });
  const liveGcTasks = new Map<string, Promise<void>>();
  const cleanupExecutionRunOnce = liveRunEvents === undefined
    ? undefined
    : async (runId: string) => {
      const active = liveGcTasks.get(runId);
      if (active !== undefined) return active;
      const cleanup = cleanupExecutionRun(liveRunEvents, runId);
      liveGcTasks.set(runId, cleanup);
      try {
        await cleanup;
      } finally {
        if (liveGcTasks.get(runId) === cleanup) liveGcTasks.delete(runId);
      }
    };
  const cleanupLiveExecution = cleanupExecutionRunOnce === undefined
    ? undefined
    : async (runId: string, attemptId: string) => {
      const failures: unknown[] = [];
      try {
        await discardBrokeredCredentialScope(
          path.join(options.stateRoot, "credential-broker"),
          executionCredentialScopeId(runId, attemptId)
        );
      } catch (error) {
        failures.push(error);
      }
      try {
        await cleanupExecutionRunOnce(runId);
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, `Failed to reclaim execution resources for ${runId}/${attemptId}.`);
      }
    };
  const adapters = options.profile.kind === "deterministic_fake"
    ? deterministicAdapters(processSupervisor, hasher, clock)
    : transitionalAdapters(
      options.profile.adapters,
      processSupervisor,
      cleanupLiveExecution === undefined
        ? undefined
        : async (intent) => {
          if (intent.attemptId === undefined) throw new Error("Live process has no attempt identity.");
          await cleanupLiveExecution(intent.runId, intent.attemptId);
        },
      cleanupLiveExecution === undefined
        ? undefined
        : async (runId, attemptId) => cleanupLiveExecution(runId, attemptId)
    );
  const baseExecutionProcess = executionProcessFor(options.profile);
  const executionProcess: TransitionalUnsafeExecutionProfile["executionProcess"] = liveProfile === undefined
    ? baseExecutionProcess
    : (definition, context) => {
      if (context === undefined) throw new Error("Live execution requires run and attempt identity.");
      const invocation = baseExecutionProcess(definition, context);
      return {
        ...invocation,
        env: {
          ...invocation.env,
          MANYHANDS_STAGE8_SANDBOX_SCOPE: executionCredentialScopeId(context.runId, context.attemptId)
        }
      };
    };
  const application = createProductRunApplication({
    hasher,
    clock,
    executionProcess,
    recoverInterruptedExecution: options.profile.kind === "deterministic_fake",
    ...(options.profile.kind === "sandboxed_live"
      ? { recoverInterruptedExecutionReason: "reconcile_interrupted_process_spawn" }
      : {}),
    ...(options.profile.kind === "deterministic_fake"
      ? { loadPlanningResult: async (effectId: string) => deterministicPlanningResult(effectId, clock) }
      : {}),
    ...(options.profile.kind !== "deterministic_fake"
      ? { loadPlanningResult: options.profile.loadPlanningResult }
      : {}),
    ...(options.profile.kind === "deterministic_fake" || options.profile.loadExecutionResult === undefined
      ? {}
      : { loadExecutionResult: options.profile.loadExecutionResult }),
    ...(options.profile.kind === "deterministic_fake" || options.profile.loadDeliveryResult === undefined
      ? {}
      : { loadDeliveryResult: options.profile.loadDeliveryResult }),
    activeProcesses: async (_runId, projection) => {
      const active: ActiveProductProcess[] = [];
      for (const intent of Object.values(projection.effectIntents)) {
        if (intent.kind !== "process_spawn") continue;
        const receipts = await processSupervisor.readReceipts(intent.effectId);
        const startedRaw = receipts.find((receipt) =>
          typeof receipt === "object" && receipt !== null && "phase" in receipt && receipt.phase === "started");
        const finalRaw = receipts.find((receipt) =>
          typeof receipt === "object" && receipt !== null && "phase" in receipt && receipt.phase === "final");
        if (startedRaw === undefined || finalRaw !== undefined) continue;
        const started = ProcessSupervisorStartedReceiptSchema.parse(startedRaw);
        active.push({
          effectId: intent.effectId,
          identity: started.processIdentity,
          ...(intent.attemptId === undefined ? {} : { attemptId: intent.attemptId })
        });
      }
      return active;
    }
  });

  return startDaemonKernel({
    stateRoot: options.stateRoot,
    endpoint: options.endpoint,
    processStartIdentity: options.processStartIdentity,
    processIdentityProbe: options.processIdentityProbe,
    hasher,
    adapters,
    decide: application.decide,
    react: application.react,
    clock,
    ...(options.production === undefined ? {} : { production: options.production }),
    ...(options.protectCapabilityPath === undefined
      ? {}
      : { protectCapabilityPath: options.protectCapabilityPath }),
    ...(options.assertOsRestrictedCapabilityPath === undefined
      ? {}
      : { assertOsRestrictedCapabilityPath: options.assertOsRestrictedCapabilityPath }),
    ...(options.windowsPipeAclHelperPath === undefined
      ? {}
      : { windowsPipeAclHelperPath: options.windowsPipeAclHelperPath }),
    ...(options.createDaemonEpoch === undefined ? {} : { createDaemonEpoch: options.createDaemonEpoch }),
    ...(options.ipcNow === undefined ? {} : { ipcNow: options.ipcNow }),
    ...(options.onIpcError === undefined ? {} : { onIpcError: options.onIpcError })
  });
}

function transitionalAdapters(
  configured: readonly PhysicalEffectAdapter[],
  processSupervisor: ProcessSupervisor,
  afterTerminal?: (intent: EffectIntent, final: ProcessSupervisorFinalReceipt) => Promise<void>,
  afterTermination?: (runId: string, attemptId: string, final: ProcessSupervisorFinalReceipt) => Promise<void>
): PhysicalEffectAdapter[] {
  return [
    createProcessSpawnPhysicalEffectAdapter({
      supervisor: processSupervisor,
      ...(afterTerminal === undefined ? {} : { afterTerminal })
    }),
    createProcessTerminatePhysicalEffectAdapter({
      supervisor: processSupervisor,
      ...(afterTermination === undefined ? {} : { afterTermination })
    }),
    ...configured
  ];
}

function assertDaemonOwnedProcessAdapters(profile: ProductiveDaemonProfile): void {
  if (profile.kind === "deterministic_fake") return;
  const configured = profile.adapters
    .filter((adapter) => adapter.kind === "process_spawn" || adapter.kind === "process_terminate")
    .map((adapter) => adapter.kind);
  if (configured.length > 0) {
    throw new Error(
      `Live process adapters must remain daemon-owned; configured overrides are forbidden: ${configured.join(", ")}.`
    );
  }
}

async function cleanupExecutionRun(events: JsonlRunEventStore, runId: string): Promise<void> {
  const projection = foldRun(await events.load(runId));
  if (projection.definition === undefined) {
    throw new Error(`Run ${runId} has no immutable definition for execution cleanup.`);
  }
  const sourceRealPath = projection.definition.targetContext.sourceRealPath;
  if (typeof sourceRealPath !== "string") {
    throw new Error(`Run ${runId} has no targetContext.sourceRealPath for execution cleanup.`);
  }
  const repoRoot = assertAbsolute(sourceRealPath, "targetContext.sourceRealPath");
  const sweep = await withTransitionalRepositoryLease({ repoRoot, runId }, async () => (
    new WorktreeManager({
      git: new SimpleGitRunner(),
      repoRoot
    }).gcRun(runId)
  ));
  if (sweep.failed.length > 0) {
    throw new Error(`Run ${runId} retained worktrees: ${sweep.failed.join(", ")}.`);
  }
}

function executionProcessFor(profile: ProductiveDaemonProfile): TransitionalUnsafeExecutionProfile["executionProcess"] {
  if (profile.kind !== "deterministic_fake") return profile.executionProcess;
  const executable = assertAbsolute(profile.nodeExecutable, "fake node executable");
  const worker = assertAbsolute(profile.workerScriptPath, "fake worker script");
  const cwd = assertAbsolute(profile.cwd, "fake worker cwd");
  return () => ({
    executable,
    argv: [worker],
    cwd,
    env: {
      ...(process.platform === "win32"
        ? {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR })
        }
        : {}),
      ...(profile.pidEvidencePath === undefined
        ? {}
        : { MANYHANDS_FAKE_PID_EVIDENCE: assertAbsolute(profile.pidEvidencePath, "fake PID evidence path") })
    },
    ...(profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs })
  });
}

function deterministicAdapters(
  processSupervisor: ProcessSupervisor,
  hasher: DigestHasher,
  clock: () => string
): PhysicalEffectAdapter[] {
  const processKinds = [
    createProcessSpawnPhysicalEffectAdapter({ supervisor: processSupervisor }),
    createProcessTerminatePhysicalEffectAdapter({ supervisor: processSupervisor })
  ];
  const otherKinds: EffectKind[] = [
    "model_call",
    "sandbox_create",
    "git_mutation",
    "artifact_materialize",
    "validation",
    "delivery",
    "cleanup"
  ];
  return [
    ...processKinds,
    ...otherKinds.map((kind): PhysicalEffectAdapter => ({
      kind,
      execute: async (intent, context) => {
        await context.record({
          observation: "succeeded",
          resultDigest: computeCanonicalDigest({ kind, effectId: intent.effectId }, hasher),
          observedAt: clock()
        });
      },
      reconcile: async (intent, context) => {
        if (context.priorReceipts.some((receipt) => receipt.observation !== "started")) return;
        await context.record({
          observation: "succeeded",
          resultDigest: computeCanonicalDigest({ kind, effectId: intent.effectId }, hasher),
          observedAt: clock()
        });
      }
    }))
  ];
}

/**
 * The deterministic GR profile has no model provider, but it must still return
 * canonical planning facts for the actor to append after the model-call receipt.
 * Keeping this result deterministic makes restart/replay observe the same plan
 * without granting the physical adapter lifecycle-writing authority.
 */
function deterministicPlanningResult(effectId: string, clock: () => string): readonly RunEventInput[] {
  const suffix = createHash("sha256").update(effectId).digest("hex").slice(0, 16);
  const graphId = `graph:deterministic:${suffix}`;
  const decisionId = `approve-plan:${graphId}:r1`;
  const at = clock();
  const eventId = (kind: string) => `deterministic:${suffix}:${kind}`;
  return [
    {
      eventId: eventId("planning-completed"),
      occurredAt: at,
      type: "planning.completed",
      payload: { semanticPlan: { id: `plan:deterministic:${suffix}`, revision: 1 }, trace: {} }
    },
    {
      eventId: eventId("graph-compiled"),
      occurredAt: at,
      type: "graph.compiled",
      payload: { graphId, revision: 1, graph: {}, contracts: [], review: {}, trace: {} }
    },
    {
      eventId: eventId("graph-proposed"),
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
          options: [
            { id: "approve", label: "Approve" },
            { id: "reject", label: "Reject" }
          ],
          affectedNodeIds: ["node:deterministic"],
          evidenceRefs: [],
          impact: "architecture",
          raisedAtGraphRevision: 1
        }
      }
    }
  ];
}

function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertAbsolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path.`);
  return path.resolve(value);
}
