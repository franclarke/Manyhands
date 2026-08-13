import type { EpistemicAssessment } from "@manyhands/shared";

import { repositoryDigest, repositoryFactId } from "./identity.js";
import type { RepositoryModel, RepositoryResourceRecord } from "./repository-model.js";

export type ResourceOverlap = "yes" | "no" | "unknown";

export interface CatalogResource {
  id: string;
  kind: RepositoryResourceRecord["kind"];
  canonicalLocator: string;
  path?: string;
  gitEntryKind?: RepositoryResourceRecord["gitEntryKind"];
  evidenceRefs: string[];
  epistemic: EpistemicAssessment;
  generated: GeneratedFileDisposition;
}

export interface GeneratedFileDisposition {
  state: "generated" | "source" | "unknown";
  reason: string;
  evidenceRefs: string[];
  regenerationCommand?: string;
}

export interface CatalogContainment {
  containerId: string;
  memberId: string;
  evidenceRefs: string[];
}

export interface CatalogAlias {
  locator: string;
  resourceId: string;
  reason: "same_path" | "rename" | "symlink" | "package_export";
  evidenceRefs: string[];
}

export type ResourceResolution =
  | { state: "known"; resource: CatalogResource; evidenceRefs: string[] }
  | { state: "conflicting"; resources: CatalogResource[]; evidenceRefs: string[] }
  | { state: "unknown"; reason: string; evidenceRefs: [] };

export interface ResourceCatalogMaterial {
  schemaVersion: 1;
  repositoryContentDigest: string;
  resources: Record<string, CatalogResource>;
  contains: CatalogContainment[];
  aliases: CatalogAlias[];
  coverage: {
    state: "known" | "partial" | "unknown";
    evidenceRefs: string[];
  };
}

export interface ResourceAliasInput {
  locator: string;
  targetLocator: string;
  reason: CatalogAlias["reason"];
  evidenceRefs: string[];
}

export class ResourceCatalog {
  readonly schemaVersion = 1 as const;
  readonly repositoryContentDigest: string;
  readonly resources: Record<string, CatalogResource>;
  readonly contains: CatalogContainment[];
  readonly aliases: CatalogAlias[];
  readonly coverage: ResourceCatalogMaterial["coverage"];
  readonly digest: string;

  private readonly resourcesByLocator: ReadonlyMap<string, readonly CatalogResource[]>;
  private readonly containersByMember: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly gitlinks: readonly CatalogResource[];

  constructor(material: ResourceCatalogMaterial) {
    this.repositoryContentDigest = material.repositoryContentDigest;
    this.resources = material.resources;
    this.contains = material.contains;
    this.aliases = material.aliases;
    this.coverage = material.coverage;
    this.digest = repositoryDigest(material);

    const resourcesByLocator = new Map<string, CatalogResource[]>();
    const aliasedLocators = new Set(this.aliases.map((alias) => alias.locator));
    const aliasTargetsByLocator = new Map<string, CatalogResource[]>();
    for (const alias of this.aliases) {
      const target = this.resources[alias.resourceId];
      if (target !== undefined) append(aliasTargetsByLocator, alias.locator, target);
    }
    for (const resource of Object.values(this.resources)) {
      const canonicalTargets = aliasTargetsByLocator.get(resource.canonicalLocator);
      if (canonicalTargets === undefined) {
        append(resourcesByLocator, resource.id, resource);
      } else {
        canonicalTargets.forEach((target) => append(resourcesByLocator, resource.id, target));
      }
      if (!aliasedLocators.has(resource.canonicalLocator)) {
        append(resourcesByLocator, resource.canonicalLocator, resource);
      }
    }
    for (const alias of this.aliases) {
      const resource = this.resources[alias.resourceId];
      if (resource !== undefined) append(resourcesByLocator, alias.locator, resource);
    }
    this.resourcesByLocator = new Map([...resourcesByLocator.entries()].map(([key, values]) => [
      key,
      uniqueResources(values)
    ]));

    const containers = new Map<string, Set<string>>();
    for (const relation of this.contains) {
      const current = containers.get(relation.memberId) ?? new Set<string>();
      current.add(relation.containerId);
      containers.set(relation.memberId, current);
    }
    this.containersByMember = containers;
    this.gitlinks = Object.values(this.resources).filter((resource) => resource.gitEntryKind === "gitlink");
  }

  resolve(reference: string): ResourceResolution {
    const candidates = this.resourcesByLocator.get(reference) ?? [];
    if (candidates.length === 1) {
      return {
        state: "known",
        resource: candidates[0]!,
        evidenceRefs: [...candidates[0]!.evidenceRefs]
      };
    }
    if (candidates.length > 1) {
      return {
        state: "conflicting",
        resources: [...candidates],
        evidenceRefs: [...new Set(candidates.flatMap((candidate) => candidate.evidenceRefs))].sort()
      };
    }
    return {
      state: "unknown",
      reason: this.isInsideGitlink(reference)
        ? "The reference is inside a gitlink whose contents were not inspected."
        : `Resource ${reference} is not covered by this repository view.`,
      evidenceRefs: []
    };
  }

