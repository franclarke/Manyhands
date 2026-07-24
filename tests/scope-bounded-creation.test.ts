import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ScopeChecker } from "@manyhands/execution-core";
import { ScopeContractSchema } from "@manyhands/contracts";
import { compileGraphRevision } from "@manyhands/decomposer";
import { computeInputFingerprint } from "@manyhands/run-coordinator";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures";

const checker = new ScopeChecker();

/**
 * G4 root cause. Under the `strict` scope policy every changed file outside
 * `allowedPaths` fails the leaf. `allowedPaths` are the exact paths the planner
 * cited or pre-declared, so a legitimate new file the planner did not foresee
 * (the canonical goal asks for new tests) is rejected even though the work is
 * correct.
 *
 * The fix is bounded creation, never repo-wide write: a unit may CREATE files
 * under the directories it already owns. Modifying a pre-existing file it never
 * declared stays out of scope, and `forbiddenPaths` still wins absolutely.
 */
describe("bounded creation under declared output roots", () => {
  const scopeContract = {
    allowedPaths: ["src/domain/expense.ts", "tests/expense.test.ts"],
    forbiddenPaths: [],
    outputRoots: ["src/domain", "tests"]
  };

  it("admits a newly created file under a declared output root", () => {
    const result = checker.check({
      changedFiles: ["src/domain/expense.ts", "tests/category-totals.test.ts"],
      createdFiles: ["tests/category-totals.test.ts"],
      scopeContract
    });

    expect(result.passed).toBe(true);
    expect(result.outOfScope).toEqual([]);
  });

  it("keeps a pre-existing file under an output root out of scope when it was never declared", () => {
    // Creation is authorized; takeover of a sibling's existing file is not.
    const result = checker.check({
      changedFiles: ["src/domain/balances.ts"],
      createdFiles: [],
      scopeContract
    });

    expect(result.outOfScope).toEqual(["src/domain/balances.ts"]);
  });

  it("keeps a created file outside every output root out of scope", () => {
    const result = checker.check({
      changedFiles: ["src/api/routes.ts"],
      createdFiles: ["src/api/routes.ts"],
      scopeContract
    });

    expect(result.outOfScope).toEqual(["src/api/routes.ts"]);
  });

  it("keeps forbidden paths terminal even for a creation inside an output root (deny wins)", () => {
    const result = checker.check({
      changedFiles: ["tests/secrets.env"],
      createdFiles: ["tests/secrets.env"],
      scopeContract: { ...scopeContract, forbiddenPaths: ["**/*.env"] }
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["tests/secrets.env"]);
  });

  it("never lets a root widen to the whole repository", () => {
    const parsed = ScopeContractSchema.safeParse({
      schemaVersion: 2,
      id: "scope-contract-x",
      revision: "sha256:x",
      provenance: "compiled",
      nodeId: "node-x",
      allowedPaths: ["package.json"],
      forbiddenPaths: [],
      coordinationPaths: [],
      outputRoots: ["."]
    });

    expect(parsed.success).toBe(false);
  });
});

describe("compiled output roots", () => {
  it("derives each unit's roots from the directories it already owns, excluding the repository root", () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );

    const domain = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain");
    expect(domain?.scope.allowedPaths).toEqual(["src/domain/booking.ts"]);
    expect(domain?.scope.outputRoots).toEqual(["src/domain"]);

    const root = compiled.contracts.find((bundle) => bundle.task.nodeId === compiled.graph.rootId);
    expect(root?.scope.outputRoots).toEqual(["src/api", "src/domain", "src/ui"]);
    expect(root?.scope.outputRoots).not.toContain(".");
  });
});

describe("effective scope identity", () => {
  it("changes the input fingerprint when the effective scope changes", () => {
    const base = {
      graphId: "graph-1",
      nodeId: "node-1",
      baseCommit: "1da878de6edd38cefb1ea4d8ceecdceea0bb6acc",
      consumedArtifacts: [],
      repositoryContextDigest: "sha256:ctx",
      executorProfile: { id: "executor-codex", revision: "1" },
      validationContract: { id: "validation-contract-1", revision: "sha256:v" }
    };
    const withoutRoots = computeInputFingerprint({
      ...base,
      contractRevisions: [{ id: "scope-contract-1", revision: "sha256:no-roots" }]
    });
    const withRoots = computeInputFingerprint({
      ...base,
      contractRevisions: [{ id: "scope-contract-1", revision: "sha256:with-roots" }]
    });

    expect(withRoots).not.toBe(withoutRoots);
  });

  it("folds outputRoots into the compiled scope contract revision", () => {
    // The scope contract already travels in `contractRevisions`, so binding the
    // roots into the contract is what puts the *effective* scope inside the
    // fingerprint. Recomputing the revision with the roots stripped must differ
    // from the stored one, otherwise widening a root would not invalidate an
    // attempt.
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const domain = compiled.contracts.find((bundle) => bundle.task.nodeId === "node-domain")!;
    const { revision, ...withRoots } = domain.scope;

    expect(revision).toBe(revisionFor(withRoots));
    expect(revision).not.toBe(revisionFor({ ...withRoots, outputRoots: [] }));
  });
});

function revisionFor(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}
