import path from "node:path";

import {
  ProcessIdentitySchema,
  type EffectIntent,
  type JsonObject,
  type ProcessIdentity
} from "@manyhands/contracts";
import {
  ProcessSupervisorFinalReceiptSchema,
  ProcessSupervisorReceiptSchema,
  ProcessSupervisorStartedReceiptSchema,
  type ProcessSpawnRequest,
  type ProcessSupervisor,
  type ProcessSupervisorFinalReceipt,
  type ProcessSupervisorReceipt,
  type ProcessSupervisorStartedReceipt
} from "@manyhands/execution-core";
import type {
  PhysicalEffectAdapter,
  PhysicalEffectAdapterContext
} from "@manyhands/run-engine";

export type ProcessSupervisorPort = Pick<
  ProcessSupervisor,
  "spawn" | "terminate" | "readReceipts"
>;

export interface ProcessEffectAdapterOptions {
  supervisor: ProcessSupervisorPort;
}

interface ProcessSpawnPayload {
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
}

interface ProcessTerminatePayload {
  targetEffectId: string;
  expectedProcessIdentity: ProcessIdentity;
  reason: string;
}

export function createProcessSpawnPhysicalEffectAdapter(
  options: ProcessEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "process_spawn",
    execute: (intent, context) => executeProcessSpawn(intent, context, options.supervisor),
    reconcile: (intent, context) => reconcileProcessSpawn(intent, context, options.supervisor)
  };
}

export function createProcessTerminatePhysicalEffectAdapter(
  options: ProcessEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "process_terminate",
    execute: (intent, context) => convergeProcessTermination(intent, context, options.supervisor),
    reconcile: (intent, context) => convergeProcessTermination(intent, context, options.supervisor)
  };
}

async function executeProcessSpawn(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  supervisor: ProcessSupervisorPort
): Promise<void> {
  assertAdapterBinding("process_spawn", intent, context);
  const payload = parseProcessSpawnPayload(context.inputSpec.payload);
  const request: ProcessSpawnRequest = {
    effectId: intent.effectId,
    inputDigest: intent.inputDigest,
    daemonEpoch: intent.daemonEpoch,
    ...(intent.attemptId === undefined ? {} : { attemptId: intent.attemptId }),
    executable: payload.executable,
    argv: payload.argv,
    cwd: payload.cwd,
    env: payload.env,
    ...(payload.timeoutMs === undefined ? {} : { timeoutMs: payload.timeoutMs })
  };
  const processHandle = await supervisor.spawn(request);
  const started = ProcessSupervisorStartedReceiptSchema.parse(processHandle.started);
  assertSpawnReceiptBinding(started, intent);
  if (processHandle.custodianPid !== started.custodianIdentity.pid) {
    throw new Error(`Process supervisor returned a custodian PID that differs from its durable receipt.`);
  }
  await recordStartedIfMissing(context, started);
  const final = ProcessSupervisorFinalReceiptSchema.parse(await processHandle.completion);
  assertFinalReceiptBinding(final, started);
  await recordSpawnTerminal(context, final);
}

async function reconcileProcessSpawn(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  supervisor: ProcessSupervisorPort
): Promise<void> {
  assertAdapterBinding("process_spawn", intent, context);
  parseProcessSpawnPayload(context.inputSpec.payload);
  const receipts = parseSupervisorReceipts(await supervisor.readReceipts(intent.effectId));
  const started = receipts.find(isStartedReceipt);
  const final = receipts.find(isFinalReceipt);
  if (started === undefined) return;
  assertSpawnReceiptBinding(started, intent);
  await recordStartedIfMissing(context, started);
  if (final !== undefined) {
    assertFinalReceiptBinding(final, started);
    await recordSpawnTerminal(context, final);
    return;
  }
  const interrupted = ProcessSupervisorFinalReceiptSchema.parse(
    await supervisor.terminate(intent.effectId, "reconcile_interrupted_process_spawn")
  );
  assertFinalReceiptBinding(interrupted, started);
  await recordSpawnTerminal(context, interrupted, "failed");
}

