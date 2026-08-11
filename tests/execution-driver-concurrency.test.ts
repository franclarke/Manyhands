import { describe, it, expect, vi } from "vitest";
import { V2ExecutionDriver, type V2ExecutionRunInput } from "@manyhands/orchestrator-graph";

function makeValidBundle(nodeId: string) {
  const isRoot = nodeId === "root";
  return {
    schemaVersion: 2 as const,
    task: {
      schemaVersion: 2 as const,
      id: `task-contract:${nodeId}`,
      revision: "task-r1",
      provenance: "compiled" as const,
      nodeId,
      goal: `Goal for ${nodeId}`,
      acceptanceCriteria: [
        {
          id: `criterion:${nodeId}`,
          kind: "integration" as const,
          description: "criterion",
          required: true
        }
      ],
      scope: { id: `scope:${nodeId}`, revision: "scope-r1" },
      consumes: [],
      produces: [{ id: `artifact:${nodeId}`, revision: "artifact-r1" }],
      seams: [],
      validation: { id: `validation:${nodeId}`, revision: "validation-r1" },
      constraints: []
    },
    scope: {
      schemaVersion: 2 as const,
      id: `scope:${nodeId}`,
      revision: "scope-r1",
      provenance: "compiled" as const,
      nodeId,
      allowedPaths: ["src/**"],
      forbiddenPaths: [".env"],
      coordinationPaths: ["package.json"]
    },
    seams: [],
    artifacts: [
      {
        schemaVersion: 2 as const,
        id: `artifact:${nodeId}`,
        revision: "artifact-r1",
        provenance: "compiled" as const,
        producerNodeId: nodeId,
        consumerNodeIds: [],
        artifactType: isRoot ? "final-candidate" : "node-result",
        materialization: "files" as const,
        expectedPaths: ["src/**"]
      }
    ],
    validation: {
      schemaVersion: 2 as const,
      id: `validation:${nodeId}`,
      revision: "validation-r1",
      provenance: "compiled" as const,
      nodeId,
      obligations: [
        {
          id: `obligation:${nodeId}`,
          criterionId: `criterion:${nodeId}`,
          layer: "integration" as const,
          severity: "required" as const,
          acceptableEvidence: ["test_result" as const],
          baselinePolicy: "required" as const,
          negativeControl: "when_feasible" as const,
          flakyPolicy: "forbid" as const
        }
      ]
    }
  };
}

const mockGraph: any = {
  graphId: "g1",
  revision: 1,
  rootId: "root",
  baseCommit: "commit1",
  repositorySnapshotId: "snap",
  schemaVersion: 2,
  nodes: {
    "node1": { id: "node1", parentId: null, kind: "leaf", title: "1", goal: "1" },
    "node2": { id: "node2", parentId: null, kind: "leaf", title: "2", goal: "2" },
    "node3": { id: "node3", parentId: null, kind: "leaf", title: "3", goal: "3" },
    "root": { id: "root", parentId: null, kind: "root", title: "root", goal: "root" }
  },
  artifactRequirements: [],
  seamBindings: [],
  conflictConstraints: [],
  legacyOrderingConstraints: [],
  createdAt: "2026-07-22T00:00:00Z"
};

const mockContracts: any[] = ["node1", "node2", "node3", "root"].map(id => makeValidBundle(id));

function mockRunInput(nodeIds: string[]): V2ExecutionRunInput {
  return {
    runId: "run1",
    graph: mockGraph,
    contracts: mockContracts,
    repositoryContextDigest: "digest",
    executorProfile: { id: "ex", revision: "1" },
    effectiveConfig: { maxParallel: nodeIds.length || 1 },
    materializableNodeIds: nodeIds,
    availableExecutorNodeIds: nodeIds,
    conflictConstraints: [],
    target: { sourceTargetFingerprint: "fp", targetBranch: "main", targetHead: "head" }
  };
}

function mockState(overrides: any = {}) {
  return {
    lifecycle: "running",
    graphId: "g1",
    graphRevision: 1,
    approvedGraphRevision: 1,
    selectedWaves: [{ id: "w1" }],
    adoptedArtifacts: {},
    decisions: {},
    attempts: {},
    // `foldRun` always seeds this, so a double without it is a projection the
    // reducer could never produce — and readiness reads it on every advance.
    recoveryHistory: [],
    ...overrides
  };
}

