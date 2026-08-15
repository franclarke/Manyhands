import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DeliveryReceiptSchema,
  RunEventSchema,
  foldRun,
  type DeliveryApproval,
  type DeliveryReceipt,
  type ProductRunDefinition,
  type RunEvent,
  type RunEventInput,
  type RunProjection
} from "@manyhands/run-coordinator";
import type {
  PhysicalEffectAdapter,
  PhysicalEffectAdapterContext
} from "@manyhands/run-engine";
import { JsonlRunEventStore, atomicWriteJson } from "@manyhands/run-store";

import type { TransitionalUnsafeExecutionProfile } from "./productive-daemon.js";

export interface TransitionalLifecycleResult {
  readonly events: readonly RunEventInput[];
}

export interface TransitionalLifecycleResultStore {
  writePlanning(effectId: string, result: TransitionalLifecycleResult): Promise<void>;
  readPlanning(effectId: string): Promise<TransitionalLifecycleResult | undefined>;
  writeExecution(runId: string, attemptId: string, result: TransitionalLifecycleResult): Promise<void>;
  readExecution(runId: string, attemptId: string): Promise<TransitionalLifecycleResult | undefined>;
  writeDelivery(effectId: string, receipt: DeliveryReceipt): Promise<void>;
  readDelivery(effectId: string): Promise<DeliveryReceipt | undefined>;
}

export interface TransitionalPlannerPort {
  plan(input: {
    runId: string;
    definition: ProductRunDefinition;
    events: readonly ReturnType<typeof RunEventSchema.parse>[];
  }): Promise<TransitionalLifecycleResult>;
}

export interface TransitionalDeliveryPort {
  publish(input: {
    runId: string;
    definition: ProductRunDefinition;
    approval: DeliveryApproval;
    projection: RunProjection;
    events: readonly RunEvent[];
  }): Promise<DeliveryReceipt>;
}

export interface CreateTransitionalUnsafeProfileOptions {
  readonly stateRoot: string;
  readonly nodeExecutable: string;
  readonly workerScriptPath: string;
  readonly cwd: string;
  readonly planner: TransitionalPlannerPort;
  readonly delivery: TransitionalDeliveryPort;
  readonly resultStore?: TransitionalLifecycleResultStore;
  readonly processAdapters?: readonly PhysicalEffectAdapter[];
  readonly clock?: () => string;
  readonly executionProcess?: TransitionalUnsafeExecutionProfile["executionProcess"];
}

/**
 * Explicit Stage 3 bridge to the current lifecycle implementation.
 *
 * The profile is deliberately named unsafe: current model/executor internals
 * retain their pre-GLeaf trust model. The daemon still owns every lifecycle
 * append; adapters can only publish immutable results which the actor adopts.
 */
export function createTransitionalUnsafeProfile(
  options: CreateTransitionalUnsafeProfileOptions
): TransitionalUnsafeExecutionProfile {
  const stateRoot = absolute(options.stateRoot, "stateRoot");
  const nodeExecutable = absolute(options.nodeExecutable, "nodeExecutable");
  const workerScriptPath = absolute(options.workerScriptPath, "workerScriptPath");
  const cwd = absolute(options.cwd, "cwd");
  const clock = options.clock ?? (() => new Date().toISOString());
  const results = options.resultStore ?? new FileTransitionalLifecycleResultStore(
    path.join(stateRoot, "transitional-results")
  );
  const events = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
  const adapters: PhysicalEffectAdapter[] = [
    createPlanningAdapter({ events, planner: options.planner, results, clock }),
    ...failClosedUnusedAdapters(clock),
    createDeliveryAdapter({ events, delivery: options.delivery, results, clock }),
    createCleanupAdapter(clock),
    ...(options.processAdapters ?? [])
  ];

  return Object.freeze({
    kind: "transitional_unsafe",
    adapters,
    executionProcess: options.executionProcess ?? ((_definition: ProductRunDefinition, context: {
      runId: string;
      attemptId: string;
    } | undefined) => {
      if (context === undefined) throw new Error("Transitional execution requires run and attempt identity.");
      return {
        executable: nodeExecutable,
        argv: [
          workerScriptPath,
          "--state-root", stateRoot,
          "--run-id", context.runId,
          "--attempt-id", context.attemptId
        ],
        cwd,
        env: inheritedWorkerEnvironment()
      };
    }),
    loadPlanningResult: async (effectId: string) => {
      const result = await results.readPlanning(effectId);
      if (result === undefined) throw new Error(`Planning adapter result ${effectId} is missing.`);
      return validateLifecycleEvents(result.events);
    },
    loadExecutionResult: async (runId: string, attemptId: string) => {
      const result = await results.readExecution(runId, attemptId);
      if (result === undefined) throw new Error(`Execution adapter result ${runId}/${attemptId} is missing.`);
      return validateLifecycleEvents(result.events);
    },
    loadDeliveryResult: async (effectId: string) => {
      const result = await results.readDelivery(effectId);
      if (result === undefined) throw new Error(`Delivery adapter result ${effectId} is missing.`);
      return DeliveryReceiptSchema.parse(result);
    }
  });
}