async function convergeProcessTermination(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  supervisor: ProcessSupervisorPort
): Promise<void> {
  assertAdapterBinding("process_terminate", intent, context);
  const payload = parseProcessTerminatePayload(context.inputSpec.payload);
  const receipts = parseSupervisorReceipts(await supervisor.readReceipts(payload.targetEffectId));
  const started = receipts.find(isStartedReceipt);
  if (started === undefined) {
    throw new Error(`Process ${payload.targetEffectId} has no durable identity evidence; refusing blind termination.`);
  }
  assertExpectedProcessIdentity(started.processIdentity, payload.expectedProcessIdentity);
  const existingFinal = receipts.find(isFinalReceipt);
  if (existingFinal !== undefined) {
    assertFinalReceiptBinding(existingFinal, started);
    await recordTerminationSuccess(context, existingFinal);
    return;
  }

  const terminated = ProcessSupervisorFinalReceiptSchema.parse(
    await supervisor.terminate(payload.targetEffectId, payload.reason)
  );
  assertFinalReceiptBinding(terminated, started);
  assertExpectedProcessIdentity(terminated.processIdentity, payload.expectedProcessIdentity);
  await recordTerminationSuccess(context, terminated);
}

async function recordStartedIfMissing(
  context: PhysicalEffectAdapterContext,
  started: ProcessSupervisorStartedReceipt
): Promise<void> {
  if (context.priorReceipts.some((receipt) => receipt.observation === "started")) return;
  await context.record({
    observation: "started",
    observedAt: epochMsToIso(started.startedAtEpochMs, "process startedAtEpochMs"),
    processIdentity: started.processIdentity
  });
}

async function recordSpawnTerminal(
  context: PhysicalEffectAdapterContext,
  final: ProcessSupervisorFinalReceipt,
  forcedObservation?: "failed"
): Promise<void> {
  await context.record({
    observation: forcedObservation ?? (final.outcome === "succeeded" ? "succeeded" : "failed"),
    observedAt: epochMsToIso(final.completedAtEpochMs, "process completedAtEpochMs"),
    processIdentity: final.processIdentity,
    resultDigest: final.receiptChecksum
  });
}

async function recordTerminationSuccess(
  context: PhysicalEffectAdapterContext,
  final: ProcessSupervisorFinalReceipt
): Promise<void> {
  await context.record({
    observation: "succeeded",
    observedAt: epochMsToIso(final.completedAtEpochMs, "process completedAtEpochMs"),
    processIdentity: final.processIdentity,
    resultDigest: final.receiptChecksum
  });
}

function parseProcessSpawnPayload(input: JsonObject): ProcessSpawnPayload {
  const payload = exactRecord(
    input,
    "process_spawn input",
    ["executable", "argv", "cwd", "env"],
    ["timeoutMs"]
  );
  const executable = absolutePath(payload.executable, "process_spawn.executable");
  const cwd = absolutePath(payload.cwd, "process_spawn.cwd");
  const argv = stringArray(payload.argv, "process_spawn.argv");
  const env = processEnvironment(payload.env);
  const timeoutMs = payload.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || (timeoutMs as number) <= 0)) {
    throw new TypeError("process_spawn.timeoutMs must be a positive integer when present.");
  }
  return {
    executable,
    argv,
    cwd,
    env,
    ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs as number })
  };
}

function parseProcessTerminatePayload(input: JsonObject): ProcessTerminatePayload {
  const payload = exactRecord(
    input,
    "process_terminate input",
    ["targetEffectId", "expectedProcessIdentity", "reason"]
  );
  const targetEffectId = nonEmptyStringWithoutNul(
    payload.targetEffectId,
    "process_terminate.targetEffectId"
  );
  const reason = nonEmptyStringWithoutNul(payload.reason, "process_terminate.reason");
  const expectedProcessIdentity = ProcessIdentitySchema.parse(payload.expectedProcessIdentity);
  return { targetEffectId, expectedProcessIdentity, reason };
}

function parseSupervisorReceipts(input: readonly unknown[]): ProcessSupervisorReceipt[] {
  const receipts = input.map((receipt) => ProcessSupervisorReceiptSchema.parse(receipt));
  const started = receipts.filter(isStartedReceipt);
  const final = receipts.filter(isFinalReceipt);
  if (started.length > 1 || final.length > 1) {
    throw new Error("Process supervisor returned multiple receipts for the same phase.");
  }
  if (final.length > 0 && started.length === 0) {
    throw new Error("Process supervisor returned a final receipt without a started receipt.");
  }
  if (started[0] !== undefined && final[0] !== undefined) {
    assertFinalReceiptBinding(final[0], started[0]);
  }
  return receipts;
}

