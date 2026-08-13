import path from "node:path";

import type { EpistemicAssessment } from "@manyhands/shared";

import { repositoryDigest } from "./identity.js";
import { readBlob } from "./repository-model.js";
import type { RepositoryView } from "./repository-view.js";

export interface RepositoryQueryBudget {
  maxResults: number;
  maxBytes: number;
  maxDepth: number;
}

export interface RepositoryQueryCost {
  results: number;
  bytes: number;
  visited: number;
}

export interface RepositoryQueryItem {
  id: string;
  kind: "package" | "module" | "symbol" | "relationship" | "test" | "command" | "diagnostic" | "resource";
  locator: string;
  summary: string;
  evidenceRefs: string[];
  epistemic: EpistemicAssessment;
  name?: string;
}

export interface RepositoryExcerptItem extends RepositoryQueryItem {
  kind: "resource";
  text: string;
  truncated: boolean;
}

export interface RepositoryQueryAnswer<T extends RepositoryQueryItem = RepositoryQueryItem> {
  viewDigest: string;
  items: T[];
  budget: RepositoryQueryBudget;
  cost: RepositoryQueryCost;
  truncated: boolean;
  epistemic: EpistemicAssessment;
  evidenceRefs: string[];
  digest: string;
}

export interface RepositoryQuery {
  searchGoalTerms(terms: readonly string[], budget: RepositoryQueryBudget): RepositoryQueryAnswer;
  inspectBoundary(reference: string, budget: RepositoryQueryBudget): RepositoryQueryAnswer;
  dependencyNeighborhood(reference: string, budget: RepositoryQueryBudget): RepositoryQueryAnswer;
  relatedSymbols(reference: string, budget: RepositoryQueryBudget): RepositoryQueryAnswer;
  relatedTests(reference: string, budget: RepositoryQueryBudget): RepositoryQueryAnswer;
  validationCapabilities(budget: RepositoryQueryBudget): RepositoryQueryAnswer;
  readExcerpts(references: readonly string[], budget: RepositoryQueryBudget): Promise<RepositoryQueryAnswer<RepositoryExcerptItem>>;
}

