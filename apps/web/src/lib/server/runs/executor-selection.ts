import {
  DEFAULT_EXECUTOR_SELECTION,
  EXECUTOR_IDS,
  effortsForSelection,
  resolveLegacyModelSelection,
  supportsEffortForSelection,
  type EffortLevel,
  type ExecutorId,
  type StageSelection
} from "@manyhands/execution-core";
import { RunConfigurationError } from "./errors";
import type { RunRecord } from "./schema";

/**
 * The SINGLE authority that resolves a run's persisted configuration into a
 * complete {@link StageSelection} per stage (U2A-2). No other module reconstructs
 * `{executorId, model, effort}` from separate fields.
 *
 * Precedence, per stage:
 *   1. canonical StageSelection persisted (`run.{planning,execution,repair}Selection`)
 *   2. legacy stage-specific fields (`planningExecutorId`/`planningModel`;
 *      `defaultExecutionSelection`; `defaultRepairSelection`)
 *   3. stage fallback (execution → planning identity; repair → execution identity)
 *   4. legacy bare `model` string → its registered executor
 *   5. otherwise: explicit RunConfigurationError (never a silent executor remap)
 *
 * Effort, per stage: applied ONLY to models that declare effort support; taken
 * from the canonical stage effort, else the single legacy
 * `executionConfig.reasoningEffort` (historical global), and only when that value
 * is a member of the model's declared efforts. Never copied onto an effort-less
 * (e.g. Claude) model. A legacy effort incompatible with the resolved model is
 * dropped, never coerced.
 */
type RunSelectionView = Pick<
  RunRecord,
  | "model"
  | "planningModel"
  | "planningExecutorId"
  | "defaultExecutionSelection"
  | "defaultRepairSelection"
  | "planningSelection"
  | "executionSelection"
  | "repairSelection"
  | "executionConfig"
>;

interface Identity {
  executorId: ExecutorId;
  model: string;
}

const EXECUTOR_ID_SET = new Set<string>(EXECUTOR_IDS);
function isExecutorId(value: string | undefined): value is ExecutorId {
  return value !== undefined && EXECUTOR_ID_SET.has(value);
}

function fmt(identity: { executorId: string; model: string }): string {
  return `"${identity.executorId}/${identity.model}"`;
}

/**
 * Resolve a bare legacy `model` string (no executor context) to an executor.
 * A registered model resolves to its owning executor; an unrecognized string
 * falls back to the DEFAULT executor while preserving the model string verbatim
 * — the single documented legacy rule (historical runs on since-removed models
 * like `claude-opus-4.7` stay readable and never mutate into a *different*
 * model). New runs cannot introduce an unknown model: the create route rejects
 * a non-registered selection up front (validateSelectionForCapability), so F8's
 * "silent, unvalidated remap" is closed at the boundary that matters.
 */
function bareModelIdentity(model: string | undefined): Identity {
  const resolved = resolveLegacyModelSelection(model === undefined ? DEFAULT_EXECUTOR_SELECTION.model : model);
  return { executorId: resolved.executorId, model: resolved.model };
}

/** Reconcile a canonical stage selection with its legacy mirror, failing on contradiction. */
function resolveIdentity(
  stage: string,
  canonical: { executorId: ExecutorId; model: string } | undefined,
  legacy: Identity | undefined,
  bareModel: string | undefined
): Identity {
  if (canonical !== undefined) {
    const canonicalIdentity: Identity = { executorId: canonical.executorId, model: canonical.model };
    if (
      legacy !== undefined &&
      (legacy.executorId !== canonicalIdentity.executorId || legacy.model !== canonicalIdentity.model)
    ) {
      throw new RunConfigurationError(
        `${stage} canonical selection ${fmt(canonicalIdentity)} contradicts its legacy fields ${fmt(legacy)}.`
      );
    }
    return canonicalIdentity;
  }
  if (legacy !== undefined) {
    return legacy;
  }
  return bareModelIdentity(bareModel);
}

