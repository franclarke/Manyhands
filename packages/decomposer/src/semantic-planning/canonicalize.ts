import { createHash } from "node:crypto";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  SemanticPlanDraftSchema,
  type CanonicalModule,
  type PlanningContext,
  type PlanningIssue,
  type PlanningProtocol,
  type SemanticPlan,
  type SemanticPlanDraft,
  type SemanticWorkDraft
} from "./model.js";

export type CanonicalizationResult =
  | { ok: true; plan: SemanticPlan }
  | { ok: false; issues: PlanningIssue[] };

export function canonicalizeSemanticPlan(
  rawDraft: unknown,
  context: PlanningContext,
  protocol: PlanningProtocol
): CanonicalizationResult {
  const parsed = SemanticPlanDraftSchema.safeParse(rawDraft);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_draft",
        message: issue.message,
        path: issue.path.join(".")
      }))
    };
  }

  const draft = normalizeDraft(parsed.data);
  const issues = semanticIssues(draft, context);
  if (issues.length > 0) return { ok: false, issues };

  const goalDigest = digest(context.goal);
  const protocolDigest = digest(protocol);
  const decisionSetDigest = digest(context.resolvedDecisions);
  const constraintSetDigest = digest(context.constraints ?? []);
  const planHash = digest({
    repositorySnapshotId: context.repositorySnapshot.snapshotId,
    goalDigest,
    decisionSetDigest,
    constraintSetDigest,
    root: draft.root,
    seams: draft.seams
  });
  const strategyHash = digest(strategyShape(draft));
  const planId = `semantic-plan:${planHash}`;
  const moduleIdsByHandle = new Map<string, string>();
  const root = canonicalModule(draft.root, "root", planHash, moduleIdsByHandle);
  const seams = draft.seams.map((seam, index) => ({
    seamId: `seam:${digest({ planHash, index, seam })}`,
    producerModuleId: requireHandle(moduleIdsByHandle, seam.producer),
    consumerModuleIds: seam.consumers.map((handle) => requireHandle(moduleIdsByHandle, handle)),
    interface: seam.interface,
    evidencePaths: seam.evidencePaths
  }));

  return {
    ok: true,
    plan: {
      schemaVersion: 1,
      planId,
      planHash,
      strategyHash,
      repositorySnapshotId: context.repositorySnapshot.snapshotId,
      goalDigest,
      protocolDigest,
      decisionSetDigest,
      constraintSetDigest,
      root,
      seams
    }
  };
}