export function createRepositoryQuery(input: {
  rootPath: string;
  view: RepositoryView;
  gitPath?: string;
}): RepositoryQuery {
  const rootPath = path.resolve(input.rootPath);
  const gitPath = input.gitPath ?? "git";
  const { view } = input;

  return {
    searchGoalTerms(terms, budget) {
      const checked = validateBudget(budget);
      const normalizedTerms = [...new Set(terms.map(normalizeTerm).filter((term) => term.length > 0))].sort();
      const candidates = searchCandidates(view).map((item) => ({
        item,
        score: normalizedTerms.reduce((score, term) => score + matches(item, term), 0)
      })).filter(({ score }) => score > 0).sort((left, right) =>
        right.score - left.score || left.item.kind.localeCompare(right.item.kind) || left.item.locator.localeCompare(right.item.locator)
      ).map(({ item }) => item);
      return answer(view, candidates, checked, candidates.length);
    },

    inspectBoundary(reference, budget) {
      const checked = validateBudget(budget);
      const resources = view.catalog.neighborhood(reference, checked.maxDepth).map((resource) => ({
        id: resource.id,
        kind: "resource" as const,
        locator: resource.canonicalLocator,
        summary: resource.path ?? resource.canonicalLocator,
        evidenceRefs: [...resource.evidenceRefs],
        epistemic: resource.epistemic
      }));
      return answer(view, resources, checked, Object.keys(view.catalog.resources).length);
    },

    dependencyNeighborhood(reference, budget) {
      const checked = validateBudget(budget);
      const modulePath = resolveModulePath(view, reference);
      if (modulePath === undefined) return answer(view, [], checked, 0);
      const visited = new Set([modulePath]);
      let frontier = [modulePath];
      for (let depth = 0; depth < checked.maxDepth; depth += 1) {
        const next = new Set<string>();
        for (const relation of view.model.relationships) {
          if (relation.resolvedModulePath === undefined) continue;
          if (frontier.includes(relation.fromModulePath) && !visited.has(relation.resolvedModulePath)) {
            next.add(relation.resolvedModulePath);
          }
          if (frontier.includes(relation.resolvedModulePath) && !visited.has(relation.fromModulePath)) {
            next.add(relation.fromModulePath);
          }
        }
        frontier = [...next].sort();
        frontier.forEach((candidate) => visited.add(candidate));
      }
      const modules = view.model.modules.filter((module) => visited.has(module.path) && module.path !== modulePath)
        .map(moduleItem);
      return answer(view, modules, checked, view.model.relationships.length);
    },

    relatedSymbols(reference, budget) {
      const checked = validateBudget(budget);
      const modulePath = resolveModulePath(view, reference);
      if (modulePath === undefined) return answer(view, [], checked, 0);
      const relatedModules = new Set([modulePath]);
      if (checked.maxDepth > 0) {
        for (const relationship of view.model.relationships) {
          if (relationship.resolvedModulePath === undefined) continue;
          if (relationship.fromModulePath === modulePath) relatedModules.add(relationship.resolvedModulePath);
          if (relationship.resolvedModulePath === modulePath) relatedModules.add(relationship.fromModulePath);
        }
      }
      const symbols = view.model.symbols.filter((symbol) => relatedModules.has(symbol.modulePath)).map((symbol) => ({
        id: symbol.id,
        kind: "symbol" as const,
        locator: `symbol:${symbol.modulePath}#${symbol.name}`,
        name: symbol.name,
        summary: `${symbol.kind} ${symbol.name} in ${symbol.modulePath}`,
        evidenceRefs: [...symbol.evidenceRefs],
        epistemic: symbol.epistemic
      }));
      return answer(view, symbols, checked, view.model.relationships.length + view.model.symbols.length);
    },

    relatedTests(reference, budget) {
      const checked = validateBudget(budget);
      const modulePath = resolveModulePath(view, reference);
      const tests = modulePath === undefined ? [] : view.model.tests
        .filter((test) => test.sourceModulePaths.includes(modulePath))
        .map((test) => ({
          id: test.id,
          kind: "test" as const,
          locator: `path:${test.path}`,
          summary: `Test covering ${test.sourceModulePaths.join(", ")}`,
          evidenceRefs: [...test.evidenceRefs],
          epistemic: test.epistemic
        }));
      return answer(view, tests, checked, view.model.tests.length);
    },

    validationCapabilities(budget) {
      const checked = validateBudget(budget);
      const validationName = /^(?:test|typecheck|lint|build|check|verify)(?::|$)/u;
      const commands = view.model.commands.filter((command) => validationName.test(command.name))
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
        .map((command) => ({
          id: command.id,
          kind: "command" as const,
          locator: `command:${command.packageId}:${command.name}`,
          name: command.name,
          summary: command.command,
          evidenceRefs: [...command.evidenceRefs],
          epistemic: command.epistemic
        }));
      return answer(view, commands, checked, view.model.commands.length);
    },

    async readExcerpts(references, budget) {
      const checked = validateBudget(budget);
      const candidates: RepositoryExcerptItem[] = [];
      let remainingBytes = checked.maxBytes;
      let wasTruncated = false;
      for (const reference of [...new Set(references)].sort()) {
        if (candidates.length >= checked.maxResults || remainingBytes <= 0) {
          wasTruncated = true;
          break;
        }
        const resolved = view.catalog.resolve(reference);
        if (resolved.state !== "known" || resolved.resource.path === undefined) continue;
        const entry = view.model.gitEntries.find((candidate) => candidate.path === resolved.resource.path);
        if (entry === undefined || entry.kind === "gitlink") continue;
        const exactText = await readBlob(gitPath, rootPath, entry.oid);
        const bytes = Buffer.from(exactText, "utf8");
        const selected = bytes.subarray(0, remainingBytes);
        const text = selected.toString("utf8");
        const itemTruncated = selected.byteLength < bytes.byteLength;
        candidates.push({
          id: resolved.resource.id,
          kind: "resource",
          locator: resolved.resource.canonicalLocator,
          summary: resolved.resource.path,
          text,
          truncated: itemTruncated,
          evidenceRefs: [...resolved.resource.evidenceRefs],
          epistemic: resolved.resource.epistemic
        });
        remainingBytes -= Buffer.byteLength(text, "utf8");
        wasTruncated ||= itemTruncated;
      }
      return answer(view, candidates, checked, references.length, wasTruncated, (item) => Buffer.byteLength(item.text, "utf8"));
    }
  };
}