  overlaps(leftReference: string, rightReference: string): ResourceOverlap {
    const left = this.resolve(leftReference);
    const right = this.resolve(rightReference);
    if (left.state !== "known" || right.state !== "known") return "unknown";
    if (left.resource.epistemic.state !== "known" || right.resource.epistemic.state !== "known") return "unknown";
    if (left.resource.id === right.resource.id) return "yes";
    if (this.containsResource(left.resource.id, right.resource.id)) return "yes";
    if (this.containsResource(right.resource.id, left.resource.id)) return "yes";
    return "no";
  }

  neighborhood(reference: string, depth: number): CatalogResource[] {
    if (!Number.isSafeInteger(depth) || depth < 0) throw new Error("Resource neighborhood depth must be a non-negative integer.");
    const resolved = this.resolve(reference);
    if (resolved.state !== "known") return [];
    const visited = new Set([resolved.resource.id]);
    let frontier = [resolved.resource.id];
    for (let level = 0; level < depth; level += 1) {
      const next = new Set<string>();
      for (const resourceId of frontier) {
        for (const relation of this.contains) {
          if (relation.containerId === resourceId && !visited.has(relation.memberId)) next.add(relation.memberId);
          if (relation.memberId === resourceId && !visited.has(relation.containerId)) next.add(relation.containerId);
        }
      }
      frontier = [...next].sort();
      frontier.forEach((id) => visited.add(id));
    }
    return [...visited].map((id) => this.resources[id]!).sort((left, right) => left.id.localeCompare(right.id));
  }

  asOverlapQuery(): { overlap(leftResourceId: string, rightResourceId: string): ResourceOverlap } {
    return { overlap: (left, right) => this.overlaps(left, right) };
  }

  private containsResource(containerId: string, memberId: string): boolean {
    const pending = [memberId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const parents = this.containersByMember.get(current) ?? new Set<string>();
      if (parents.has(containerId)) return true;
      pending.push(...parents);
    }
    return false;
  }

  private isInsideGitlink(reference: string): boolean {
    const locator = reference.startsWith("path:") ? reference.slice("path:".length) : reference;
    return this.gitlinks.some((resource) =>
      resource.path !== undefined && locator.startsWith(`${resource.path}/`)
    );
  }
}

export function buildResourceCatalog(input: {
  model: RepositoryModel;
  repositoryContentDigest: string;
  aliases?: readonly ResourceAliasInput[];
}): ResourceCatalog {
  const modelResources = deduplicateModelResources(input.model.resources);
  const resources = Object.fromEntries(modelResources.map((resource) => {
    const id = repositoryFactId("catalog-resource", {
      repositoryContentDigest: input.repositoryContentDigest,
      locator: resource.canonicalLocator
    });
    return [id, {
      id,
      kind: resource.kind,
      canonicalLocator: resource.canonicalLocator,
      ...(resource.path === undefined ? {} : { path: resource.path }),
      ...(resource.gitEntryKind === undefined ? {} : { gitEntryKind: resource.gitEntryKind }),
      evidenceRefs: [...resource.evidenceRefs].sort(),
      epistemic: resource.epistemic,
      generated: generatedDisposition(resource, input.model)
    } satisfies CatalogResource];
  }));
  const byLocator = new Map(Object.values(resources).map((resource) => [resource.canonicalLocator, resource]));
  const contains: CatalogContainment[] = [];
  const aliases: CatalogAlias[] = [];

  for (const resource of Object.values(resources)) {
    if (resource.path === undefined) continue;
    const pathResource = byLocator.get(`path:${resource.path}`);
    if (pathResource !== undefined && pathResource.id !== resource.id) {
      aliases.push({
        locator: resource.canonicalLocator,
        resourceId: pathResource.id,
        reason: "same_path",
        evidenceRefs: [...new Set([...resource.evidenceRefs, ...pathResource.evidenceRefs])].sort()
      });
    }
  }

  for (const packageBoundary of input.model.packages) {
    const packageResource = byLocator.get(`package:${packageBoundary.rootPath || "."}`);
    if (packageResource === undefined) continue;
    for (const member of Object.values(resources)) {
      if (member.path === undefined || member.id === packageResource.id) continue;
      if (packageBoundary.rootPath !== "" && !member.path.startsWith(`${packageBoundary.rootPath}/`)) continue;
      contains.push({
        containerId: packageResource.id,
        memberId: member.id,
        evidenceRefs: [...new Set([...packageBoundary.evidenceRefs, ...member.evidenceRefs])].sort()
      });
    }
  }

  for (const symbol of input.model.symbols) {
    const moduleResource = byLocator.get(`module:${symbol.modulePath}`) ?? byLocator.get(`path:${symbol.modulePath}`);
    const symbolResource = byLocator.get(`symbol:${symbol.modulePath}#${symbol.name}`);
    if (moduleResource === undefined || symbolResource === undefined) continue;
    contains.push({
      containerId: moduleResource.id,
      memberId: symbolResource.id,
      evidenceRefs: [...new Set([...moduleResource.evidenceRefs, ...symbolResource.evidenceRefs])].sort()
    });
  }

  for (const boundary of input.model.packages) {
    for (const [exportKey, exportTarget] of Object.entries(boundary.exportTargets)) {
      const targetPath = pathInPackage(boundary.rootPath, exportTarget);
      const target = byLocator.get(`path:${targetPath}`) ?? byLocator.get(`module:${targetPath}`);
      if (target === undefined) continue;
      aliases.push({
        locator: `package-export:${boundary.name}${exportKey === "." ? "" : exportKey.slice(1)}`,
        resourceId: target.id,
        reason: "package_export",
        evidenceRefs: [...new Set([...boundary.evidenceRefs, ...target.evidenceRefs])].sort()
      });
    }
  }

  for (const inputAlias of input.aliases ?? []) {
    const target = byLocator.get(inputAlias.targetLocator);
    if (target === undefined) continue;
    aliases.push({
      locator: inputAlias.locator,
      resourceId: target.id,
      reason: inputAlias.reason,
      evidenceRefs: [...new Set(inputAlias.evidenceRefs)].sort()
    });
  }

  const material: ResourceCatalogMaterial = {
    schemaVersion: 1,
    repositoryContentDigest: input.repositoryContentDigest,
    resources,
    contains: uniqueRelations(contains),
    aliases: uniqueAliases(aliases),
    coverage: {
      state: input.model.coverage.disposition,
      evidenceRefs: [...input.model.coverage.evidenceRefs].sort()
    }
  };
  return new ResourceCatalog(material);
}

