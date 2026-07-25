import type { WorkUnit } from "../planner/schema.js";

/**
 * Assigns each user acceptance intent to exactly one semantic unit.
 *
 * Broad parent references are treated as inherited coverage. The owner is the
 * deepest referencing unit, or the lowest common ancestor when an intent spans
 * more than one branch.
 */
export function allocateAcceptanceIntents(root: WorkUnit): Record<string, string> {
  const units = flattenUnits(root);
  const parentByKey = collectParentKeys(root);
  const output: Record<string, string> = {};
  const intentIds = new Set(units.flatMap((unit) => unit.acceptanceIntentIds));

  for (const intentId of [...intentIds].sort()) {
    const references = units
      .filter((unit) => unit.acceptanceIntentIds.includes(intentId))
      .map((unit) => unit.key);
    const deepestReferences = references.filter((candidate) =>
      !references.some((other) => other !== candidate && isAncestor(candidate, other, parentByKey))
    );
    if (deepestReferences.length === 0) continue;
    output[intentId] = lowestCommonAncestor(deepestReferences, parentByKey);
  }

  return output;
}

function lowestCommonAncestor(
  unitKeys: readonly string[],
  parentByKey: ReadonlyMap<string, string>
): string {
  const [first, ...rest] = unitKeys;
  if (first === undefined) throw new Error("Cannot find an acceptance owner without referencing units.");
  const firstAncestry = ancestry(first, parentByKey);
  return firstAncestry.find((candidate) =>
    rest.every((unitKey) => ancestry(unitKey, parentByKey).includes(candidate))
  ) ?? first;
}

function ancestry(unitKey: string, parentByKey: ReadonlyMap<string, string>): string[] {
  const output: string[] = [];
  let candidate: string | undefined = unitKey;
  while (candidate !== undefined) {
    output.push(candidate);
    candidate = parentByKey.get(candidate);
  }
  return output;
}

function isAncestor(
  ancestorKey: string,
  unitKey: string,
  parentByKey: ReadonlyMap<string, string>
): boolean {
  let candidate = parentByKey.get(unitKey);
  while (candidate !== undefined) {
    if (candidate === ancestorKey) return true;
    candidate = parentByKey.get(candidate);
  }
  return false;
}

function collectParentKeys(root: WorkUnit): Map<string, string> {
  const output = new Map<string, string>();
  const visit = (unit: WorkUnit): void => {
    if (unit.kind !== "composite") return;
    for (const child of unit.children) {
      output.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return output;
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}