export class FileTransitionalLifecycleResultStore implements TransitionalLifecycleResultStore {
  constructor(private readonly root: string) {
    absolute(root, "transitional result root");
  }

  writePlanning(effectId: string, result: TransitionalLifecycleResult): Promise<void> {
    return atomicWriteJson(this.file("planning", effectId), normalizedResult(result));
  }

  async readPlanning(effectId: string): Promise<TransitionalLifecycleResult | undefined> {
    return readLifecycleResult(this.file("planning", effectId));
  }

  writeExecution(runId: string, attemptId: string, result: TransitionalLifecycleResult): Promise<void> {
    return atomicWriteJson(this.file("execution", `${runId}:${attemptId}`), normalizedResult(result));
  }

  async readExecution(runId: string, attemptId: string): Promise<TransitionalLifecycleResult | undefined> {
    return readLifecycleResult(this.file("execution", `${runId}:${attemptId}`));
  }

  writeDelivery(effectId: string, receipt: DeliveryReceipt): Promise<void> {
    return atomicWriteJson(this.file("delivery", effectId), DeliveryReceiptSchema.parse(receipt));
  }

  async readDelivery(effectId: string): Promise<DeliveryReceipt | undefined> {
    const value = await readJson(this.file("delivery", effectId));
    return value === undefined ? undefined : DeliveryReceiptSchema.parse(value);
  }

  private file(kind: string, identity: string): string {
    const digest = createHash("sha256").update(identity).digest("hex");
    return path.join(this.root, kind, `${digest}.json`);
  }
}

function createPlanningAdapter(input: {
  events: JsonlRunEventStore;
  planner: TransitionalPlannerPort;
  results: TransitionalLifecycleResultStore;
  clock: () => string;
}): PhysicalEffectAdapter {
  const converge = async (
    intent: Parameters<PhysicalEffectAdapter["execute"]>[0],
    context: PhysicalEffectAdapterContext
  ): Promise<void> => {
    if (terminalRecorded(context)) return;
    let result = await input.results.readPlanning(intent.effectId);
    if (result === undefined) {
      const events = await input.events.load(intent.runId);
      const projection = foldRun(events);
      if (projection.definition === undefined) {
        throw new Error(`Run ${intent.runId} has no immutable definition for planning.`);
      }
      if (await context.invalidationReason?.() !== undefined) return;
      try {
        result = normalizedResult(await input.planner.plan({
          runId: intent.runId,
          definition: projection.definition,
          events
        }));
      } catch (error) {
        // A planning failure is this attempt's outcome, so it has to become a
        // durable observation. Rethrowing instead leaves the run at
        // effect.requested with no event, no diagnostic and no way back: the
        // run actor only surfaces a thrown adapter error through
        // drainEffects(), which a daemon serving IPC never calls.
        await context.record({
          observation: "failed",
          reason: error instanceof Error ? error.message : String(error),
          observedAt: input.clock()
        });
        return;
      }
      await input.results.writePlanning(intent.effectId, result);
    }
    await context.record({
      observation: "succeeded",
      resultDigest: digest(result),
      observedAt: input.clock()
    });
  };
  return { kind: "model_call", execute: converge, reconcile: converge };
}

