import type { EffectIntent, JsonObject } from "@manyhands/contracts";
import type {
  PhysicalEffectAdapter,
  PhysicalEffectAdapterContext
} from "./effect-dispatcher.js";

export type EffectClock = () => string;

export interface ModelCallRequest {
  effectId: string;
  repositoryViewDigest: string;
  requestDigest: string;
  modelProfileDigest: string;
}

export type TerminalOracleObservation =
  | { state: "absent"; evidenceDigest: string }
  | { state: "succeeded" | "failed"; evidenceDigest: string };

export interface ModelCallPort {
  inspect(request: Readonly<ModelCallRequest>): Promise<TerminalOracleObservation>;
  invoke(request: Readonly<ModelCallRequest>): Promise<void>;
}

export interface ModelCallPhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: ModelCallPort;
}

export interface SandboxCreateRequest {
  effectId: string;
  sandboxPath: string;
  repositoryViewDigest: string;
  policyDigest: string;
}

export interface SandboxInspection {
  state: "absent" | "matching" | "divergent";
  evidenceDigest: string;
}

export interface SandboxCreatePort {
  inspect(request: Readonly<SandboxCreateRequest>): Promise<SandboxInspection>;
  create(request: Readonly<SandboxCreateRequest>): Promise<void>;
  dispose(request: Readonly<SandboxCreateRequest>): Promise<void>;
}

export interface SandboxCreatePhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: SandboxCreatePort;
}

export interface GitMutationRequest {
  effectId: string;
  privateRef: string;
  baseTreeSha: string;
  expectedTreeSha: string;
  operationDigest: string;
}

export interface GitMutationInspection {
  state: "absent" | "matching" | "divergent";
  treeSha: string | null;
  evidenceDigest: string;
}

export interface GitMutationPort {
  inspect(request: Readonly<GitMutationRequest>): Promise<GitMutationInspection>;
  mutate(request: Readonly<GitMutationRequest>): Promise<void>;
  discard(request: Readonly<GitMutationRequest>): Promise<void>;
}

export interface GitMutationPhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: GitMutationPort;
}

export interface ArtifactMaterializeRequest {
  effectId: string;
  manifestDigest: string;
  targetTreeSha: string;
  preimageDigests: readonly string[];
}

export interface FreshArtifactIndex {
  indexId: string;
  empty: boolean;
  evidenceDigest: string;
}

export interface ArtifactMaterializationInspection {
  state: "matching" | "divergent";
  evidenceDigest: string;
}

export interface ArtifactMaterializePort {
  createFreshIndex(request: Readonly<ArtifactMaterializeRequest>): Promise<FreshArtifactIndex>;
  materialize(request: Readonly<ArtifactMaterializeRequest>, indexId: string): Promise<void>;
  inspect(
    request: Readonly<ArtifactMaterializeRequest>,
    indexId: string
  ): Promise<ArtifactMaterializationInspection>;
  dispose(request: Readonly<ArtifactMaterializeRequest>, indexId: string): Promise<void>;
}

export interface ArtifactMaterializePhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: ArtifactMaterializePort;
}

export interface ValidationRequest {
  effectId: string;
  candidateTreeSha: string;
  recipeDigest: string;
  environmentDigest: string;
}

export interface ValidationExecution {
  executionId: string;
}

export interface ValidationInspection {
  state: "succeeded" | "failed" | "inconclusive";
  executionId: string;
  candidateTreeSha: string;
  recipeDigest: string;
  environmentDigest: string;
  evidenceDigest: string;
}

export interface ValidationPort {
  start(request: Readonly<ValidationRequest>): Promise<ValidationExecution>;
  inspect(
    request: Readonly<ValidationRequest>,
    executionId: string
  ): Promise<ValidationInspection>;
}

export interface ValidationPhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: ValidationPort;
}

export interface DeliveryRequest {
  effectId: string;
  destinationRef: string;
  expectedHeadSha: string;
  expectedTreeSha: string;
  candidateCommitSha: string;
  candidateTreeSha: string;
}

export interface DeliveryInspection {
  state: "expected" | "published" | "divergent";
  headSha: string;
  treeSha: string;
  evidenceDigest: string;
}

export interface DeliveryPort {
  inspect(request: Readonly<DeliveryRequest>): Promise<DeliveryInspection>;
  compareAndSwap(request: Readonly<DeliveryRequest>): Promise<void>;
}

export interface DeliveryPhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: DeliveryPort;
}

