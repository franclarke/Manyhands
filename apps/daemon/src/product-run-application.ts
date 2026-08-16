import {
  buildEffectInput,
  buildEffectIntent,
  computeCanonicalDigest,
  type DigestHasher,
  type EffectInputSpec,
  type ProcessIdentity
} from "@manyhands/contracts";
import {
  ProductRunCommandSchema,
  autonomyPublishesDelivery,
  autonomyResolution,
  foldRun,
  runAutonomy,
  standingAuthorization,
  type DeliveryApproval,
  type DeliveryReceipt,
  type ProductRunCommand,
  type ProductRunDefinition,
  type RunCommandEnvelope,
  type RunEvent,
  type RunEventInput,
  type RunProjection
} from "@manyhands/run-coordinator";
import type {
  RunActorDecision,
  RunActorDecisionContext,
  RunActorEffectRequest,
  RunActorReaction,
  RunActorReactionContext,
  RunActorTerminalObservation
} from "@manyhands/run-engine";

export interface ActiveProductProcess {
  readonly effectId: string;
  readonly identity: ProcessIdentity;
  readonly attemptId?: string;
}

export interface ProductRunApplicationOptions {
  readonly hasher: DigestHasher;
  readonly clock: () => string;
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
  activeProcesses?(runId: string, projection: RunProjection): Promise<readonly ActiveProductProcess[]>;
  /** Deterministic GR profile only: a verified daemon-loss interruption is rescheduled. */
  recoverInterruptedExecution?: boolean;
  /** A productive profile may recover only a specific physically observed interruption cause. */
  recoverInterruptedExecutionReason?: string;
  loadPlanningResult?(effectId: string): Promise<readonly RunEventInput[]>;
  loadExecutionResult?(runId: string, attemptId: string): Promise<readonly RunEventInput[]>;
  loadDeliveryResult?(effectId: string): Promise<DeliveryReceipt>;
}

export interface ProductRunApplication {
  decide(command: RunCommandEnvelope, context: RunActorDecisionContext): Promise<RunActorDecision>;
  react(
    observation: RunActorTerminalObservation,
    context: RunActorReactionContext
  ): Promise<RunActorReaction>;
}

/**
 * Stage 3 application policy. It translates durable product commands into
 * canonical domain facts plus effect intents; adapters only perform physical
 * work and can never append lifecycle events themselves.
 */
export function createProductRunApplication(options: ProductRunApplicationOptions): ProductRunApplication {
  return Object.freeze<ProductRunApplication>({
    decide: (command: RunCommandEnvelope, context: RunActorDecisionContext) =>
      decide(command, context, options),
    react: (observation: RunActorTerminalObservation, context: RunActorReactionContext) =>
      react(observation, context, options)
  });
}

async function decide(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  options: ProductRunApplicationOptions
): Promise<RunActorDecision> {
  const command = ProductRunCommandSchema.parse(envelope.command);
  switch (command.type) {
    case "create_run": {
      if (context.events.length !== 0 || context.projection !== undefined) {
        throw new Error(`Run ${context.runId} already exists.`);
      }
      const created: RunEventInput = {
        eventId: eventId(options, context.runId, "created", envelope.commandDigest),
        occurredAt: envelope.submittedAt,
        type: "run.created",
        payload: { goal: command.definition.userPrompt, definition: command.definition }
      };
      return {
        eventsBeforeAcceptance: [created],
        eventsAfterAcceptance: [],
        effects: [planningEffect(envelope, context, command.definition, options)]
      };
    }
    case "start_run":
    case "continue_run":
      return startExecution(envelope, context, requireProjection(context), options);
    case "pause_run":
      return controlEffects(envelope, context, "pause", command.reason, options);
    case "resume_run": {
      const projection = requireProjection(context);
      if (projection.lifecycle !== "paused") throw new Error(`Cannot resume while ${projection.lifecycle}.`);
      return {
        eventsAfterAcceptance: [event(options, context.runId, "run.resume_requested", {
          reason: command.reason
        }, envelope.commandDigest)],
        effects: [executionEffect(
          context,
          requireDefinition(projection),
          options,
          nextExecutionAttempt(projection)
        )]
      };
    }
    case "restart_run": {
      const projection = requireProjection(context);
      if (projection.lifecycle !== "interrupted") throw new Error(`Cannot restart while ${projection.lifecycle}.`);
      return {
        eventsAfterAcceptance: [event(options, context.runId, "run.restart_requested", {
          reason: command.reason
        }, envelope.commandDigest)],
        effects: [executionEffect(
          context,
          requireDefinition(projection),
          options,
          nextExecutionAttempt(projection)
        )]
      };
    }
    case "cancel_run":
      return cancelEffects(envelope, context, command.reason, options);
    case "resolve_decision":
      return resolveDecision(envelope, context, command, options);
    case "record_human_review":
      requireProjection(context);
      return {
        eventsAfterAcceptance: [event(options, context.runId, "human_review.recorded", {
          review: command.review
        }, envelope.commandDigest)],
        effects: []
      };
    case "authorize_artifact_retention_release":
      requireProjection(context);
      return {
        eventsAfterAcceptance: [event(options, context.runId, "artifact.retention_release_authorized", {
          authorization: command.authorization
        }, envelope.commandDigest)],
        effects: []
      };
    case "deliver_run":
      return deliveryEffects(envelope, context, command, options);
    case "rename_run":
      requireProjection(context);
      return {
        eventsAfterAcceptance: [event(options, context.runId, "run.renamed", {
          title: command.title
        }, envelope.commandDigest)],
        effects: []
      };
    case "archive_run":
      requireProjection(context);
      return {
        eventsAfterAcceptance: [event(options, context.runId, "run.archived", {
          archivedAt: options.clock()
        }, envelope.commandDigest)],
        effects: []
      };
  }
}

