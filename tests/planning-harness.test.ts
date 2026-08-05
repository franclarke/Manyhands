import { afterAll, describe, expect, it } from "vitest";
import { buildFastRepositorySnapshot } from "@manyhands/repository-index";
import { warehouseSlice, warehouseSliceMjs } from "./fixtures/planning/warehouse-slice";
import { releaseFixtures, runPlanning, sharedFixture, stubModel, type PlanningRun } from "./helpers/planning-harness";

/**
 * Stage 1 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * The harness runs inspect -> decompose -> compile in process, so a planning
 * defect is a unit test instead of a 45-minute frozen cell. The `it.fails` cases
 * state the TARGET behaviour of stages 2-3: they pass today only because the
 * behaviour is still broken, and turn red the moment it is fixed — which is the
 * signal to delete the marker.
 */

afterAll(releaseFixtures);

const GOAL = "Record a backorder when an order exceeds available stock and expose it through the API.";
const CRITERIA = [
  "The domain records a positive backorder instead of rejecting the order.",
  "The application emits one backorder event.",
  "The API exposes the current backorders.",
  "The three layers agree end to end."
];

interface DraftOptions {
  seamInterface?: unknown;
  seamKind?: string;
  seamMaterialization?: string;
  contestedPath?: boolean;
}

/**
 * A schema-valid four-unit draft, with a knob per historical defect.
 *
 * Every unit needs at least one outcome and every required criterion needs
 * exactly one owner, so a composite root forces a fourth, integration-level
 * criterion. That coupling is itself worth knowing: the number of criteria a
 * goal declares constrains the shape of every plan that can satisfy it.
 */
function draft(options: DraftOptions = {}): unknown {
  const leaf = (key: string, criterion: string, planned: string) => ({
    key,
    kind: "leaf",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key.split("-")[0]!],
    evidenceIds: ["config-package-json"],
    plannedPaths: [planned],
    outcomes: [{
      id: `outcome-${key}`,
      description: `${key} is proven`,
      criterionIds: [criterion],
      verification: { kind: "author_test", references: [planned] }
    }]
  });
  const contested = options.contestedPath === true;
  return {
    root: {
      key: "backorders",
      kind: "composite",
      title: "Backorders across the slice",
      objective: GOAL,
      concerns: ["domain", "application", "api"],
      evidenceIds: [],
      outcomes: [{
        id: "outcome-integration",
        description: "The three layers agree end to end",
        criterionIds: ["criterion-4"],
        verification: { kind: "existing", references: ["test"] }
      }],
      cut: { criterion: "integration", rationale: "Each layer is independently verifiable." },
      children: [
        leaf("domain-backorders", "criterion-1", "test/domain-backorders.test.js"),
        leaf("application-backorders", "criterion-2", contested ? "test/domain-backorders.test.js" : "test/application-backorders.test.js"),
        leaf("api-backorders", "criterion-3", "test/api-backorders.test.js")
      ]
    },
    seams: [{
      id: "seam-domain-to-application",
      producerUnitKey: "domain-backorders",
      consumerUnitKeys: ["application-backorders"],
      purpose: "The application calls the domain backorder rule.",
      interface: options.seamInterface ?? {
        kind: options.seamKind ?? "type",
        promise: "recordBackorder returns a positive shortage",
        compatibility: "The application imports the exported rule.",
        materialization: options.seamMaterialization ?? "files",
        verification: { kind: "author_test", references: ["test/application-backorders.test.js"] }
      },
      evidenceIds: []
    }],
    repositoryEvidence: [],
    uncertainties: [],
    questions: []
  };
}

function plan(response: unknown): Promise<PlanningRun> {
  return runPlanning({
    fixture: warehouseSlice,
    goal: GOAL,
    criteria: CRITERIA,
    model: stubModel(response),
    candidateCount: 2,
    maxAttempts: 1
  });
}