export interface CleanupRequest {
  effectId: string;
  resourceKind: string;
  resourceId: string;
  ownershipDigest: string;
}

export interface CleanupInspection {
  state: "present" | "absent" | "divergent";
  evidenceDigest: string;
}

export interface CleanupPort {
  inspect(request: Readonly<CleanupRequest>): Promise<CleanupInspection>;
  remove(request: Readonly<CleanupRequest>): Promise<void>;
}

export interface CleanupPhysicalEffectAdapterOptions {
  clock: EffectClock;
  port: CleanupPort;
}

export function createModelCallPhysicalEffectAdapter(
  options: ModelCallPhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "model_call",
    execute: (intent, context) => runModelCall(intent, context, options),
    reconcile: (intent, context) => runModelCall(intent, context, options)
  };
}

export function createSandboxCreatePhysicalEffectAdapter(
  options: SandboxCreatePhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "sandbox_create",
    execute: (intent, context) => convergeSandbox(intent, context, options),
    reconcile: (intent, context) => convergeSandbox(intent, context, options)
  };
}

export function createGitMutationPhysicalEffectAdapter(
  options: GitMutationPhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "git_mutation",
    execute: (intent, context) => convergeGitMutation(intent, context, options),
    reconcile: (intent, context) => convergeGitMutation(intent, context, options)
  };
}

export function createArtifactMaterializePhysicalEffectAdapter(
  options: ArtifactMaterializePhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "artifact_materialize",
    execute: (intent, context) => materializeArtifact(intent, context, options),
    reconcile: (intent, context) => materializeArtifact(intent, context, options)
  };
}

export function createValidationPhysicalEffectAdapter(
  options: ValidationPhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "validation",
    execute: (intent, context) => runValidation(intent, context, options),
    reconcile: (intent, context) => runValidation(intent, context, options)
  };
}

export function createDeliveryPhysicalEffectAdapter(
  options: DeliveryPhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "delivery",
    execute: (intent, context) => convergeDelivery(intent, context, options),
    reconcile: (intent, context) => convergeDelivery(intent, context, options)
  };
}

export function createCleanupPhysicalEffectAdapter(
  options: CleanupPhysicalEffectAdapterOptions
): PhysicalEffectAdapter {
  return {
    kind: "cleanup",
    execute: (intent, context) => convergeCleanup(intent, context, options),
    reconcile: (intent, context) => convergeCleanup(intent, context, options)
  };
}

async function runModelCall(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: ModelCallPhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("model_call", intent, context);
  const payload = parseExactStringPayload("model_call", context.inputSpec.payload, [
    "repositoryViewDigest",
    "requestDigest",
    "modelProfileDigest"
  ]);
  const request: ModelCallRequest = Object.freeze({
    effectId: intent.effectId,
    repositoryViewDigest: payload.repositoryViewDigest,
    requestDigest: payload.requestDigest,
    modelProfileDigest: payload.modelProfileDigest
  });

  let observation = parseTerminalOracle(
    await options.port.inspect(request),
    "model_call inspection"
  );
  if (observation.state === "absent") {
    await options.port.invoke(request);
    observation = parseTerminalOracle(
      await options.port.inspect(request),
      "model_call post-invocation inspection"
    );
  }
  if (observation.state === "absent") {
    throw new Error(`model_call ${intent.effectId} has no observable terminal result after invocation.`);
  }
  await context.record({
    observation: observation.state,
    resultDigest: nonEmptyString(observation.evidenceDigest, "model_call evidenceDigest"),
    observedAt: options.clock()
  });
}

async function convergeSandbox(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: SandboxCreatePhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("sandbox_create", intent, context);
  const payload = parseExactStringPayload("sandbox_create", context.inputSpec.payload, [
    "sandboxPath",
    "repositoryViewDigest",
    "policyDigest"
  ]);
  const request: SandboxCreateRequest = Object.freeze({
    effectId: intent.effectId,
    sandboxPath: payload.sandboxPath,
    repositoryViewDigest: payload.repositoryViewDigest,
    policyDigest: payload.policyDigest
  });
  let inspection = parseSandboxInspection(
    await options.port.inspect(request),
    "sandbox_create inspection"
  );

  if (inspection.state === "matching") {
    await recordTerminal(context, options.clock, "succeeded", inspection.evidenceDigest);
    return;
  }
  if (inspection.state === "divergent") {
    await options.port.dispose(request);
    inspection = parseSandboxInspection(
      await options.port.inspect(request),
      "sandbox_create post-disposal inspection"
    );
    if (inspection.state !== "absent") {
      await recordTerminal(context, options.clock, "failed", inspection.evidenceDigest);
      return;
    }
  }

  await options.port.create(request);
  inspection = parseSandboxInspection(
    await options.port.inspect(request),
    "sandbox_create post-creation inspection"
  );
  await recordTerminal(
    context,
    options.clock,
    inspection.state === "matching" ? "succeeded" : "failed",
    inspection.evidenceDigest
  );
}

