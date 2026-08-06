import { afterAll, describe, expect, it } from "vitest";
import { buildFastRepositorySnapshot } from "@manyhands/repository-index";
import { warehouseSlice, warehouseSliceMjs } from "./fixtures/planning/warehouse-slice";
import { releaseFixtures, runPlanning, runRecursivePlanning, sharedFixture, stubModel, type PlanningRun } from "./helpers/planning-harness";

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

describe("the redesigned path on the same fixture", () => {
  const RECURSIVE_CRITERIA = [
    { id: "criterion-1", description: "The domain records a positive backorder", required: true },
    { id: "criterion-2", description: "The API exposes the current backorders", required: true }
  ];

  /** A cut the model could plausibly return, with no relational metadata at all. */
  function backorderCut() {
    return JSON.stringify({
      rationale: "The domain rule and its exposure are separately verifiable",
      children: [
        {
          key: "domain-backorders",
          objective: "Record a positive backorder instead of rejecting the order",
          criterion: "The domain records a positive backorder",
          reads: ["src/domain/orders.js"],
          writes: ["src/domain/backorders.js", "test/domain-backorders.test.js"]
        },
        {
          key: "api-backorders",
          objective: "Expose the recorded backorders",
          criterion: "The API exposes the current backorders",
          reads: ["src/domain/backorders.js", "src/api/warehouse-api.js"],
          writes: ["test/api-backorders.test.js"]
        }
      ]
    });
  }

  function run(response: string) {
    return runRecursivePlanning({
      fixture: warehouseSlice,
      goal: "Record a backorder when an order exceeds available stock and expose it through the API.",
      criteria: RECURSIVE_CRITERIA,
      model: { async proposeCut() { return response; } },
      budget: 3
    });
  }

  it("plans, derives its relations and compiles a graph", async () => {
    const result = await run(backorderCut());

    expect(result.error).toBeUndefined();
    expect(result.plan.unresolved).toHaveLength(0);
    expect(Object.keys(result.compiled?.graph.nodes ?? {}).length).toBeGreaterThanOrEqual(3);
  });

  // SP2: six of six candidates died on `interface`, a field the old prompt named
  // and never shaped. The model is no longer asked for it, so the seam carries a
  // complete interface no matter what the model says.
  it("SP2 — the seam interface is derived, so the model cannot get it wrong", async () => {
    const result = await run(backorderCut());
    const seams = result.projected?.draft.seams ?? [];

    expect(seams).toHaveLength(1);
    expect(seams[0]!.interface).toMatchObject({
      materialization: "files",
      kind: "type"
    });
    expect(seams[0]!.interface.verification.references.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.plan)).not.toContain("interface");
  });

  // SP1q: a runtime dependency modelled as a logical seam, then rejected by the
  // strict scope guard. `logical` is now unreachable: the relation is files.
  it("SP1q — no derived relation can be logical", async () => {
    const result = await run(backorderCut());

    expect(result.projected?.relations.map((relation) => relation.materialization)).toEqual(["files"]);
    expect(JSON.stringify(result.projected?.draft.seams)).not.toContain("logical");
  });

  // contested-planned-output: sibling leaves claiming the same file compiled into
  // conflict constraints that review then accepted as a remedy. P2 rejects the
  // cut instead, so a contested output never reaches the graph.
  it("contested output — P2 rejects the cut and nothing contested reaches the graph", async () => {
    const contested = JSON.stringify({
      rationale: "Both children own the same test",
      children: [
        {
          key: "domain-backorders",
          objective: "Record the backorder",
          criterion: "The domain records a positive backorder",
          reads: ["src/domain/orders.js"],
          writes: ["test/shared.test.js"]
        },
        {
          key: "api-backorders",
          objective: "Expose the backorders",
          criterion: "The API exposes the current backorders",
          reads: ["src/api/warehouse-api.js"],
          writes: ["test/shared.test.js"]
        }
      ]
    });
    const result = await run(contested);

    expect(result.plan.unresolved.map((node) => node.unit.key)).toEqual(["root"]);
    expect(result.plan.unresolved[0]!.diagnostics.join(" ")).toContain("P2");
    expect(result.compiled?.graph.conflictConstraints ?? []).toHaveLength(0);
    expect(result.error).toMatch(/unresolved/iu);
  });
});

/**
 * Characterization of the LEGACY one-shot path, which stage 3C retires. Each
 * case states the behaviour the redesigned path above already delivers; they
 * pass here only because the legacy path is still broken, and they are deleted
 * together with it.
 */
describe("legacy one-shot path — retired in stage 3C", () => {
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