function searchCandidates(view: RepositoryView): RepositoryQueryItem[] {
  return [
    ...view.model.packages.map((boundary) => ({
      id: boundary.id,
      kind: "package" as const,
      locator: `package:${boundary.rootPath || "."}`,
      name: boundary.name,
      summary: `${boundary.name} ${boundary.entrypoints.join(" ")}`.trim(),
      evidenceRefs: [...boundary.evidenceRefs],
      epistemic: boundary.epistemic
    })),
    ...view.model.modules.map(moduleItem),
    ...view.model.symbols.map((symbol) => ({
      id: symbol.id,
      kind: "symbol" as const,
      locator: `symbol:${symbol.modulePath}#${symbol.name}`,
      name: symbol.name,
      summary: `${symbol.kind} ${symbol.name} in ${symbol.modulePath}`,
      evidenceRefs: [...symbol.evidenceRefs],
      epistemic: symbol.epistemic
    })),
    ...view.model.commands.map((command) => ({
      id: command.id,
      kind: "command" as const,
      locator: `command:${command.packageId}:${command.name}`,
      name: command.name,
      summary: command.command,
      evidenceRefs: [...command.evidenceRefs],
      epistemic: command.epistemic
    })),
    ...view.model.diagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      kind: "diagnostic" as const,
      locator: diagnostic.path === undefined ? `diagnostic:${diagnostic.code}` : `path:${diagnostic.path}`,
      name: diagnostic.code,
      summary: diagnostic.message,
      evidenceRefs: [...diagnostic.evidenceRefs],
      epistemic: diagnostic.epistemic
    }))
  ];
}

function moduleItem(module: RepositoryView["model"]["modules"][number]): RepositoryQueryItem {
  return {
    id: module.id,
    kind: "module",
    locator: `module:${module.path}`,
    summary: `${module.path} ${module.exportedSymbols.join(" ")}`.trim(),
    evidenceRefs: [...module.evidenceRefs],
    epistemic: module.epistemic
  };
}

function resolveModulePath(view: RepositoryView, reference: string): string | undefined {
  const resolved = view.catalog.resolve(reference);
  if (resolved.state !== "known" || resolved.resource.path === undefined) return undefined;
  return view.model.modules.some((module) => module.path === resolved.resource.path)
    ? resolved.resource.path
    : undefined;
}

function answer<T extends RepositoryQueryItem>(
  view: RepositoryView,
  candidates: readonly T[],
  budget: RepositoryQueryBudget,
  visited: number,
  alreadyTruncated = false,
  itemBytes: (item: T) => number = jsonBytes
): RepositoryQueryAnswer<T> {
  const items: T[] = [];
  let bytes = 0;
  let truncated = alreadyTruncated;
  for (const candidate of candidates) {
    const candidateBytes = itemBytes(candidate);
    if (items.length >= budget.maxResults || bytes + candidateBytes > budget.maxBytes) {
      truncated = true;
      continue;
    }
    items.push(candidate);
    bytes += candidateBytes;
  }
  const evidenceRefs = [...new Set(items.flatMap((item) => item.evidenceRefs))].sort();
  const itemStates = items.map((item) => item.epistemic.state);
  const incomplete = truncated
    || view.model.coverage.disposition !== "known"
    || itemStates.some((state) => state === "partial" || state === "unknown");
  const epistemic: EpistemicAssessment = evidenceRefs.length === 0
    ? { state: "unknown", reason: "The bounded query returned no evidence for this repository view.", evidenceRefs: [] }
    : itemStates.includes("conflicting")
      ? { state: "conflicting", confidence: "low", evidenceRefs }
      : incomplete
        ? { state: "partial", confidence: view.model.coverage.disposition === "unknown" ? "low" : "medium", evidenceRefs }
      : { state: "known", confidence: "high", evidenceRefs };
  const material = {
    viewDigest: view.digest,
    items,
    budget,
    cost: { results: items.length, bytes, visited },
    truncated,
    epistemic,
    evidenceRefs
  };
  return { ...material, digest: repositoryDigest(material) };
}

function validateBudget(budget: RepositoryQueryBudget): RepositoryQueryBudget {
  for (const key of ["maxResults", "maxBytes", "maxDepth"] as const) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < (key === "maxDepth" ? 0 : 1)) {
      throw new Error(`Repository query ${key} must be ${key === "maxDepth" ? "a non-negative" : "a positive"} integer.`);
    }
  }
  return { ...budget };
}

function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function matches(item: RepositoryQueryItem, term: string): number {
  const haystack = `${item.locator}\n${item.name ?? ""}\n${item.summary}`.toLocaleLowerCase("en-US");
  if (!haystack.includes(term)) return 0;
  if (item.name?.toLocaleLowerCase("en-US") === term) return 4;
  if (item.locator.toLocaleLowerCase("en-US").includes(term)) return 2;
  return 1;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