async function convergeGitMutation(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: GitMutationPhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("git_mutation", intent, context);
  const payload = parseExactStringPayload("git_mutation", context.inputSpec.payload, [
    "baseTreeSha",
    "expectedTreeSha",
    "operationDigest"
  ]);
  const request: GitMutationRequest = Object.freeze({
    effectId: intent.effectId,
    privateRef: `refs/manyhands/effects/${encodeURIComponent(intent.effectId)}`,
    baseTreeSha: payload.baseTreeSha,
    expectedTreeSha: payload.expectedTreeSha,
    operationDigest: payload.operationDigest
  });
  let inspection = parseGitInspection(
    await options.port.inspect(request),
    "git_mutation inspection"
  );

  if (isExactGitResult(inspection, request)) {
    await recordTerminal(context, options.clock, "succeeded", inspection.evidenceDigest);
    return;
  }
  if (inspection.state === "matching") {
    await recordTerminal(context, options.clock, "failed", inspection.evidenceDigest);
    return;
  }
  if (inspection.state === "divergent") {
    await options.port.discard(request);
    inspection = parseGitInspection(
      await options.port.inspect(request),
      "git_mutation post-discard inspection"
    );
    if (inspection.state !== "absent") {
      await recordTerminal(context, options.clock, "failed", inspection.evidenceDigest);
      return;
    }
  }

  await options.port.mutate(request);
  inspection = parseGitInspection(
    await options.port.inspect(request),
    "git_mutation post-mutation inspection"
  );
  await recordTerminal(
    context,
    options.clock,
    isExactGitResult(inspection, request) ? "succeeded" : "failed",
    inspection.evidenceDigest
  );
}

async function materializeArtifact(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: ArtifactMaterializePhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("artifact_materialize", intent, context);
  const payload = exactRecord(context.inputSpec.payload, "artifact_materialize input", [
    "manifestDigest",
    "targetTreeSha",
    "preimageDigests"
  ]);
  const request: ArtifactMaterializeRequest = Object.freeze({
    effectId: intent.effectId,
    manifestDigest: nonEmptyString(payload.manifestDigest, "artifact_materialize.manifestDigest"),
    targetTreeSha: nonEmptyString(payload.targetTreeSha, "artifact_materialize.targetTreeSha"),
    preimageDigests: Object.freeze(
      nonEmptyUniqueStringArray(payload.preimageDigests, "artifact_materialize.preimageDigests")
    )
  });
  const fresh = parseFreshArtifactIndex(
    await options.port.createFreshIndex(request),
    "artifact_materialize fresh index"
  );
  let observation: "succeeded" | "failed" = "failed";
  let resultDigest = fresh.evidenceDigest;
  try {
    if (fresh.empty) {
      await options.port.materialize(request, fresh.indexId);
      const inspection = parseArtifactInspection(
        await options.port.inspect(request, fresh.indexId),
        "artifact_materialize inspection"
      );
      observation = inspection.state === "matching" ? "succeeded" : "failed";
      resultDigest = inspection.evidenceDigest;
    }
  } finally {
    await options.port.dispose(request, fresh.indexId);
  }
  await recordTerminal(context, options.clock, observation, resultDigest);
}

async function runValidation(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: ValidationPhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("validation", intent, context);
  const payload = parseExactStringPayload("validation", context.inputSpec.payload, [
    "candidateTreeSha",
    "recipeDigest",
    "environmentDigest"
  ]);
  const request: ValidationRequest = Object.freeze({
    effectId: intent.effectId,
    candidateTreeSha: payload.candidateTreeSha,
    recipeDigest: payload.recipeDigest,
    environmentDigest: payload.environmentDigest
  });
  const execution = parseValidationExecution(
    await options.port.start(request),
    "validation execution"
  );
  const inspection = parseValidationInspection(
    await options.port.inspect(request, execution.executionId),
    "validation inspection"
  );
  if (inspection.executionId !== execution.executionId) {
    throw new Error("Validation evidence belongs to a different execution.");
  }
  if (inspection.candidateTreeSha !== request.candidateTreeSha) {
    throw new Error("Validation evidence belongs to a different candidate.");
  }
  if (inspection.recipeDigest !== request.recipeDigest) {
    throw new Error("Validation evidence belongs to a different recipe.");
  }
  if (inspection.environmentDigest !== request.environmentDigest) {
    throw new Error("Validation evidence belongs to a different environment.");
  }
  await recordTerminal(
    context,
    options.clock,
    inspection.state === "succeeded" ? "succeeded" : "failed",
    inspection.evidenceDigest
  );
}

