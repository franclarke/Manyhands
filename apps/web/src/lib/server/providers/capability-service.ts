import {
  EXECUTOR_DESCRIPTORS,
  defaultEffortForSelection,
  findExecutorDescriptor,
  findExecutorModel,
  type EffortLevel,
  type ExecutorCapability,
  type StageSelection
} from "@manyhands/shared";
import type {
  CapabilitiesResponse,
  ExecutorCapabilityView,
  ProviderReadiness,
  Workspace
} from "@/lib/api-types";
import { ExecutorUnavailableError, RunValidationError } from "../runs/errors";
import { inspectProvidersReadiness } from "./readiness";

export interface CapabilityServiceDeps {
  inspectReadiness?: (workspace: Workspace | null) => Promise<ProviderReadiness[]>;
}

type StageSelectionInput = {
  executorId: StageSelection["executorId"];
  model: string;
  effort?: EffortLevel | undefined;
};

/** Validate one complete stage selection against the declarative registry. */
export function assertDeclaredStageSelection(
  label: string,
  selection: StageSelectionInput,
  capability: ExecutorCapability
): StageSelection {
  const descriptor = findExecutorDescriptor(selection.executorId);
  const model = descriptor === undefined ? undefined : findExecutorModel(selection);
  if (descriptor === undefined || !descriptor.enabled || model === undefined) {
    throw new RunValidationError(
      `Unsupported executor/model selection "${selection.executorId}/${selection.model}".`
    );
  }
  if (!descriptor.capabilities.includes(capability) || !model.capabilities.includes(capability)) {
    throw new RunValidationError(
      `${label} selection "${selection.executorId}/${selection.model}" does not support ${capability}.`
    );
  }
  if (selection.effort !== undefined) {
    if (model.efforts === null) {
      throw new RunValidationError(
        `${label} selection "${selection.executorId}/${selection.model}" does not support a reasoning effort.`
      );
    }
    if (!model.efforts.includes(selection.effort)) {
      throw new RunValidationError(
        `${label} selection "${selection.executorId}/${selection.model}" does not allow reasoning effort "${selection.effort}".`
      );
    }
    return { executorId: selection.executorId, model: selection.model, effort: selection.effort };
  }
  const defaultEffort = defaultEffortForSelection(selection);
  return defaultEffort === undefined
    ? { executorId: selection.executorId, model: selection.model }
    : { executorId: selection.executorId, model: selection.model, effort: defaultEffort };
}

/** Fuse declared registry data with actual CLI/auth/workspace readiness. */
export async function inspectCapabilities(
  workspace: Workspace | null,
  deps: CapabilityServiceDeps = {}
): Promise<CapabilitiesResponse> {
  const readiness = await (deps.inspectReadiness ?? inspectProvidersReadiness)(workspace);
  const readinessByExecutor = new Map(readiness.map((entry) => [entry.executorId, entry]));
  const executors: ExecutorCapabilityView[] = EXECUTOR_DESCRIPTORS.map((descriptor) => ({
    executorId: descriptor.id,
    label: descriptor.label,
    provider: descriptor.provider,
    enabled: descriptor.enabled,
    readiness: readinessByExecutor.get(descriptor.id) ?? missingReadiness(descriptor.id, descriptor.label),
    models: descriptor.models.map((model) => ({
      id: model.id,
      label: model.label,
      capabilities: [...model.capabilities],
      usage: model.usageSource,
      efforts: model.efforts === null ? null : [...model.efforts],
      ...(model.defaultEffort !== undefined ? { defaultEffort: model.defaultEffort } : {})
    }))
  }));
  return { executors };
}

/** Reject a declared selection when its executor is not currently runnable. */
export function assertAvailableSelection(
  capabilities: CapabilitiesResponse,
  selection: StageSelection,
  label: string
): void {
  const executor = capabilities.executors.find((entry) => entry.executorId === selection.executorId);
  if (executor === undefined || !executor.enabled || executor.readiness.status === "error") {
    const failure = executor?.readiness.checks.find((check) => check.status === "fail")?.message;
    throw new ExecutorUnavailableError(
      failure ?? `${label} executor "${selection.executorId}" is not available.`
    );
  }
}

function missingReadiness(executorId: ExecutorCapabilityView["executorId"], label: string): ProviderReadiness {
  return {
    executorId,
    label,
    status: "error",
    binaryPath: "",
    quota: "unknown",
    checks: [{ id: "cli", status: "fail", label, message: `No se pudo verificar ${label}.` }]
  };
}