function strategyShape(draft: SemanticPlanDraft): unknown {
  const roles = new Map<string, string>();
  const moduleShape = (module: SemanticWorkDraft): unknown => {
    if (module.kind === "leaf") {
      const shape = {
        kind: module.kind,
        surface: module.surface,
        outcomes: module.outcomes
          .map((outcome) => ({ covers: outcome.covers, verification: outcome.verification }))
          .sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)))
      };
      roles.set(module.handle, digest(shape));
      return shape;
    }
    const children = module.children
      .map(moduleShape)
      .sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
    const shape = { kind: module.kind, children };
    roles.set(module.handle, digest(shape));
    return shape;
  };
  const root = moduleShape(draft.root);
  const seams = draft.seams
    .map((seam) => ({
      producer: requireHandle(roles, seam.producer),
      consumers: seam.consumers.map((handle) => requireHandle(roles, handle)).sort(),
      interface: {
        kind: seam.interface.kind,
        specification: seam.interface.specification,
        compatibility: seam.interface.compatibility,
        materialization: seam.interface.materialization,
        artifactPaths: seam.interface.artifactPaths,
        verification: seam.interface.verification
      },
      evidencePaths: seam.evidencePaths
    }))
    .sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
  return { root, seams };
}

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableSerialize(value)).digest("hex")}`;
}

function canonicalModule(
  draft: SemanticWorkDraft,
  structuralPath: string,
  planHash: string,
  moduleIdsByHandle: Map<string, string>
): CanonicalModule {
  const moduleId = `module:${digest({ planHash, structuralPath, module: draft })}`;
  moduleIdsByHandle.set(draft.handle, moduleId);
  if (draft.kind === "leaf") {
    return {
      kind: "leaf",
      moduleId,
      title: draft.title,
      objective: draft.objective,
      surface: draft.surface,
      outcomes: draft.outcomes.map((outcome, index) => ({
        outcomeId: `outcome:${digest({ moduleId, index, outcome })}`,
        statement: outcome.statement,
        covers: outcome.covers,
        verification: outcome.verification
      }))
    };
  }
  return {
    kind: "composite",
    moduleId,
    title: draft.title,
    objective: draft.objective,
    children: draft.children.map((child, index) => canonicalModule(child, `${structuralPath}.${index}`, planHash, moduleIdsByHandle))
  };
}

function semanticIssues(draft: SemanticPlanDraft, context: PlanningContext): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const modules = flattenDraft(draft.root);
  const modulesByHandle = new Map(modules.map((module) => [module.handle, module]));
  const handles = new Set<string>();
  const indexedPaths = new Set(context.repositorySnapshot.index?.files.map((file) => normalizePath(file.path)) ?? []);
  const criterionIds = new Set(context.goal.requiredCriteria.map((criterion) => criterion.id));
  const coveredCriteria = new Set<string>();
  const criterionOwners = new Map<string, string>();

  for (const module of modules) {
    if (handles.has(module.handle)) {
      issues.push({ code: "duplicate_handle", message: `Module handle ${module.handle} is not unique.` });
    }
    handles.add(module.handle);
    if (module.kind !== "leaf") continue;

    for (const path of module.surface.existingPaths) {
      if (!indexedPaths.has(normalizePath(path))) {
        issues.push({ code: "ungrounded_existing_path", message: `Existing path ${path} is absent from the frozen repository snapshot.`, path });
      }
    }
    for (const path of [...module.surface.existingPaths, ...module.surface.plannedPaths]) {
      if (unsafePath(path)) issues.push({ code: "unsafe_scope_path", message: `Path ${path} is not repository-relative.`, path });
    }
    for (const outcome of module.outcomes) {
      for (const criterionId of outcome.covers) {
        if (!criterionIds.has(criterionId)) {
          issues.push({ code: "unknown_goal_criterion", message: `Outcome references unknown criterion ${criterionId}.` });
        } else {
          coveredCriteria.add(criterionId);
          const owner = criterionOwners.get(criterionId);
          if (owner !== undefined && owner !== module.handle) {
            issues.push({ code: "ambiguous_acceptance_owner", message: `Criterion ${criterionId} is owned by both ${owner} and ${module.handle}.` });
          } else {
            criterionOwners.set(criterionId, module.handle);
          }
        }
      }
      if (!hasRepositoryCapability(context.repositorySnapshot, outcome.verification.capability)) {
        issues.push({ code: "unknown_repository_capability", message: `Repository capability ${outcome.verification.capability} is unavailable.` });
      }
      for (const reference of outcome.verification.references) {
        if (!indexedPaths.has(normalizePath(reference))) {
          issues.push({ code: "ungrounded_verification_reference", message: `Verification reference ${reference} is absent from the frozen repository snapshot.`, path: reference });
        }
      }
    }
  }

  for (const criterion of context.goal.requiredCriteria) {
    if (!coveredCriteria.has(criterion.id)) {
      issues.push({ code: "uncovered_required_criterion", message: `Required criterion ${criterion.id} has no semantic owner.` });
    }
  }
  for (const seam of draft.seams) {
    const producer = modulesByHandle.get(seam.producer);
    if (producer === undefined) issues.push({ code: "unknown_seam_participant", message: `Seam producer ${seam.producer} does not resolve.` });
    else if (producer.kind !== "leaf") issues.push({ code: "non_executable_seam_participant", message: `Seam producer ${seam.producer} must be a leaf module.` });
    if (producer?.kind === "leaf") {
      const producerPaths = new Set([...producer.surface.existingPaths, ...producer.surface.plannedPaths].map(normalizePath));
      for (const artifactPath of seam.interface.artifactPaths) {
        if (unsafePath(artifactPath)) {
          issues.push({ code: "unsafe_artifact_path", message: `Seam artifact path ${artifactPath} is not repository-relative.`, path: artifactPath });
        } else if (!producerPaths.has(normalizePath(artifactPath))) {
          issues.push({ code: "artifact_outside_producer_surface", message: `Seam artifact ${artifactPath} is outside producer ${seam.producer}'s surface.`, path: artifactPath });
        }
      }
    }
    for (const consumer of seam.consumers) {
      const consumerModule = modulesByHandle.get(consumer);
      if (consumerModule === undefined) issues.push({ code: "unknown_seam_participant", message: `Seam consumer ${consumer} does not resolve.` });
      else if (consumerModule.kind !== "leaf") issues.push({ code: "non_executable_seam_participant", message: `Seam consumer ${consumer} must be a leaf module.` });
      if (consumer === seam.producer) issues.push({ code: "self_seam", message: `Seam ${seam.handle} cannot consume itself.` });
    }
    for (const evidencePath of seam.evidencePaths) {
      if (!indexedPaths.has(normalizePath(evidencePath))) {
        issues.push({ code: "ungrounded_seam_evidence", message: `Seam evidence ${evidencePath} is absent from the frozen repository snapshot.`, path: evidencePath });
      }
    }
  }
  for (const uncertainty of draft.uncertainties ?? []) {
    issues.push({ code: "unresolved_uncertainty", message: `The proposal leaves an unresolved semantic uncertainty: ${uncertainty}` });
  }
  return issues;
}