async function react(
  observation: RunActorTerminalObservation,
  context: RunActorReactionContext,
  options: ProductRunApplicationOptions
): Promise<RunActorReaction> {
  const attempt = observation.intent.attemptId;
  const succeeded = observation.terminal.type === "effect.completed";
  if (attempt === "stage3:planning") {
    if (!succeeded) {
      return {
        domainEvents: [event(options, context.runId, "planning.failed", {
          reason: "The transitional planning adapter did not produce a successful physical receipt."
        }, observation.intent.effectId)],
        effects: []
      };
    }
    if (options.loadPlanningResult === undefined) {
      return {
        domainEvents: [event(options, context.runId, "planning.failed", {
          reason: "A productive planning effect completed without a durable canonical planning result."
        }, observation.intent.effectId)],
        effects: []
      };
    }
    const planned = [...await options.loadPlanningResult(observation.intent.effectId)];
    const delegated = delegatedPlanApproval(planned, context, options, observation.intent.effectId);
    return { domainEvents: [...planned, ...delegated.events], effects: delegated.effects };
  }

  if (attempt === "stage3:delivery") {
    // The approval is read from the projection, not from an accepted
    // `deliver_run` command: a delegated delivery has no command behind it, and
    // `delivery.started` is the fact the reducer itself validates receipts
    // against, so it is the same authority in both cases.
    const approval = context.projection.deliveryApproval;
    if (approval === undefined) throw new Error("A delivery effect has no approval in the run journal.");
    const receipt = succeeded && options.loadDeliveryResult !== undefined
      ? await options.loadDeliveryResult(observation.intent.effectId)
      : undefined;
    // A completed effect whose durable receipt is missing is the crash window
    // between the physical publish and the write that records it. Synthesizing
    // one from the approval claimed `confirmed: true` for a head nobody
    // observed, which is the false success this stage exists to prevent; the
    // planning branch above already fails closed for the same reason.
    const provenReceipt = succeeded && receipt === undefined ? undefined : receipt;
    return {
      domainEvents: succeeded && provenReceipt !== undefined
        ? [event(options, context.runId, "delivery.published", {
          receipt: provenReceipt
        }, observation.intent.effectId)]
        : [event(options, context.runId, "delivery.failed", {
          manifestId: approval.manifestId,
          reason: succeeded
            ? "A delivery effect completed without a durable receipt; nothing proves the target moved."
            : "The delivery adapter did not prove publication.",
          retryable: true
        }, observation.intent.effectId)],
      effects: []
    };
  }

  if (context.projection.lifecycle === "cancelling") {
    return allEffectsTerminal(context.projection)
      ? {
        domainEvents: [event(options, context.runId, "operation.interrupted", {
          processReceiptId: terminalReceiptId(observation),
          allDead: true
        }, observation.intent.effectId)],
        effects: []
      }
      : { domainEvents: [], effects: [] };
  }

  const pendingPause = latestUnappliedPause(context);
  if (pendingPause !== undefined && allEffectsTerminal(context.projection)) {
    return {
      domainEvents: [event(options, context.runId, "run.pause_requested", {
        reason: pendingPause.reason
      }, observation.intent.effectId)],
      effects: []
    };
  }

  if (attempt?.startsWith("stage3:execution") === true && !succeeded) {
    const reason = observation.terminal.type === "effect.failed"
      ? observation.terminal.payload.reason
      : undefined;
    if (
      (options.recoverInterruptedExecution === true ||
        (options.recoverInterruptedExecutionReason !== undefined &&
          reason === options.recoverInterruptedExecutionReason)) &&
      context.projection.lifecycle === "running"
    ) {
      return {
        domainEvents: [],
        effects: [executionEffect(
          context,
          requireDefinition(context.projection),
          options,
          nextExecutionAttempt(context.projection)
        )]
      };
    }
    return {
      domainEvents: [event(options, context.runId, "run.failed", {
        reason: "The transitional execution adapter failed.",
        area: "execution"
      }, observation.intent.effectId)],
      effects: []
    };
  }
  if (attempt?.startsWith("stage3:execution") === true && succeeded && options.loadExecutionResult !== undefined) {
    const produced = [...await options.loadExecutionResult(context.runId, attempt)];
    const delegated = delegatedDelivery(produced, context, options);
    return { domainEvents: [...produced, ...delegated.events], effects: delegated.effects };
  }
  return { domainEvents: [], effects: [] };
}