async function convergeDelivery(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: DeliveryPhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("delivery", intent, context);
  const payload = parseExactStringPayload("delivery", context.inputSpec.payload, [
    "destinationRef",
    "expectedHeadSha",
    "expectedTreeSha",
    "candidateCommitSha",
    "candidateTreeSha"
  ]);
  const request: DeliveryRequest = Object.freeze({ effectId: intent.effectId, ...payload });
  let inspection = parseDeliveryInspection(
    await options.port.inspect(request),
    "delivery inspection"
  );

  if (isPublishedDelivery(inspection, request)) {
    await recordTerminal(context, options.clock, "succeeded", inspection.evidenceDigest);
    return;
  }
  if (!isExpectedDelivery(inspection, request)) {
    await recordTerminal(context, options.clock, "failed", inspection.evidenceDigest);
    return;
  }

  await options.port.compareAndSwap(request);
  inspection = parseDeliveryInspection(
    await options.port.inspect(request),
    "delivery post-CAS inspection"
  );
  await recordTerminal(
    context,
    options.clock,
    isPublishedDelivery(inspection, request) ? "succeeded" : "failed",
    inspection.evidenceDigest
  );
}

async function convergeCleanup(
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext,
  options: CleanupPhysicalEffectAdapterOptions
): Promise<void> {
  assertAdapterBinding("cleanup", intent, context);
  const payload = parseExactStringPayload("cleanup", context.inputSpec.payload, [
    "resourceKind",
    "resourceId",
    "ownershipDigest"
  ]);
  const request: CleanupRequest = Object.freeze({ effectId: intent.effectId, ...payload });
  let inspection = parseCleanupInspection(
    await options.port.inspect(request),
    "cleanup inspection"
  );
  if (inspection.state === "absent") {
    await recordTerminal(context, options.clock, "succeeded", inspection.evidenceDigest);
    return;
  }
  if (inspection.state === "divergent") {
    await recordTerminal(context, options.clock, "failed", inspection.evidenceDigest);
    return;
  }

  await options.port.remove(request);
  inspection = parseCleanupInspection(
    await options.port.inspect(request),
    "cleanup post-removal inspection"
  );
  await recordTerminal(
    context,
    options.clock,
    inspection.state === "absent" ? "succeeded" : "failed",
    inspection.evidenceDigest
  );
}

async function recordTerminal(
  context: PhysicalEffectAdapterContext,
  clock: EffectClock,
  observation: "succeeded" | "failed",
  resultDigest: string
): Promise<void> {
  await context.record({
    observation,
    resultDigest: nonEmptyString(resultDigest, "physical effect resultDigest"),
    observedAt: clock()
  });
}