describe("in-process planning harness", () => {
  it("plans and compiles a valid draft without a server, worktree or network", async () => {
    const run = await plan(draft());
    expect(run.outcome.kind).toBe("ready");
    expect(run.compileError).toBeUndefined();
    expect(Object.keys(run.compiled?.graph.nodes ?? {}).length).toBeGreaterThanOrEqual(4);
    expect(run.calls[0]!.system).toContain("semantic Planner");
  });

  it("grounds the planner on repository evidence read from the fixture", async () => {
    const run = await plan(draft());
    expect(run.snapshot.inspectionDisposition).not.toBe("unavailable");
    expect(run.calls[0]!.user).toContain("orders.js");
    expect(run.calls[0]!.user).toContain("package.json");
  });

  it("surfaces the exact validator diagnostics a rejected draft produced", async () => {
    const run = await plan({ nothing: "useful" });
    expect(run.outcome.kind).toBe("rejected");
    if (run.outcome.kind !== "rejected") return;
    expect(run.outcome.error.message).toContain("root");
  });

  it("feeds validator diagnostics back to the model as repair issues", async () => {
    const run = await runPlanning({
      fixture: warehouseSlice,
      goal: GOAL,
      criteria: CRITERIA,
      model: stubModel([{ nothing: "useful" }, draft()]),
      candidateCount: 2,
      maxAttempts: 2
    });
    expect(run.calls[1]!.repairIssues.length).toBeGreaterThan(0);
    expect(run.outcome.kind).toBe("ready");
  });
});

describe("historical defects the redesign must eliminate", () => {
  // Found by this harness: the fast indexer's SOURCE_EXTENSIONS is
  // { .ts, .tsx, .js }. The SP2 target template is entirely .mjs, so its
  // planner received zero path evidence and could only ever declare planned
  // paths. Stage 2 must index .mjs and .cjs.
  it("indexer blindness — .mjs sources are visible to the planner", async () => {
    const fixture = await sharedFixture(warehouseSliceMjs);
    const snapshot = await buildFastRepositorySnapshot({
      rootPath: fixture.root,
      targetFingerprint: "mjs",
      baseCommit: fixture.commit
    });
    const indexed = (snapshot.index?.files ?? []).map((file) => file.path.replaceAll("\\", "/"));
    expect(indexed).toContain("src/domain/orders.mjs");
    expect(indexed).toContain("src/application/order-service.mjs");
    expect(snapshot.capabilities.languages.map((entry) => entry.language)).toContain("javascript");
  });

  // SP2: six of six candidates died because the prompt names `interface`
  // without ever defining it, while the validator demands a nested five-field
  // object. Stages 2-3 stop asking the model for the interface at all.
  it.fails("SP2 — a seam interface the model wrote as prose still yields a plan", async () => {
    const run = await plan(draft({ seamInterface: "The application imports the domain rule." }));
    expect(run.outcome.kind).toBe("ready");
  });

  // SP1q: the planner represented a runtime dependency as a logical seam and the
  // strict scope guard then rejected the repair that needed producer files.
  // Stage 3 derives materialization from the write-set, so `logical` for an
  // executable dependency becomes unrepresentable rather than illegal.
  it.fails("SP1q — a logical executable seam is unrepresentable, not rejected", async () => {
    const run = await plan(draft({ seamKind: "type", seamMaterialization: "logical" }));
    expect(run.outcome.kind).toBe("ready");
    expect(run.compileError).toBeUndefined();
  });

  // contested-planned-output: sibling leaves claiming the same file compiled
  // into conflict constraints that review then accepted as a remedy. Stage 3
  // makes disjoint write-sets property P2, so the cut is redone or the unit
  // stays a bigger leaf — a contested output never reaches the graph.
  it.fails("contested output — a disputed planned path never becomes a conflict constraint", async () => {
    const run = await plan(draft({ contestedPath: true }));
    expect(run.outcome.kind).toBe("ready");
    expect(run.compileError).toBeUndefined();
    expect(run.compiled?.graph.conflictConstraints ?? []).toHaveLength(0);
  });
});
