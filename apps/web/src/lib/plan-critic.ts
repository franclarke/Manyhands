import { validateTaskGraph, type AgentTaskContract, type InterfaceContract, type TaskGraph } from "@manyhands/core";
import type { DetectedCommands } from "@/lib/server/providers/command-detection";
import type { CriticFinding, CriticStatus, PlanCriticResult, SeamCriticResult } from "@/lib/critic-types";

export type { CriticFinding, CriticSeverity, CriticStatus, PlanCriticResult, SeamCriticResult } from "@/lib/critic-types";

/**
 * Deterministic plan-quality critics. These run after decomposition without any
 * extra LLM calls — they reuse the graph validator, the contracts, and the
 * repository grounding to flag low-quality plans before execution. The LLM is
 * only spent on a repair round when these find blocking issues (a follow-up).
 */

/** Above this many implementation paths a leaf is treated as too broad to be atomic. */
const BROAD_SCOPE_PATH_THRESHOLD = 8;

function statusFor(findings: readonly CriticFinding[]): CriticStatus {
  if (findings.some((finding) => finding.severity === "error")) return "errors";
  if (findings.some((finding) => finding.severity === "warning")) return "warnings";
  return "clean";
}

function leafContractFor(
  contracts: readonly AgentTaskContract[],
  taskId: string
): AgentTaskContract | undefined {
  return contracts.find((contract) => contract.taskId === taskId);
}

function hasValidationCommands(contract: AgentTaskContract): boolean {
  return (
    (contract.validationCommands?.length ?? 0) > 0 ||
    (contract.leafValidationCommands?.length ?? 0) > 0
  );
}

/**
 * PlanCritic — graph structure + per-leaf readiness, plus validation-command
 * suggestions derived from the detected workspace commands (the
 * ValidationCommandSuggester). Pure and deterministic.
 */
export function runPlanCritic(input: {
  graph: TaskGraph;
  contracts: readonly AgentTaskContract[];
  detectedCommands?: DetectedCommands;
  generatedAt?: string;
}): PlanCriticResult {
  const findings: CriticFinding[] = [];

  for (const issue of validateTaskGraph(input.graph)) {
    findings.push({
      severity: issue.severity,
      code: issue.code,
      ...(issue.taskId !== undefined ? { taskId: issue.taskId } : {}),
      message: issue.message
    });
  }

  const leaves = Object.values(input.graph.nodes).filter((node) => node.kind === "leaf");
  const suggested = suggestedValidationCommand(input.detectedCommands);

  for (const leaf of leaves) {
    const contract = leafContractFor(input.contracts, leaf.id);
    if (contract === undefined) {
      findings.push({
        severity: "warning",
        code: "missing_contract",
        taskId: leaf.id,
        message: `${leaf.title} has no executable agent contract.`
      });
      continue;
    }

    const implementationPaths = contract.allowed?.paths ?? [];
    if (implementationPaths.length === 0) {
      findings.push({
        severity: "warning",
        code: "missing_scope",
        taskId: leaf.id,
        message: `${leaf.title} declares no allowed paths.`
      });
    } else if (implementationPaths.length > BROAD_SCOPE_PATH_THRESHOLD) {
      findings.push({
        severity: "warning",
        code: "broad_scope",
        taskId: leaf.id,
        message: `${leaf.title} spans ${implementationPaths.length} allowed paths — likely not atomic.`,
        suggestion: "Split this leaf, or tighten its allowed paths so it owns a single seam."
      });
    }

    if ((contract.acceptance?.length ?? 0) === 0) {
      findings.push({
        severity: "warning",
        code: "missing_acceptance",
        taskId: leaf.id,
        message: `${leaf.title} has no acceptance criteria.`
      });
    }

    if ((contract.expectedOutput?.changedFiles?.length ?? 0) === 0) {
      findings.push({
        severity: "warning",
        code: "missing_expected_files",
        taskId: leaf.id,
        message: `${leaf.title} does not declare expected changed files.`
      });
    }

    if (!hasValidationCommands(contract)) {
      findings.push({
        severity: suggested !== undefined ? "warning" : "info",
        code: "missing_validation_commands",
        taskId: leaf.id,
        message: `${leaf.title} has no validation commands; its result will not be checked.`,
        ...(suggested !== undefined ? { suggestion: `Add a validation command, e.g. \`${suggested}\`.` } : {})
      });
    }
  }

  return {
    status: statusFor(findings),
    findings,
    generatedAt: input.generatedAt ?? new Date().toISOString()
  };
}