function createDeliveryAdapter(input: {
  events: JsonlRunEventStore;
  delivery: TransitionalDeliveryPort;
  results: TransitionalLifecycleResultStore;
  clock: () => string;
}): PhysicalEffectAdapter {
  const converge = async (
    intent: Parameters<PhysicalEffectAdapter["execute"]>[0],
    context: PhysicalEffectAdapterContext
  ): Promise<void> => {
    if (terminalRecorded(context)) return;
    let receipt = await input.results.readDelivery(intent.effectId);
    if (receipt === undefined) {
      const runEvents = await input.events.load(intent.runId);
      const projection = foldRun(runEvents);
      if (projection.definition === undefined || projection.deliveryApproval === undefined) {
        throw new Error(`Run ${intent.runId} has no approved delivery input.`);
      }
      if (await context.invalidationReason?.() !== undefined) return;
      receipt = DeliveryReceiptSchema.parse(await input.delivery.publish({
        runId: intent.runId,
        definition: projection.definition,
        approval: projection.deliveryApproval,
        projection,
        events: runEvents
      }));
      await input.results.writeDelivery(intent.effectId, receipt);
    }
    await context.record({
      observation: "succeeded",
      resultDigest: digest(receipt),
      observedAt: input.clock()
    });
  };
  return { kind: "delivery", execute: converge, reconcile: converge };
}

function failClosedUnusedAdapters(clock: () => string): PhysicalEffectAdapter[] {
  const kinds = ["sandbox_create", "git_mutation", "artifact_materialize", "validation"] as const;
  return kinds.map((kind) => {
    const reject = async (
      intent: Parameters<PhysicalEffectAdapter["execute"]>[0],
      context: PhysicalEffectAdapterContext
    ): Promise<void> => {
      if (terminalRecorded(context)) return;
      await context.record({
        observation: "failed",
        resultDigest: digest({ kind, effectId: intent.effectId, reason: "not_requested_by_stage3_bridge" }),
        observedAt: clock()
      });
    };
    return { kind, execute: reject, reconcile: reject };
  });
}

function createCleanupAdapter(clock: () => string): PhysicalEffectAdapter {
  const converge = async (
    intent: Parameters<PhysicalEffectAdapter["execute"]>[0],
    context: PhysicalEffectAdapterContext
  ): Promise<void> => {
    if (terminalRecorded(context)) return;
    await context.record({
      observation: "succeeded",
      resultDigest: digest({ effectId: intent.effectId, state: "quiescent" }),
      observedAt: clock()
    });
  };
  return { kind: "cleanup", execute: converge, reconcile: converge };
}

function terminalRecorded(context: PhysicalEffectAdapterContext): boolean {
  return context.priorReceipts.some((receipt) => receipt.observation !== "started");
}

function normalizedResult(result: TransitionalLifecycleResult): TransitionalLifecycleResult {
  return { events: validateLifecycleEvents(result.events) };
}

function validateLifecycleEvents(events: readonly RunEventInput[]): RunEventInput[] {
  return events.map((event, index) => {
    const parsed = RunEventSchema.parse({
      ...structuredClone(event),
      runId: "run:transitional:validation",
      sequence: index + 1
    });
    const { runId, sequence, ...input } = parsed;
    void runId;
    void sequence;
    return input as RunEventInput;
  });
}

async function readLifecycleResult(filePath: string): Promise<TransitionalLifecycleResult | undefined> {
  const value = await readJson(filePath);
  if (value === undefined || typeof value !== "object" || value === null || !("events" in value)) {
    return value === undefined ? undefined : (() => { throw new Error(`Invalid lifecycle result ${filePath}.`); })();
  }
  const events = (value as { events: unknown }).events;
  if (!Array.isArray(events)) throw new Error(`Invalid lifecycle result ${filePath}.`);
  return { events: validateLifecycleEvents(events as RunEventInput[]) };
}

async function readJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function inheritedWorkerEnvironment(): Record<string, string> {
  const names = [
    "PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP",
    "MANYHANDS_CODEX_BIN", "MANYHANDS_CLAUDE_BIN", "MANYHANDS_PLANNING_STEP_TIMEOUT_MS",
    "MANYHANDS_STAGE8_SANDBOX", "MANYHANDS_STAGE8_WINDOWS_SANDBOX",
    "MANYHANDS_CODEX_AUTH_PATH"
  ];
  return Object.fromEntries(names.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function absolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path.`);
  return path.resolve(value);
}