function assertSpawnReceiptBinding(
  receipt: ProcessSupervisorStartedReceipt,
  intent: Readonly<EffectIntent>
): void {
  if (
    receipt.effectId !== intent.effectId
    || receipt.inputDigest !== intent.inputDigest
    || receipt.daemonEpoch !== intent.daemonEpoch
    || receipt.attemptId !== intent.attemptId
  ) {
    throw new Error("Process supervisor receipt is bound to different effect inputs.");
  }
}

function assertFinalReceiptBinding(
  final: ProcessSupervisorFinalReceipt,
  started: ProcessSupervisorStartedReceipt
): void {
  if (
    final.effectId !== started.effectId
    || final.inputDigest !== started.inputDigest
    || final.daemonEpoch !== started.daemonEpoch
    || final.attemptId !== started.attemptId
    || final.startedReceiptChecksum !== started.receiptChecksum
    || !sameProcessIdentity(final.custodianIdentity, started.custodianIdentity)
    || final.platformOwnership !== started.platformOwnership
    || !sameProcessIdentity(final.processIdentity, started.processIdentity)
  ) {
    throw new Error("Process final receipt is not bound to its durable started receipt.");
  }
}

function assertExpectedProcessIdentity(actual: ProcessIdentity, expected: ProcessIdentity): void {
  if (!sameProcessIdentity(actual, expected)) {
    throw new Error("Durable process identity does not match the requested termination target.");
  }
}

function processEnvironment(input: unknown): Record<string, string> {
  const value = plainRecord(input, "process_spawn.env");
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length === 0 || key.includes("=") || key.includes("\0")) {
      throw new TypeError("process_spawn.env contains an invalid variable name.");
    }
    // This input is content-addressed and durable. Credential material belongs
    // in the attempt-scoped broker, never in this environment declaration.
    if (looksSecretBearing(key)) {
      throw new TypeError(`process_spawn.env must not persist secret-bearing variable ${key}.`);
    }
    env[key] = stringWithoutNul(item, `process_spawn.env.${key}`);
  }
  return env;
}

function looksSecretBearing(name: string): boolean {
  return /(?:^|[_-])(?:api[_-]?key|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)(?:$|[_-])/i
    .test(name);
}

function absolutePath(value: unknown, field: string): string {
  const parsed = stringWithoutNul(value, field);
  if (!path.isAbsolute(parsed)) throw new TypeError(`${field} must be an absolute path.`);
  return parsed;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${field} must be an explicit string array.`);
  }
  return value.map((item, index) => stringWithoutNul(item, `${field}[${index}]`));
}

function stringWithoutNul(value: unknown, field: string): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${field} must be a string without NUL bytes.`);
  }
  return value;
}

function nonEmptyStringWithoutNul(value: unknown, field: string): string {
  const parsed = stringWithoutNul(value, field);
  if (parsed.trim().length === 0) throw new TypeError(`${field} must not be empty.`);
  return parsed;
}

function exactRecord(
  input: unknown,
  label: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> {
  const value = plainRecord(input, label);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actualKeys = Object.keys(value);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  const unknown = actualKeys.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new TypeError(
      `${label} must contain exactly required fields ${requiredKeys.join(", ")}`
      + `${optionalKeys.length === 0 ? "" : ` and optional fields ${optionalKeys.join(", ")}`}.`
    );
  }
  return value;
}

function plainRecord(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return input as Record<string, unknown>;
}

function assertAdapterBinding(
  kind: "process_spawn" | "process_terminate",
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext
): void {
  if (intent.kind !== kind || context.inputSpec.kind !== kind) {
    throw new TypeError(
      `${kind} adapter received intent ${intent.kind} with input ${context.inputSpec.kind}.`
    );
  }
}

function sameProcessIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  const expected = ProcessIdentitySchema.parse(right);
  const actual = ProcessIdentitySchema.parse(left);
  return actual.pid === expected.pid
    && actual.creationIdentity === expected.creationIdentity
    && actual.supervisorNonce === expected.supervisorNonce;
}

function epochMsToIso(value: number, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} is outside the supported timestamp range.`);
  return date.toISOString();
}

function isStartedReceipt(
  receipt: ProcessSupervisorReceipt
): receipt is ProcessSupervisorStartedReceipt {
  return receipt.phase === "started";
}

function isFinalReceipt(receipt: ProcessSupervisorReceipt): receipt is ProcessSupervisorFinalReceipt {
  return receipt.phase === "final";
}
