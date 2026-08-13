import { createHash } from "node:crypto";
import path from "node:path";

import {
  computeCanonicalDigest,
  type DigestHasher,
  type EffectKind
} from "@manyhands/contracts";
import {
  ProcessSupervisor,
  ProcessSupervisorStartedReceiptSchema
} from "@manyhands/execution-core";
import type {
  DeliveryReceipt,
  IpcCapabilityOsProtection,
  ProductRunDefinition,
  RunEventInput
} from "@manyhands/run-coordinator";
import type { PhysicalEffectAdapter } from "@manyhands/run-engine";

import {
  startDaemonKernel,
  type DaemonKernel
} from "./daemon-kernel.js";
import type { ProcessIdentityProbe } from "./installation-lease.js";
import {
  createProcessSpawnPhysicalEffectAdapter,
  createProcessTerminatePhysicalEffectAdapter
} from "./process-effect-adapters.js";
import {
  createProductRunApplication,
  type ActiveProductProcess
} from "./product-run-application.js";

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
  loadPlanningResult?(effectId: string): Promise<readonly RunEventInput[]>;
  loadExecutionResult?(runId: string, attemptId: string): Promise<readonly RunEventInput[]>;
  loadDeliveryResult?(effectId: string): Promise<DeliveryReceipt>;
}

export type ProductiveDaemonProfile =
  | DeterministicFakeExecutionProfile
  | TransitionalUnsafeExecutionProfile;

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
  const clock = options.clock ?? (() => new Date().toISOString());
  const processSupervisor = new ProcessSupervisor({
    receiptRoot: path.join(options.stateRoot, "processes"),
    ...(options.windowsJobRunnerPath === undefined
      ? {}
      : { windowsJobRunnerPath: options.windowsJobRunnerPath })
  });
  const hasher = sha256Digest;
  const adapters = options.profile.kind === "deterministic_fake"
    ? deterministicAdapters(processSupervisor, hasher, clock)
    : transitionalAdapters(options.profile.adapters, processSupervisor);
  const executionProcess = executionProcessFor(options.profile);
  const application = createProductRunApplication({
    hasher,
    clock,
    executionProcess,
    recoverInterruptedExecution: options.profile.kind === "deterministic_fake",
    ...(options.profile.kind !== "transitional_unsafe" || options.profile.loadPlanningResult === undefined
      ? {}
      : { loadPlanningResult: options.profile.loadPlanningResult }),
    ...(options.profile.kind !== "transitional_unsafe" || options.profile.loadExecutionResult === undefined
      ? {}
      : { loadExecutionResult: options.profile.loadExecutionResult }),
    ...(options.profile.kind !== "transitional_unsafe" || options.profile.loadDeliveryResult === undefined
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
        active.push({ effectId: intent.effectId, identity: started.processIdentity });
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
  processSupervisor: ProcessSupervisor
): PhysicalEffectAdapter[] {
  const kinds = new Set(configured.map((adapter) => adapter.kind));
  return [
    ...(kinds.has("process_spawn")
      ? []
      : [createProcessSpawnPhysicalEffectAdapter({ supervisor: processSupervisor })]),
    ...(kinds.has("process_terminate")
      ? []
      : [createProcessTerminatePhysicalEffectAdapter({ supervisor: processSupervisor })]),
    ...configured
  ];
}

function executionProcessFor(profile: ProductiveDaemonProfile): TransitionalUnsafeExecutionProfile["executionProcess"] {
  if (profile.kind === "transitional_unsafe") return profile.executionProcess;
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

function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertAbsolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path.`);
  return path.resolve(value);
}