function startExecution(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  projection: RunProjection,
  options: ProductRunApplicationOptions
): RunActorDecision {
  if (projection.lifecycle !== "running") {
    throw new Error(`Cannot start execution while ${projection.lifecycle}.`);
  }
  if (hasPendingAttempt(projection, "stage3:execution")) {
    throw new Error(`Run ${context.runId} already has pending execution.`);
  }
  return {
    eventsAfterAcceptance: [],
    effects: [executionEffect(context, requireDefinition(projection), options)]
  };
}

async function controlEffects(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  control: "pause",
  reason: string,
  options: ProductRunApplicationOptions
): Promise<RunActorDecision> {
  const projection = requireProjection(context);
  if (projection.lifecycle !== "running" && projection.lifecycle !== "waiting_for_input") {
    throw new Error(`Cannot pause while ${projection.lifecycle}.`);
  }
  return {
    eventsAfterAcceptance: [],
    effects: await quiescenceEffects(envelope, context, projection, control, reason, options)
  };
}

async function cancelEffects(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  reason: string,
  options: ProductRunApplicationOptions
): Promise<RunActorDecision> {
  const projection = requireProjection(context);
  if (["completed", "failed"].includes(projection.lifecycle)) {
    throw new Error(`Cannot cancel while ${projection.lifecycle}.`);
  }
  return {
    eventsAfterAcceptance: [event(options, context.runId, "operation.cancel_requested", {
      invalidationReceiptId: `command:${envelope.commandId}`,
      reason
    }, envelope.commandDigest)],
    effects: await quiescenceEffects(envelope, context, projection, "cancel", reason, options)
  };
}

async function quiescenceEffects(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  projection: RunProjection,
  control: "pause" | "cancel",
  reason: string,
  options: ProductRunApplicationOptions
): Promise<RunActorEffectRequest[]> {
  const active = await options.activeProcesses?.(context.runId, projection) ?? [];
  const effects = active.map((process) => effectRequest({
    runId: context.runId,
    daemonEpoch: context.daemonEpoch,
    attemptId: `stage3:${control}:terminate`,
    requestedAt: options.clock(),
    idempotency: "reconcile_then_repeat",
    inputSpec: {
      schemaVersion: 1,
      kind: "process_terminate",
      payload: {
        targetEffectId: process.effectId,
        expectedProcessIdentity: process.identity,
        reason,
        ...(process.attemptId === undefined ? {} : { targetAttemptId: process.attemptId })
      }
    }
  }, options));
  effects.push(effectRequest({
    runId: context.runId,
    daemonEpoch: context.daemonEpoch,
    attemptId: `stage3:${control}:cleanup`,
    requestedAt: options.clock(),
    idempotency: "repeat_safe",
    inputSpec: {
      schemaVersion: 1,
      kind: "cleanup",
      payload: {
        resourceKind: "run_control",
        resourceId: context.runId,
        ownershipDigest: envelope.commandDigest
      }
    }
  }, options));
  return effects;
}