function parseTerminalOracle(input: unknown, label: string): TerminalOracleObservation {
  const value = exactRecord(input, label, ["state", "evidenceDigest"]);
  const state = value.state;
  if (state !== "absent" && state !== "succeeded" && state !== "failed") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  return {
    state,
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function parseSandboxInspection(input: unknown, label: string): SandboxInspection {
  const value = exactRecord(input, label, ["state", "evidenceDigest"]);
  const state = value.state;
  if (state !== "absent" && state !== "matching" && state !== "divergent") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  return {
    state,
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function parseGitInspection(input: unknown, label: string): GitMutationInspection {
  const value = exactRecord(input, label, ["state", "treeSha", "evidenceDigest"]);
  const state = value.state;
  if (state !== "absent" && state !== "matching" && state !== "divergent") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  if (value.treeSha !== null && (typeof value.treeSha !== "string" || value.treeSha.trim().length === 0)) {
    throw new TypeError(`${label}.treeSha must be null or a non-empty string.`);
  }
  if (state === "absent" && value.treeSha !== null) {
    throw new TypeError(`${label}.treeSha must be null when the ref is absent.`);
  }
  return {
    state,
    treeSha: value.treeSha,
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function isExactGitResult(
  inspection: GitMutationInspection,
  request: GitMutationRequest
): boolean {
  return inspection.state === "matching" && inspection.treeSha === request.expectedTreeSha;
}

function parseFreshArtifactIndex(input: unknown, label: string): FreshArtifactIndex {
  const value = exactRecord(input, label, ["indexId", "empty", "evidenceDigest"]);
  if (typeof value.empty !== "boolean") throw new TypeError(`${label}.empty must be a boolean.`);
  return {
    indexId: nonEmptyString(value.indexId, `${label}.indexId`),
    empty: value.empty,
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function parseArtifactInspection(input: unknown, label: string): ArtifactMaterializationInspection {
  const value = exactRecord(input, label, ["state", "evidenceDigest"]);
  if (value.state !== "matching" && value.state !== "divergent") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  return {
    state: value.state,
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function parseValidationExecution(input: unknown, label: string): ValidationExecution {
  const value = exactRecord(input, label, ["executionId"]);
  return { executionId: nonEmptyString(value.executionId, `${label}.executionId`) };
}

function parseValidationInspection(input: unknown, label: string): ValidationInspection {
  const value = exactRecord(input, label, [
    "state",
    "executionId",
    "candidateTreeSha",
    "recipeDigest",
    "environmentDigest",
    "evidenceDigest"
  ]);
  if (value.state !== "succeeded" && value.state !== "failed" && value.state !== "inconclusive") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  return {
    state: value.state,
    executionId: nonEmptyString(value.executionId, `${label}.executionId`),
    candidateTreeSha: nonEmptyString(value.candidateTreeSha, `${label}.candidateTreeSha`),
    recipeDigest: nonEmptyString(value.recipeDigest, `${label}.recipeDigest`),
    environmentDigest: nonEmptyString(value.environmentDigest, `${label}.environmentDigest`),
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function parseDeliveryInspection(input: unknown, label: string): DeliveryInspection {
  const value = exactRecord(input, label, ["state", "headSha", "treeSha", "evidenceDigest"]);
  if (value.state !== "expected" && value.state !== "published" && value.state !== "divergent") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  return {
    state: value.state,
    headSha: nonEmptyString(value.headSha, `${label}.headSha`),
    treeSha: nonEmptyString(value.treeSha, `${label}.treeSha`),
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function isExpectedDelivery(
  inspection: DeliveryInspection,
  request: DeliveryRequest
): boolean {
  return inspection.state === "expected"
    && inspection.headSha === request.expectedHeadSha
    && inspection.treeSha === request.expectedTreeSha;
}

function isPublishedDelivery(
  inspection: DeliveryInspection,
  request: DeliveryRequest
): boolean {
  return inspection.state === "published"
    && inspection.headSha === request.candidateCommitSha
    && inspection.treeSha === request.candidateTreeSha;
}

function parseCleanupInspection(input: unknown, label: string): CleanupInspection {
  const value = exactRecord(input, label, ["state", "evidenceDigest"]);
  if (value.state !== "present" && value.state !== "absent" && value.state !== "divergent") {
    throw new TypeError(`${label}.state is invalid.`);
  }
  return {
    state: value.state,
    evidenceDigest: nonEmptyString(value.evidenceDigest, `${label}.evidenceDigest`)
  };
}

function parseExactStringPayload<K extends string>(
  kind: string,
  input: JsonObject,
  keys: readonly K[]
): Record<K, string> {
  const value = exactRecord(input, `${kind} input`, keys);
  const output = {} as Record<K, string>;
  for (const key of keys) output[key] = nonEmptyString(value[key], `${kind}.${key}`);
  return output;
}

function exactRecord<K extends string>(
  input: unknown,
  label: string,
  keys: readonly K[]
): Record<K, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const value = input as Record<string, unknown>;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(`${label} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
  return value as Record<K, unknown>;
}

function assertAdapterBinding(
  kind: EffectIntent["kind"],
  intent: Readonly<EffectIntent>,
  context: PhysicalEffectAdapterContext
): void {
  if (intent.kind !== kind || context.inputSpec.kind !== kind) {
    throw new TypeError(
      `${kind} adapter received intent ${intent.kind} with input ${context.inputSpec.kind}.`
    );
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function nonEmptyUniqueStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty array.`);
  }
  const items = value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
  if (new Set(items).size !== items.length) {
    throw new TypeError(`${field} must not contain duplicate identities.`);
  }
  return items;
}