/** Attach the resolved effort (if the model supports it and the value is declared). */
function withEffort(
  identity: Identity,
  canonicalEffort: EffortLevel | undefined,
  legacyEffort: EffortLevel | undefined
): StageSelection {
  if (!supportsEffortForSelection(identity)) {
    return { executorId: identity.executorId, model: identity.model };
  }
  const declared = effortsForSelection(identity);
  const candidate = canonicalEffort ?? legacyEffort;
  if (candidate !== undefined && declared !== null && declared.includes(candidate)) {
    return { executorId: identity.executorId, model: identity.model, effort: candidate };
  }
  return { executorId: identity.executorId, model: identity.model };
}

function planningIdentity(run: RunSelectionView): Identity {
  const legacy: Identity | undefined = isExecutorId(run.planningExecutorId)
    ? { executorId: run.planningExecutorId, model: run.planningModel ?? run.model }
    : undefined;
  return resolveIdentity("Planning", run.planningSelection, legacy, run.planningModel ?? run.model);
}

function executionIdentity(run: RunSelectionView): Identity {
  const legacy: Identity | undefined =
    run.defaultExecutionSelection !== undefined
      ? { executorId: run.defaultExecutionSelection.executorId, model: run.defaultExecutionSelection.model }
      : undefined;
  if (run.executionSelection === undefined && legacy === undefined) {
    return planningIdentity(run);
  }
  return resolveIdentity("Execution", run.executionSelection, legacy, run.model);
}

function repairIdentity(run: RunSelectionView): Identity {
  const legacy: Identity | undefined =
    run.defaultRepairSelection !== undefined
      ? { executorId: run.defaultRepairSelection.executorId, model: run.defaultRepairSelection.model }
      : undefined;
  if (run.repairSelection === undefined && legacy === undefined) {
    return executionIdentity(run);
  }
  return resolveIdentity("Repair", run.repairSelection, legacy, run.model);
}

export function planningSelection(run: RunSelectionView): StageSelection {
  return withEffort(planningIdentity(run), run.planningSelection?.effort, run.executionConfig?.reasoningEffort);
}

export function executionSelection(run: RunSelectionView): StageSelection {
  return withEffort(executionIdentity(run), run.executionSelection?.effort, run.executionConfig?.reasoningEffort);
}

export function repairSelection(run: RunSelectionView): StageSelection {
  return withEffort(repairIdentity(run), run.repairSelection?.effort, run.executionConfig?.reasoningEffort);
}

export function groundingSelection(run: RunSelectionView): StageSelection {
  return executionSelection(run);
}

export function titlerSelection(run: RunSelectionView): StageSelection {
  return planningSelection(run);
}

/**
 * Display-safe resolution (never throws). Historical runs whose legacy config no
 * longer resolves — e.g. a retired executor/model removed from the registry —
 * must still RENDER. Execution paths use the strict resolvers above (which fail
 * explicitly on an unresolvable or contradictory config); only projection /
 * event-log fall back to these, preserving the persisted executor hint + model
 * string verbatim (never fabricating a different, valid-looking selection).
 * All fallback logic stays inside this single module.
 */
function displayIdentity(executorHint: string | undefined, model: string | undefined): StageSelection {
  const executorId =
    executorHint !== undefined && executorHint.trim().length > 0
      ? (executorHint as ExecutorId)
      : DEFAULT_EXECUTOR_SELECTION.executorId;
  return { executorId, model: model ?? DEFAULT_EXECUTOR_SELECTION.model };
}

export function planningSelectionForDisplay(run: RunSelectionView): StageSelection {
  try {
    return planningSelection(run);
  } catch {
    return displayIdentity(
      run.planningSelection?.executorId ?? run.planningExecutorId,
      run.planningSelection?.model ?? run.planningModel ?? run.model
    );
  }
}

export function executionSelectionForDisplay(run: RunSelectionView): StageSelection {
  try {
    return executionSelection(run);
  } catch {
    return displayIdentity(
      run.executionSelection?.executorId ?? run.defaultExecutionSelection?.executorId ?? run.planningExecutorId,
      run.executionSelection?.model ?? run.defaultExecutionSelection?.model ?? run.model
    );
  }
}

export function repairSelectionForDisplay(run: RunSelectionView): StageSelection {
  try {
    return repairSelection(run);
  } catch {
    return executionSelectionForDisplay(run);
  }
}