describe("V2ExecutionDriver - Concurrency", () => {
  it("1. enqueues 10 simultaneous completions safely without race conditions", async () => {
    let stateUpdates = 0;
    let adoptedArtifactsMap: Record<string, any> = {};

    const coordinator = {
      load: vi.fn().mockImplementation(() => Promise.resolve(mockState({ adoptedArtifacts: adoptedArtifactsMap }))),
      execute: vi.fn().mockImplementation(() => Promise.resolve(mockState({ adoptedArtifacts: adoptedArtifactsMap }))),
      record: vi.fn().mockImplementation((runId, facts) => {
        stateUpdates++;
        const nextArtifacts = { ...adoptedArtifactsMap };
        for (const f of facts) {
          const nid = f.payload?.nodeId || f.nodeId;
          if (nid && (f.type.includes("candidate_created") || f.type.includes("completed"))) {
            nextArtifacts[nid] = { nodeId: nid, contract: { id: `artifact:${nid}`, revision: "artifact-r1" }, digest: "digest" };
          }
        }
        adoptedArtifactsMap = nextArtifacts;
        return Promise.resolve(mockState({ version: stateUpdates, adoptedArtifacts: adoptedArtifactsMap }));
      })
    };

    const count = 10;
    const nodes = Array.from({ length: count }, (_, i) => `node${i + 1}`);
    const localGraph = {
      ...mockGraph,
      nodes: Object.fromEntries(nodes.map(id => [id, { id, parentId: null, kind: "leaf", title: id, goal: id }]))
    };
    const localContracts = nodes.map(id => makeValidBundle(id));

    const executeResolvers: Array<() => void> = [];
    const execute = vi.fn().mockImplementation((inp) => {
      return new Promise(resolve => {
        executeResolvers.push(() => {
          resolve({
            kind: "success",
            candidateCommit: "c1",
            outputDigest: "d1",
            changedFiles: ["src/app.ts"],
            evidenceMatrix: {
              matrixId: "m1",
              outcome: "verified",
              candidateCommit: "c1",
              validationContract: { id: `validation:${inp.node.id}`, revision: "validation-r1" }
            },
            artifactLocation: "loc"
          });
        });
      });
    });

    const driver = new V2ExecutionDriver({
      coordinator: withDerivedRecording(coordinator),
      execute,
      loadCurrentInputs: async () => freshness(input),
      now: () => "2026-07-22T00:00:00Z"
    } as any);
    const input: V2ExecutionRunInput = {
      runId: "run1",
      graph: localGraph,
      contracts: localContracts as any,
      repositoryContextDigest: "digest",
      executorProfile: { id: "ex", revision: "1" },
      effectiveConfig: { maxParallel: count },
      materializableNodeIds: nodes,
      availableExecutorNodeIds: nodes,
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "fp", targetBranch: "main", targetHead: "head" }
    };

    const runPromise = driver.run(input);

    await vi.waitFor(() => expect(executeResolvers.length).toBe(count));
    executeResolvers.reverse().forEach(fn => fn());

    await runPromise;
    expect(stateUpdates).toBe(1 + count);
  });

  it("2. serializes completions and processes failures correctly", async () => {
    let decisionsMap: Record<string, any> = {};
    // The double records failed attempts as well as decisions. Without them the
    // projection never shows a prior failure, the retry budget can never be
    // spent, and a node that always fails is retried for ever — a stall the
    // real reducer cannot produce, and one the driver used to be shielded from
    // only because it refused to retry anything but a transient failure.
    let attemptsMap: Record<string, any> = {};
    const state = () => mockState({ decisions: decisionsMap, attempts: attemptsMap });
    const coordinator = {
      load: vi.fn().mockImplementation(() => Promise.resolve(state())),
      execute: vi.fn().mockImplementation(() => Promise.resolve(state())),
      record: vi.fn().mockImplementation((runId, facts) => {
        const nextDecisions = { ...decisionsMap };
        const nextAttempts = { ...attemptsMap };
        for (const f of facts) {
          if (f.type === "decision.raised") {
            nextDecisions[f.payload.decision.id] = { status: "pending", id: f.payload.decision.id, affectedNodeIds: f.payload.decision.affectedNodeIds };
          }
          if (f.type === "attempt.failed" || f.type === "integration.failed") {
            nextAttempts[f.payload.attemptId] = { attemptId: f.payload.attemptId, nodeId: f.payload.nodeId, status: "failed" };
          }
        }
        decisionsMap = nextDecisions;
        attemptsMap = nextAttempts;
        return Promise.resolve(state());
      })
    };

    const execute = vi.fn().mockResolvedValue({
      kind: "failure",
      reason: "syntax error"
    });

    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator), execute, loadCurrentInputs: async () => freshness(input), now: () => "now" } as any);
    const input = mockRunInput(["node1"]);

    const result = await driver.run(input);
    expect(result.lifecycle).toBe("running");
    expect(coordinator.record).toHaveBeenCalled();
  });

  it("3. handles concurrent cancellations properly", async () => {
    const coordinator = {
      load: vi.fn().mockResolvedValue(mockState({ lifecycle: "cancelled" }))
    };
    const execute = vi.fn();
    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator) } as any);

    const result = await driver.run(mockRunInput(["node1"]));
    expect(result.lifecycle).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("4. handles late completion after cancellation cleanly", async () => {
    let loadCount = 0;
    const coordinator = {
      load: vi.fn().mockImplementation(() => {
        loadCount++;
        if (loadCount === 1) return Promise.resolve(mockState());
        return Promise.resolve(mockState({ lifecycle: "cancelled" }));
      }),
      execute: vi.fn().mockResolvedValue(mockState()),
      record: vi.fn().mockResolvedValue(mockState())
    };

    const execute = vi.fn().mockImplementation((inp) => Promise.resolve({
      kind: "success",
      candidateCommit: "c1",
      outputDigest: "d1",
      changedFiles: [],
      evidenceMatrix: { outcome: "verified", candidateCommit: "c1", validationContract: { id: `validation:${inp.node.id}`, revision: "validation-r1" } },
      artifactLocation: "loc"
    }));

    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator), execute, loadCurrentInputs: async () => freshness(input), now: () => "now" } as any);
    const input = mockRunInput(["node1"]);

    const res = await driver.run(input);
    expect(res.lifecycle).toBe("cancelled");
  });

  it("5. ensures errors during completion record reject properly", async () => {
    const coordinator = {
      load: vi.fn().mockResolvedValue(mockState()),
      execute: vi.fn().mockResolvedValue(mockState()),
      record: vi.fn().mockImplementation((runId, facts) => {
        if (facts.some((f: any) => f.type === "attempt.candidate_created")) {
          return Promise.reject(new Error("Database recording error"));
        }
        return Promise.resolve(mockState());
      })
    };

    const execute = vi.fn().mockImplementation((inp) => Promise.resolve({
      kind: "success",
      candidateCommit: "c1",
      outputDigest: "d1",
      changedFiles: [],
      evidenceMatrix: { outcome: "verified", matrixId: "m1", candidateCommit: "c1", validationContract: { id: `validation:${inp.node.id}`, revision: "validation-r1" } },
      artifactLocation: "loc"
    }));

    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator), execute, loadCurrentInputs: async () => freshness(input), now: () => "now" } as any);
    const input = mockRunInput(["node1"]);

    await expect(driver.run(input)).rejects.toThrow("Database recording error");
  });

  it("6. rejects execution run if graph revision is not exact approved", async () => {
    const coordinator = {
      load: vi.fn().mockResolvedValue(mockState({ graphRevision: 2, approvedGraphRevision: 2 }))
    };
    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator) } as any);
    await expect(driver.run(mockRunInput(["node1"]))).rejects.toThrow(/not the exact approved revision/);
  });

  it("7. terminates successfully if graph lifecycle is complete", async () => {
    const coordinator = {
      load: vi.fn().mockResolvedValue(mockState({ lifecycle: "completed" }))
    };
    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator) } as any);
    const res = await driver.run(mockRunInput(["node1"]));
    expect(res.lifecycle).toBe("completed");
  });

  it("8. avoids redundant dispatch if no ready nodes", async () => {
    const coordinator = {
      load: vi.fn().mockResolvedValue(mockState()),
      execute: vi.fn().mockResolvedValue(mockState({ selectedWaves: [] }))
    };
    // `now` is a required option: scheduling stamps every readiness observation.
    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator), now: () => "now" } as any);
    const input = mockRunInput([]);
    const res = await driver.run(input);
    expect(res.lifecycle).toBe("running");
  });

  it("9. handles coordinator record failure securely", async () => {
    const coordinator = {
      load: vi.fn().mockResolvedValue(mockState()),
      execute: vi.fn().mockResolvedValue(mockState()),
      record: vi.fn().mockImplementation((runId, facts) => {
        if (facts.length > 0 && facts[0].type.includes("attempt.candidate_created")) {
          return Promise.reject(new Error("db failure"));
        }
        return Promise.resolve(mockState());
      })
    };
    const execute = vi.fn().mockImplementation((inp) => Promise.resolve({ kind: "success", candidateCommit: "c1", outputDigest: "d1", changedFiles: [], evidenceMatrix: { outcome: "verified", matrixId: "m", candidateCommit: "c1", validationContract: { id: `validation:${inp.node.id}`, revision: "validation-r1" } }, artifactLocation: "loc" }));
    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator), execute, loadCurrentInputs: async () => freshness(input), now: () => "now" } as any);
    const input = mockRunInput(["node1"]);
    await expect(driver.run(input)).rejects.toThrow("db failure");
  });

  it("10. correctly preserves the latest state", async () => {
    let version = 0;
    let adoptedArtifactsMap: Record<string, any> = {};

    const coordinator = {
      load: vi.fn().mockImplementation(() => Promise.resolve(mockState({ version, adoptedArtifacts: adoptedArtifactsMap }))),
      execute: vi.fn().mockImplementation(() => Promise.resolve(mockState({ version, adoptedArtifacts: adoptedArtifactsMap }))),
      record: vi.fn().mockImplementation((runId, facts) => {
        version++;
        const nextArtifacts = { ...adoptedArtifactsMap };
        for (const f of facts) {
          const nid = f.payload?.nodeId || f.nodeId;
          if (nid && (f.type.includes("candidate_created") || f.type.includes("completed"))) {
            nextArtifacts[nid] = { nodeId: nid, contract: { id: `artifact:${nid}`, revision: "artifact-r1" }, digest: "digest" };
          }
        }
        adoptedArtifactsMap = nextArtifacts;
        return Promise.resolve(mockState({ version, adoptedArtifacts: adoptedArtifactsMap }));
      })
    };
    const execute = vi.fn().mockImplementation((inp) => Promise.resolve({ kind: "success", candidateCommit: "c1", outputDigest: "d1", changedFiles: [], evidenceMatrix: { outcome: "verified", matrixId: "m", candidateCommit: "c1", validationContract: { id: `validation:${inp.node.id}`, revision: "validation-r1" } }, artifactLocation: "loc" }));
    const driver = new V2ExecutionDriver({ coordinator: withDerivedRecording(coordinator), execute, loadCurrentInputs: async () => freshness(input), now: () => "now" } as any);

    const input = mockRunInput(["node1"]);

    const res = await driver.run(input);
    expect((res as any).version).toBe(2);
  });
});