function resolveDecision(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  command: Extract<ProductRunCommand, { type: "resolve_decision" }>,
  options: ProductRunApplicationOptions
): RunActorDecision {
  const projection = requireProjection(context);
  const decision = projection.decisions[command.decisionId];
  if (decision === undefined || decision.status !== "pending") {
    throw new Error(`Decision ${command.decisionId} is not pending.`);
  }
  const events: RunEventInput[] = [event(options, context.runId, "decision.resolved", {
    decisionId: command.decisionId,
    ...(command.optionId === undefined ? {} : { optionId: command.optionId }),
    ...(command.answer === undefined ? {} : { answer: command.answer })
  }, envelope.commandDigest)];
  const effects: RunActorEffectRequest[] = [];
  if (decision.kind === "approve_plan" && command.optionId === "approve") {
    if (projection.graphId === undefined || projection.graphRevision === undefined) {
      throw new Error("Plan approval requires a current graph revision.");
    }
    events.push(event(options, context.runId, "graph.revision.approved", {
      graphId: projection.graphId,
      revision: projection.graphRevision
    }, `${envelope.commandDigest}:approved`));
    effects.push(executionEffect(context, requireDefinition(projection), options));
  }
  if (decision.kind === "resolve_conflict" && command.optionId === "retry") {
    if (hasPendingExecutionAttempt(projection)) {
      throw new Error(`Run ${context.runId} already has pending execution.`);
    }
    effects.push(executionEffect(
      context,
      requireDefinition(projection),
      options,
      nextExecutionAttempt(projection)
    ));
  }
  return { eventsAfterAcceptance: events, effects };
}

function deliveryEffects(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  command: Extract<ProductRunCommand, { type: "deliver_run" }>,
  options: ProductRunApplicationOptions
): RunActorDecision {
  const projection = requireProjection(context);
  if (projection.lifecycle !== "result_ready" || projection.finalCandidate === undefined) {
    throw new Error("Delivery requires a result_ready candidate.");
  }
  return {
    eventsAfterAcceptance: [event(options, context.runId, "delivery.started", {
      approval: command.approval
    }, envelope.commandDigest)],
    effects: [deliveryEffect(
      context,
      command.approval,
      projection.finalCandidate.finalManifest?.treeSha,
      options
    )]
  };
}

function deliveryEffect(
  context: Pick<RunActorDecisionContext, "runId" | "daemonEpoch">,
  approval: DeliveryApproval,
  treeSha: string | undefined,
  options: ProductRunApplicationOptions
): RunActorEffectRequest {
  return effectRequest({
    runId: context.runId,
    daemonEpoch: context.daemonEpoch,
    attemptId: "stage3:delivery",
    requestedAt: options.clock(),
    idempotency: "reconcile_then_repeat",
    inputSpec: {
      schemaVersion: 1,
      kind: "delivery",
      payload: {
        destinationRef: approval.targetBranch,
        expectedHeadSha: approval.targetHead,
        expectedTreeSha: treeSha ?? approval.targetHead,
        candidateCommitSha: approval.finalSha,
        candidateTreeSha: treeSha ?? approval.finalSha
      }
    }
  }, options);
}

/** Nothing was delegated, so the run waits where it is. */
const NOTHING_DELEGATED: DelegatedWork = { events: [], effects: [] };

interface DelegatedWork {
  readonly events: readonly RunEventInput[];
  readonly effects: readonly RunActorEffectRequest[];
}

/**
 * The plan approval an operator delegated when they started the run.
 *
 * It is answered here, in the actor, so the answer lands in the same journal as
 * the question and carries the authorization that produced it — a reader can
 * always tell a person's approval from a standing one. The revision being
 * approved comes out of the planning result rather than the projection, because
 * the projection at this point still predates the graph that was just compiled.
 */
