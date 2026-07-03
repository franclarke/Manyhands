import type { AgentExecutionResult, PreMergeFinding } from "../types";

export interface PreMergeChildIntent {
  taskId: string;
  produces: string[];
  consumes: string[];
}

export interface PreMergeInput {
  childResults: ReadonlyArray<Pick<AgentExecutionResult, "taskId" | "changedFiles" | "diff">>;
  childIntents?: ReadonlyArray<PreMergeChildIntent>;
}

/**
 * Deterministic compatibility check run before cherry-pick. It predicts likely
 * textual conflicts (files touched by more than one child) and unfulfilled seams
 * (consumed without a producer, or produced without a trace in the diff). The
 * findings are surfaced on the IntegrationResult and fed into the single repair
 * attempt's prompt so it resolves with a precise diagnosis (Fase 3.1).
 */
export function computePreMergeFindings(input: PreMergeInput): PreMergeFinding[] {
  const findings: PreMergeFinding[] = [];

  // 1. Files changed by more than one child → a cherry-pick conflict is likely.
  const fileOwners = new Map<string, Set<string>>();
  for (const child of input.childResults) {
    for (const file of child.changedFiles ?? []) {
      const owners = fileOwners.get(file) ?? new Set<string>();
      owners.add(child.taskId);
      fileOwners.set(file, owners);
    }
  }
  const contested = [...fileOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([file]) => file)
    .sort();
  if (contested.length > 0) {
    findings.push({
      severity: "warning",
      code: "likely_textual_conflict",
      message: `${contested.length} file(s) are changed by more than one child; a cherry-pick conflict is likely.`,
      files: contested
    });
  }

  // 2/3. Seam coverage across the integrated children.
  const intents = input.childIntents ?? [];
  if (intents.length > 0) {
    const produced = new Set<string>();
    for (const intent of intents) {
      for (const id of intent.produces) produced.add(id);
    }

    const missingProducers = new Map<string, Set<string>>();
    for (const intent of intents) {
      for (const id of intent.consumes) {
        if (!produced.has(id)) {
          const consumers = missingProducers.get(id) ?? new Set<string>();
          consumers.add(intent.taskId);
          missingProducers.set(id, consumers);
        }
      }
    }
    for (const [id, consumers] of [...missingProducers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      findings.push({
        severity: "warning",
        code: "missing_producer",
        message: `Seam "${id}" is consumed by ${[...consumers].sort().join(", ")} but no integrated child produces it.`,
        files: []
      });
    }

    const byTask = new Map(input.childResults.map((child) => [child.taskId, child]));
    for (const intent of intents) {
      for (const id of intent.produces) {
        const child = byTask.get(intent.taskId);
        const diff = child?.diff ?? "";
        if (diff.length > 0 && !diff.includes(id)) {
          findings.push({
            severity: "info",
            code: "seam_not_in_diff",
            message: `Child ${intent.taskId} claims to produce seam "${id}" but its diff does not mention it.`,
            files: []
          });
        }
      }
    }
  }

  return findings;
}