/**
 * Stage 4 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * A wave is a barrier. `fast` and `slow` are dispatched together; `dependent`
 * needs only what `fast` produces, so the moment `fast` finishes there is a
 * free slot and a satisfied dependency. Under wave scheduling it still waits
 * for `slow`, because the driver awaits the whole batch before it may select
 * again — wall-clock spent on nothing, which is exactly what "waves die as a
 * mechanism" means. Dispatch has to be continuous over the ready set.
 */
describe("V2ExecutionDriver - continuous dispatch", () => {
  it("dispatches a node as soon as its own dependency lands, not when the wave drains", async () => {
    const nodes = ["fast", "slow", "dependent"];
    const graph: any = {
      ...mockGraph,
      nodes: Object.fromEntries(nodes.map((id) => [id, { id, parentId: null, kind: "leaf", title: id, goal: id }])),
      // `dependent` consumes what `fast` produces, and nothing of `slow`'s.
      artifactRequirements: [{
        id: "req-fast-dependent",
        artifactContract: { id: "artifact:fast", revision: "artifact-r1" },
        producerNodeId: "fast",
        consumerNodeId: "dependent",
        requiredFor: "execution"
      }]
    };

    let adopted: Record<string, any> = {};
    const state = () => mockState({ adoptedArtifacts: adopted });
    const coordinator = {
      load: vi.fn().mockImplementation(() => Promise.resolve(state())),
      execute: vi.fn().mockImplementation(() => Promise.resolve(state())),
      record: vi.fn().mockImplementation((_runId, facts) => {
        for (const fact of facts) {
          const nodeId = fact.payload?.nodeId ?? fact.nodeId;
          if (nodeId !== undefined && (fact.type.includes("candidate_created") || fact.type.includes("completed"))) {
            adopted[nodeId] = {
              schemaVersion: 1,
              artifactId: `artifact:${nodeId}`,
              runId: "run1",
              nodeId,
              digest: "digest",
              producerAttemptId: `attempt:${nodeId}`,
              contract: { id: `artifact:${nodeId}`, revision: "artifact-r1" },
              kind: "files",
              location: "loc",
              adoptedAt: "2026-07-22T00:00:00.000Z"
            };
          }
        }
        return Promise.resolve(state());
      })
    };

    const dispatched: string[] = [];
    let releaseSlow!: () => void;
    const slowFinished = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const succeed = (nodeId: string) => ({
      kind: "success",
      candidateCommit: "c1",
      outputDigest: "d1",
      changedFiles: ["src/app.ts"],
      evidenceMatrix: {
        matrixId: `m-${nodeId}`,
        outcome: "verified",
        candidateCommit: "c1",
        validationContract: { id: `validation:${nodeId}`, revision: "validation-r1" }
      },
      artifactLocation: "loc"
    });
    const execute = vi.fn().mockImplementation(async (invocation: any) => {
      const nodeId = invocation.node.id;
      dispatched.push(nodeId);
      if (nodeId === "slow") await slowFinished;
      return succeed(nodeId);
    });

    const input: V2ExecutionRunInput = {
      runId: "run1",
      graph,
      contracts: nodes.map((id) => makeValidBundle(id)) as any,
      repositoryContextDigest: "digest",
      executorProfile: { id: "ex", revision: "1" },
      // Two slots: `fast` and `slow` fill them, and `dependent` needs one to free.
      effectiveConfig: { maxParallel: 2 },
      materializableNodeIds: nodes,
      availableExecutorNodeIds: nodes,
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "fp", targetBranch: "main", targetHead: "head" }
    };
    const driver = new V2ExecutionDriver({
      coordinator: withDerivedRecording(coordinator),
      execute,
      loadCurrentInputs: async () => freshness(input),
      now: () => "2026-07-22T00:00:00Z"
    } as any);

    const running = driver.run(input);
    await vi.waitFor(() => {
      expect(dispatched).toContain("dependent");
    }, { timeout: 2000, interval: 10 });
    // Proven while `slow` is still running: the dependent did not wait for it.
    expect(dispatched).not.toContain("__never__");
    releaseSlow();
    await running;
  });
});

function withDerivedRecording<T extends {
  load(...args: any[]): Promise<any>;
  record?: (...args: any[]) => Promise<any>;
}>(coordinator: T): T & { recordDerived(runId: string, derive: (state: any) => Promise<any[]> | any[]): Promise<any> } {
  return Object.assign(coordinator, {
    async recordDerived(runId: string, derive: (state: any) => Promise<any[]> | any[]) {
      const facts = await derive(await coordinator.load(runId));
      if (coordinator.record === undefined) return coordinator.load(runId);
      return coordinator.record(runId, facts);
    }
  });
}

function freshness(input: V2ExecutionRunInput) {
  return {
    graph: input.graph,
    contracts: input.contracts,
    repositoryContextDigest: input.repositoryContextDigest,
    executorProfile: input.executorProfile,
    materializableNodeIds: input.materializableNodeIds,
    availableExecutorNodeIds: input.availableExecutorNodeIds,
    conflictConstraints: input.conflictConstraints
  };
}