function delegatedPlanApproval(
  planned: readonly RunEventInput[],
  context: RunActorReactionContext,
  options: ProductRunApplicationOptions,
  effectId: string
): DelegatedWork {
  const level = runAutonomy(context.projection.definition);
  const raised = planned.find((item): item is Extract<RunEventInput, { type: "decision.raised" }> =>
    item.type === "decision.raised" && item.payload.decision.kind === "approve_plan");
  if (raised === undefined) return NOTHING_DELEGATED;
  const optionId = autonomyResolution(level, raised.payload.decision);
  if (optionId === undefined) return NOTHING_DELEGATED;
  // Without a proposed revision nothing names what would be approved, and the
  // reducer rejects an approval for a revision the projection does not hold.
  const proposed = [...planned].reverse()
    .find((item): item is Extract<RunEventInput, { type: "graph.revision.proposed" }> =>
      item.type === "graph.revision.proposed");
  if (proposed === undefined) return NOTHING_DELEGATED;
  return {
    events: [
      event(options, context.runId, "decision.resolved", {
        decisionId: raised.payload.decision.id,
        optionId,
        authorizedBy: standingAuthorization(level)
      }, `${effectId}:delegated-plan-approval`),
      event(options, context.runId, "graph.revision.approved", {
        graphId: proposed.payload.graphId,
        revision: proposed.payload.revision
      }, `${effectId}:delegated-plan-approval`)
    ],
    effects: [executionEffect(context, requireDefinition(context.projection), options)]
  };
}

/**
 * Publication delegated at intake, for the one level that authorizes it.
 *
 * Whether the run actually finished is folded rather than inferred from the
 * shape of the execution result: the reducer that decides `result_ready` is the
 * same one the operator's own `deliver_run` command is checked against, so
 * there is no second opinion about when a run is done. The actor folds these
 * exact events immediately after this returns, so the fold costs nothing that
 * was not already going to happen.
 */
function delegatedDelivery(
  produced: readonly RunEventInput[],
  context: RunActorReactionContext,
  options: ProductRunApplicationOptions
): DelegatedWork {
  const level = runAutonomy(context.projection.definition);
  if (!autonomyPublishesDelivery(level)) return NOTHING_DELEGATED;
  const projection = foldRun([...context.events, ...appended(context, produced)]);
  const candidate = projection.finalCandidate;
  if (projection.lifecycle !== "result_ready" || candidate === undefined) return NOTHING_DELEGATED;
  const approval: DeliveryApproval = {
    manifestId: candidate.manifestId,
    finalSha: candidate.commit,
    targetBranch: candidate.targetBranch,
    targetHead: candidate.targetHead,
    targetFingerprint: candidate.sourceTargetFingerprint,
    // Named for what it is. An operator reading the journal later has to be
    // able to see that no person pressed anything here.
    actor: "autonomy_policy",
    idempotencyKey: `${context.runId}:${candidate.manifestId}:${candidate.commit}`
  };
  return {
    events: [event(options, context.runId, "delivery.started", { approval }, approval.idempotencyKey)],
    effects: [deliveryEffect(context, approval, candidate.finalManifest?.treeSha, options)]
  };
}

/** The sequence these inputs will occupy once the actor appends them. */
function appended(
  context: RunActorReactionContext,
  inputs: readonly RunEventInput[]
): RunEvent[] {
  const last = context.events.at(-1)?.sequence ?? 0;
  return inputs.map((input, index) => ({
    ...structuredClone(input),
    runId: context.runId,
    sequence: last + index + 1
  }) as RunEvent);
}

function planningEffect(
  envelope: RunCommandEnvelope,
  context: RunActorDecisionContext,
  definition: ProductRunDefinition,
  options: ProductRunApplicationOptions
): RunActorEffectRequest {
  return effectRequest({
    runId: context.runId,
    daemonEpoch: context.daemonEpoch,
    attemptId: "stage3:planning",
    requestedAt: options.clock(),
    idempotency: "reconcile_then_repeat",
    inputSpec: {
      schemaVersion: 1,
      kind: "model_call",
      payload: {
        repositoryViewDigest: stringField(definition.targetContext, "fingerprint"),
        requestDigest: envelope.commandDigest,
        modelProfileDigest: computeCanonicalDigest(definition.planningSelection, options.hasher)
      }
    }
  }, options);
}