function suggestedValidationCommand(commands: DetectedCommands | undefined): string | undefined {
  if (commands === undefined) return undefined;
  return commands.test ?? commands.build ?? commands.typecheck ?? commands.lint;
}

/**
 * SeamCritic — verifies the interface seams between sibling leaves are coherent:
 * every consumed seam has a producer, signatures are concrete and agree, and no
 * seam is produced without a consumer. Reuses the contracts' consumed/produced
 * interface declarations. Pure and deterministic.
 */
export function runSeamCritic(input: {
  graph: TaskGraph;
  contracts: readonly AgentTaskContract[];
  generatedAt?: string;
}): SeamCriticResult {
  const findings: CriticFinding[] = [];
  const seamIds = new Set<string>();

  // Producers: interface id → list of { taskId, signature }.
  const producers = new Map<string, Array<{ taskId: string; signature: string }>>();
  const consumers = new Map<string, Array<{ taskId: string; signature: string }>>();

  for (const contract of input.contracts) {
    for (const produced of contract.producedInterfaces ?? []) {
      seamIds.add(produced.id);
      appendSeam(producers, produced.id, contract.taskId, produced.signature);
      flagVagueSignature(findings, contract.taskId, produced, "produces");
    }
    for (const consumed of contract.consumedInterfaces ?? []) {
      seamIds.add(consumed.id);
      appendSeam(consumers, consumed.id, contract.taskId, consumed.signature);
      flagVagueSignature(findings, contract.taskId, consumed, "consumes");
    }
  }

  for (const [id, consumedBy] of consumers) {
    const producedBy = producers.get(id);
    if (producedBy === undefined || producedBy.length === 0) {
      for (const consumer of consumedBy) {
        findings.push({
          severity: "error",
          code: "orphan_consumed_seam",
          taskId: consumer.taskId,
          message: `Seam "${id}" is consumed by ${consumer.taskId} but no leaf produces it.`,
          suggestion: "Add a producer leaf for this seam, or drop the dependency."
        });
      }
      continue;
    }
    // Signature agreement between producer and consumer for the same seam id.
    const producerSignature = producedBy[0]!.signature;
    for (const consumer of consumedBy) {
      if (normalizeSignature(consumer.signature) !== normalizeSignature(producerSignature)) {
        // Warning, not error: string-level signature comparison is unreliable
        // (param names, formatting, aliases) so this must not gate approval.
        findings.push({
          severity: "warning",
          code: "seam_signature_mismatch",
          taskId: consumer.taskId,
          message: `Seam "${id}" is consumed with a signature that differs from its producer (${producedBy[0]!.taskId}).`,
          suggestion: "Align the consumed and produced signatures so the leaves compose."
        });
      }
    }
  }

  for (const [id, producedBy] of producers) {
    if (!consumers.has(id)) {
      for (const producer of producedBy) {
        findings.push({
          severity: "warning",
          code: "unconsumed_seam",
          taskId: producer.taskId,
          message: `Seam "${id}" is produced by ${producer.taskId} but no leaf consumes it.`,
          suggestion: "Remove the seam if it is not needed, or wire a consumer."
        });
      }
    }
  }

  return {
    status: statusFor(findings),
    seamCount: seamIds.size,
    findings,
    generatedAt: input.generatedAt ?? new Date().toISOString()
  };
}

function appendSeam(
  map: Map<string, Array<{ taskId: string; signature: string }>>,
  id: string,
  taskId: string,
  signature: string
): void {
  const existing = map.get(id);
  if (existing === undefined) {
    map.set(id, [{ taskId, signature }]);
  } else {
    existing.push({ taskId, signature });
  }
}

function flagVagueSignature(
  findings: CriticFinding[],
  taskId: string,
  seam: InterfaceContract,
  direction: "produces" | "consumes"
): void {
  const sig = seam.signature.trim();
  // Only flag genuinely empty/placeholder signatures. Heuristics like length<8
  // or the token "any" misfire on legitimate TS (`() => void`, `Record<...,any>`).
  const vague =
    sig.length === 0 ||
    sig.toLowerCase() === seam.id.toLowerCase() ||
    /\b(todo|tbd)\b/i.test(sig);
  if (vague) {
    findings.push({
      severity: "warning",
      code: "vague_seam_signature",
      taskId,
      message: `Seam "${seam.id}" (${direction}) has a vague signature: "${sig}".`,
      suggestion: "Give the seam a concrete TypeScript signature so leaves build against the same contract."
    });
  }
}

function normalizeSignature(signature: string): string {
  return signature.replace(/\s+/g, " ").trim();
}