function normalizeDraft(draft: SemanticPlanDraft): SemanticPlanDraft {
  const normalizeModule = (module: SemanticWorkDraft): SemanticWorkDraft => module.kind === "leaf"
    ? {
        ...module,
        surface: {
          existingPaths: uniqueSorted(module.surface.existingPaths.map(normalizePath)),
          plannedPaths: uniqueSorted(module.surface.plannedPaths.map(normalizePath))
        },
        outcomes: module.outcomes.map((outcome) => ({
          ...outcome,
          covers: uniqueSorted(outcome.covers),
          verification: { ...outcome.verification, references: uniqueSorted(outcome.verification.references.map(normalizePath)) }
        }))
      }
    : { ...module, children: module.children.map(normalizeModule) };
  return {
    ...(draft.rationale === undefined ? {} : { rationale: draft.rationale }),
    root: normalizeModule(draft.root),
    seams: draft.seams.map((seam) => ({
      ...seam,
      consumers: uniqueSorted(seam.consumers),
      interface: { ...seam.interface, artifactPaths: uniqueSorted(seam.interface.artifactPaths.map(normalizePath)) },
      evidencePaths: uniqueSorted(seam.evidencePaths.map(normalizePath))
    })),
    ...(draft.uncertainties === undefined ? {} : { uncertainties: [...draft.uncertainties] })
  };
}

function flattenDraft(root: SemanticWorkDraft): SemanticWorkDraft[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenDraft)];
}

function hasRepositoryCapability(snapshot: RepositorySnapshot, capability: string): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot.capabilities.scripts, capability);
}

function requireHandle(ids: Map<string, string>, handle: string): string {
  const id = ids.get(handle);
  if (id === undefined) throw new Error(`Canonicalization lost semantic handle ${handle}.`);
  return id;
}

function unsafePath(value: string): boolean {
  const path = value.trim();
  return path.length === 0 || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/u.test(path) || path.startsWith("~") || normalizePath(path).split("/").includes("..");
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
