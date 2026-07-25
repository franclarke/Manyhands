import type {
  TaskAcceptanceCriterion,
  ValidationObligation
} from "@manyhands/contracts";
import type { WorkUnit } from "../planner/schema.js";

export interface ValidationCompilationDependencies {
  idFor(kind: string, key: string): string;
}

export function compileAcceptanceCriterion(
  unit: WorkUnit,
  intent: { id: string; description: string; required: boolean },
  dependencies: ValidationCompilationDependencies
): TaskAcceptanceCriterion {
  return {
    id: dependencies.idFor("criterion", `${unit.key}-${intent.id}`),
    kind: validationLayerFor(unit),
    description: intent.description,
    required: intent.required
  };
}

export function compileLocalAcceptanceCriterion(
  unit: WorkUnit,
  dependencies: ValidationCompilationDependencies
): TaskAcceptanceCriterion {
  return {
    id: dependencies.idFor("criterion", `${unit.key}-local-outcome`),
    kind: validationLayerFor(unit),
    description: `Local outcome: ${unit.expectedOutcomes.join("; ")}`,
    required: true
  };
}

export function compileValidationObligation(
  unit: WorkUnit,
  criterion: TaskAcceptanceCriterion,
  dependencies: ValidationCompilationDependencies
): ValidationObligation {
  const layer = validationLayerFor(unit);
  return {
    id: dependencies.idFor("validation-obligation", `${unit.key}-${criterion.id}`),
    criterionId: criterion.id,
    layer,
    severity: criterion.required ? "required" : "advisory",
    acceptableEvidence: layer === "manual" ? ["manual_attestation"] : ["test_result"],
    baselinePolicy: "required",
    negativeControl: layer === "static" ? "not_required" : "when_feasible",
    flakyPolicy: "forbid"
  };
}

function validationLayerFor(unit: WorkUnit): TaskAcceptanceCriterion["kind"] & ValidationObligation["layer"] {
  const concerns = new Set(unit.concerns.map((concern) => concern.toLowerCase()));
  if (concerns.has("accessibility")) return "accessibility";
  if (concerns.has("security")) return "security";
  if (concerns.has("ui") && (concerns.has("api") || concerns.has("domain"))) return "e2e";
  if (concerns.has("api") || concerns.has("integration") || unit.concerns.length > 2) return "integration";
  if (concerns.has("types") || concerns.has("static")) return "static";
  return "unit";
}