function generatedDisposition(
  resource: RepositoryResourceRecord,
  model: RepositoryModel
): GeneratedFileDisposition {
  const resourcePath = resource.path;
  if (resourcePath === undefined) {
    return { state: "unknown", reason: "The resource has no path-level generated-file evidence.", evidenceRefs: [] };
  }
  const basename = resourcePath.split("/").at(-1)!;
  const owningPackage = [...model.packages]
    .filter((boundary) => boundary.rootPath === "" || resourcePath.startsWith(`${boundary.rootPath}/`))
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
  const regenerationCommand = owningPackage === undefined
    ? undefined
    : model.commands.find((command) => command.packageId === owningPackage.id && command.name === "generate");
  if (["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"].includes(basename)) {
    return {
      state: "generated",
      reason: "The path is a package-manager lockfile.",
      evidenceRefs: [...resource.evidenceRefs],
      ...(regenerationCommand === undefined ? {} : { regenerationCommand: regenerationCommand.command })
    };
  }
  if (/(?:^|\/)(?:dist|generated|__generated__)(?:\/|$)|\.generated\.[^/]+$/u.test(resourcePath)) {
    return {
      state: "generated",
      reason: "The path matches an explicit generated-output convention; ownership must remain with its generator.",
      evidenceRefs: [...resource.evidenceRefs],
      ...(regenerationCommand === undefined ? {} : { regenerationCommand: regenerationCommand.command })
    };
  }
  if (resource.gitEntryKind === "symlink" || resource.gitEntryKind === "gitlink") {
    return {
      state: "unknown",
      reason: `${resource.gitEntryKind} content provenance is external to the indexed file surface.`,
      evidenceRefs: [...resource.evidenceRefs]
    };
  }
  return {
    state: "unknown",
    reason: "No explicit generated-output policy classifies this exact Git entry as source or generated.",
    evidenceRefs: [...resource.evidenceRefs]
  };
}

function pathInPackage(rootPath: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\.\//u, "");
  return rootPath === "" ? normalized : `${rootPath}/${normalized}`;
}

function deduplicateModelResources(resources: readonly RepositoryResourceRecord[]): RepositoryResourceRecord[] {
  const byLocator = new Map<string, RepositoryResourceRecord>();
  for (const resource of resources) {
    const existing = byLocator.get(resource.canonicalLocator);
    if (existing === undefined || resource.kind === "integration_surface" || resource.kind === "schema") {
      byLocator.set(resource.canonicalLocator, resource);
    }
  }
  return [...byLocator.values()].sort((left, right) => left.canonicalLocator.localeCompare(right.canonicalLocator));
}

function append(map: Map<string, CatalogResource[]>, key: string, value: CatalogResource): void {
  const current = map.get(key) ?? [];
  current.push(value);
  map.set(key, current);
}

function uniqueResources(resources: readonly CatalogResource[]): CatalogResource[] {
  return [...new Map(resources.map((resource) => [resource.id, resource])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueRelations(relations: readonly CatalogContainment[]): CatalogContainment[] {
  return [...new Map(relations.map((relation) => [
    `${relation.containerId}\0${relation.memberId}`,
    relation
  ])).values()].sort((left, right) =>
    `${left.containerId}\0${left.memberId}`.localeCompare(`${right.containerId}\0${right.memberId}`)
  );
}

function uniqueAliases(aliases: readonly CatalogAlias[]): CatalogAlias[] {
  return [...new Map(aliases.map((alias) => [`${alias.locator}\0${alias.resourceId}`, alias])).values()]
    .sort((left, right) => `${left.locator}\0${left.resourceId}`.localeCompare(`${right.locator}\0${right.resourceId}`));
}