function executionEffect(
  context: Pick<RunActorDecisionContext, "runId" | "daemonEpoch">,
  definition: ProductRunDefinition,
  options: ProductRunApplicationOptions,
  attemptId = "stage3:execution"
): RunActorEffectRequest {
  const execution = options.executionProcess(definition, {
    runId: context.runId,
    attemptId
  });
  return effectRequest({
    runId: context.runId,
    daemonEpoch: context.daemonEpoch,
    attemptId,
    requestedAt: options.clock(),
    idempotency: "reconcile_then_repeat",
    inputSpec: {
      schemaVersion: 1,
      kind: "process_spawn",
      payload: {
        executable: execution.executable,
        argv: execution.argv,
        cwd: execution.cwd,
        env: execution.env,
        ...(execution.timeoutMs === undefined ? {} : { timeoutMs: execution.timeoutMs })
      }
    }
  }, options);
}

function nextExecutionAttempt(projection: RunProjection): string {
  const count = Object.values(projection.effectIntents)
    .filter((intent) => intent.attemptId?.startsWith("stage3:execution") === true)
    .length;
  return `stage3:execution:recovery:${count}`;
}

function effectRequest(input: {
  runId: string;
  daemonEpoch: string;
  attemptId: string;
  requestedAt: string;
  idempotency: "repeat_safe" | "reconcile_then_repeat" | "never_repeat_unknown";
  inputSpec: EffectInputSpec;
}, options: ProductRunApplicationOptions): RunActorEffectRequest {
  const effectInput = buildEffectInput(input.inputSpec, options.hasher);
  return {
    inputSpec: input.inputSpec,
    intent: buildEffectIntent({
      runId: input.runId,
      attemptId: input.attemptId,
      kind: input.inputSpec.kind,
      inputDigest: effectInput.inputDigest,
      daemonEpoch: input.daemonEpoch,
      idempotency: input.idempotency,
      requestedAt: input.requestedAt
    }, options.hasher)
  };
}

function latestUnappliedPause(
  context: RunActorReactionContext
): Extract<ProductRunCommand, { type: "pause_run" }> | undefined {
  const accepted = [...context.events].reverse().find((item) => {
    if (item.type !== "command.accepted" || item.payload.command === undefined) return false;
    return item.payload.command.command.type === "pause_run";
  });
  if (accepted?.type !== "command.accepted" || accepted.payload.command === undefined) return undefined;
  if (context.events.some((item) => item.sequence > accepted.sequence && item.type === "run.pause_requested")) {
    return undefined;
  }
  const parsed = ProductRunCommandSchema.parse(accepted.payload.command.command);
  return parsed.type === "pause_run" ? parsed : undefined;
}

function allEffectsTerminal(projection: RunProjection): boolean {
  return Object.keys(projection.effectIntents)
    .every((effectId) => projection.effectTerminals[effectId] !== undefined);
}

function hasPendingAttempt(projection: RunProjection, attemptId: string): boolean {
  return Object.values(projection.effectIntents).some((intent) =>
    intent.attemptId === attemptId && projection.effectTerminals[intent.effectId] === undefined);
}

function hasPendingExecutionAttempt(projection: RunProjection): boolean {
  return Object.values(projection.effectIntents).some((intent) =>
    intent.attemptId?.startsWith("stage3:execution") === true &&
    projection.effectTerminals[intent.effectId] === undefined);
}

function requireProjection(context: RunActorDecisionContext): RunProjection {
  if (context.projection === undefined) throw new Error(`Run ${context.runId} does not exist.`);
  return context.projection;
}

function requireDefinition(projection: RunProjection): ProductRunDefinition {
  if (projection.definition === undefined) {
    throw new Error(`Run ${projection.runId} has no productive Stage 3 definition.`);
  }
  return projection.definition;
}

function terminalReceiptId(observation: RunActorTerminalObservation): string {
  const terminal = observation.receipts
    .filter((receipt) => receipt.observation !== "started")
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
  return terminal?.receiptId ?? `effect:${observation.intent.effectId}`;
}

function event<T extends RunEventInput["type"]>(
  options: ProductRunApplicationOptions,
  runId: string,
  type: T,
  payload: Extract<RunEventInput, { type: T }>["payload"],
  identity: string
): Extract<RunEventInput, { type: T }> {
  return {
    eventId: eventId(options, runId, type, identity),
    occurredAt: options.clock(),
    type,
    payload
  } as Extract<RunEventInput, { type: T }>;
}

function eventId(
  options: ProductRunApplicationOptions,
  runId: string,
  type: string,
  identity: string
): string {
  return computeCanonicalDigest({ runId, type, identity }, options.hasher);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Productive run definition is missing ${field}.`);
  }
  return value;
}
