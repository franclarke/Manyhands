import { describe, expect, it, vi } from "vitest";
import type {
  EffectInputSpec,
  EffectIntent,
  PhysicalEffectReceipt
} from "@manyhands/contracts";
import {
  createArtifactMaterializePhysicalEffectAdapter,
  createCleanupPhysicalEffectAdapter,
  createDeliveryPhysicalEffectAdapter,
  createGitMutationPhysicalEffectAdapter,
  createModelCallPhysicalEffectAdapter,
  createSandboxCreatePhysicalEffectAdapter,
  createValidationPhysicalEffectAdapter,
  type ArtifactMaterializePort,
  type CleanupPort,
  type DeliveryPort,
  type GitMutationPort,
  type ModelCallPort,
  type SandboxCreatePort,
  type ValidationPort
} from "../packages/run-engine/src/physical-effect-adapters.js";
import type {
  PhysicalEffectAdapterContext,
  PhysicalEffectAdapter,
  PhysicalEffectObservationInput
} from "../packages/run-engine/src/effect-dispatcher.js";

describe("kind-specific physical effect adapters", () => {
  it("records model_call success only after the exact immutable-view result is observed", async () => {
    const request = {
      effectId: "sha256:effect-model",
      repositoryViewDigest: "sha256:view-1",
      requestDigest: "sha256:request-1",
      modelProfileDigest: "sha256:model-profile-1"
    };
    const inspect = vi.fn<ModelCallPort["inspect"]>()
      .mockResolvedValueOnce({ state: "absent", evidenceDigest: "sha256:no-result" })
      .mockResolvedValueOnce({ state: "succeeded", evidenceDigest: "sha256:model-result" });
    const invoke = vi.fn<ModelCallPort["invoke"]>().mockResolvedValue(undefined);
    const adapter = createModelCallPhysicalEffectAdapter({
      clock: fixedClock,
      port: { inspect, invoke }
    });
    const observed = recordingContext("model_call", {
      repositoryViewDigest: request.repositoryViewDigest,
      requestDigest: request.requestDigest,
      modelProfileDigest: request.modelProfileDigest
    });

    await adapter.execute(intent("model_call", request.effectId), observed.context);

    expect(inspect).toHaveBeenNthCalledWith(1, request);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(request);
    expect(inspect).toHaveBeenNthCalledWith(2, request);
    expect(observed.records).toEqual([{
      observation: "succeeded",
      resultDigest: "sha256:model-result",
      observedAt: "2026-08-12T22:00:00.000Z"
    }]);
  });

  it("disposes a divergent deterministic sandbox before creating and verifying it", async () => {
    const request = {
      effectId: "sha256:effect-sandbox",
      sandboxPath: "C:/manyhands/sandboxes/effect-sandbox",
      repositoryViewDigest: "sha256:view-1",
      policyDigest: "sha256:policy-1"
    };
    const inspect = vi.fn<SandboxCreatePort["inspect"]>()
      .mockResolvedValueOnce({ state: "divergent", evidenceDigest: "sha256:foreign-sandbox" })
      .mockResolvedValueOnce({ state: "absent", evidenceDigest: "sha256:disposed" })
      .mockResolvedValueOnce({ state: "matching", evidenceDigest: "sha256:sandbox-ready" });
    const dispose = vi.fn<SandboxCreatePort["dispose"]>().mockResolvedValue(undefined);
    const create = vi.fn<SandboxCreatePort["create"]>().mockResolvedValue(undefined);
    const adapter = createSandboxCreatePhysicalEffectAdapter({
      clock: fixedClock,
      port: { inspect, dispose, create }
    });
    const observed = recordingContext("sandbox_create", {
      sandboxPath: request.sandboxPath,
      repositoryViewDigest: request.repositoryViewDigest,
      policyDigest: request.policyDigest
    });

    await adapter.execute(intent("sandbox_create", request.effectId), observed.context);

    expect(dispose).toHaveBeenCalledWith(request);
    expect(create).toHaveBeenCalledWith(request);
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(observed.records).toEqual([{
      observation: "succeeded",
      resultDigest: "sha256:sandbox-ready",
      observedAt: fixedClock()
    }]);
  });

  it("reuses an already matching sandbox during recovery without creating it twice", async () => {
    const inspect = vi.fn<SandboxCreatePort["inspect"]>().mockResolvedValue({
      state: "matching",
      evidenceDigest: "sha256:sandbox-existing"
    });
    const create = vi.fn<SandboxCreatePort["create"]>();
    const dispose = vi.fn<SandboxCreatePort["dispose"]>();
    const adapter = createSandboxCreatePhysicalEffectAdapter({
      clock: fixedClock,
      port: { inspect, create, dispose }
    });
    const observed = recordingContext("sandbox_create", {
      sandboxPath: "C:/manyhands/sandboxes/effect-existing",
      repositoryViewDigest: "sha256:view-1",
      policyDigest: "sha256:policy-1"
    });

    await adapter.reconcile(intent("sandbox_create", "sha256:effect-existing"), observed.context);

    expect(create).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(observed.records[0]).toEqual(expect.objectContaining({
      observation: "succeeded",
      resultDigest: "sha256:sandbox-existing"
    }));
  });

  it("repeats model_call recovery only when the exact immutable view has no result", async () => {
    const inspect = vi.fn<ModelCallPort["inspect"]>().mockResolvedValue({
      state: "succeeded",
      evidenceDigest: "sha256:model-existing"
    });
    const invoke = vi.fn<ModelCallPort["invoke"]>();
    const adapter = createModelCallPhysicalEffectAdapter({ clock: fixedClock, port: { inspect, invoke } });
    const observed = recordingContext("model_call", {
      repositoryViewDigest: "sha256:view-immutable",
      requestDigest: "sha256:request-immutable",
      modelProfileDigest: "sha256:model-profile"
    });

    await adapter.reconcile(intent("model_call", "sha256:effect-model-recovery"), observed.context);

    expect(invoke).not.toHaveBeenCalled();
    expect(observed.records[0]).toEqual(expect.objectContaining({
      observation: "succeeded",
      resultDigest: "sha256:model-existing"
    }));
  });

  it("adopts an exact effect-scoped Git ref and discards a divergent one before mutation", async () => {
    const exactTree = "candidate-tree";
    const inspect = vi.fn<GitMutationPort["inspect"]>()
      .mockResolvedValueOnce({ state: "matching", treeSha: exactTree, evidenceDigest: "sha256:adopted-ref" });
    const mutate = vi.fn<GitMutationPort["mutate"]>();
    const discard = vi.fn<GitMutationPort["discard"]>();
    const adapter = createGitMutationPhysicalEffectAdapter({
      clock: fixedClock,
      port: { inspect, mutate, discard }
    });
    const payload = {
      baseTreeSha: "base-tree",
      expectedTreeSha: exactTree,
      operationDigest: "sha256:git-operation"
    };
    const adopted = recordingContext("git_mutation", payload);
    const effect = intent("git_mutation", "sha256:git-adopt");

    await adapter.reconcile(effect, adopted.context);

    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      effectId: effect.effectId,
      privateRef: "refs/manyhands/effects/sha256%3Agit-adopt",
      expectedTreeSha: exactTree
    }));
    expect(mutate).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(adopted.records[0]).toEqual(expect.objectContaining({ observation: "succeeded" }));

    inspect
      .mockReset()
      .mockResolvedValueOnce({ state: "divergent", treeSha: "foreign-tree", evidenceDigest: "sha256:divergent-ref" })
      .mockResolvedValueOnce({ state: "absent", treeSha: null, evidenceDigest: "sha256:discarded-ref" })
      .mockResolvedValueOnce({ state: "matching", treeSha: exactTree, evidenceDigest: "sha256:new-ref" });
    mutate.mockResolvedValueOnce(undefined);
    discard.mockResolvedValueOnce(undefined);
    const repaired = recordingContext("git_mutation", payload);

    await adapter.execute(effect, repaired.context);

    expect(discard).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
    expect(discard.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0]!);
    expect(repaired.records[0]).toEqual(expect.objectContaining({
      observation: "succeeded",
      resultDigest: "sha256:new-ref"
    }));
  });

  it("materializes exact preimages only in a fresh index and always disposes it", async () => {
    const createFreshIndex = vi.fn<ArtifactMaterializePort["createFreshIndex"]>()
      .mockResolvedValue({ indexId: "index:one", empty: true, evidenceDigest: "sha256:fresh-index" });
    const materialize = vi.fn<ArtifactMaterializePort["materialize"]>().mockResolvedValue(undefined);
    const inspect = vi.fn<ArtifactMaterializePort["inspect"]>().mockResolvedValue({
      state: "matching",
      evidenceDigest: "sha256:materialized-tree"
    });
    const dispose = vi.fn<ArtifactMaterializePort["dispose"]>().mockResolvedValue(undefined);
    const adapter = createArtifactMaterializePhysicalEffectAdapter({
      clock: fixedClock,
      port: { createFreshIndex, materialize, inspect, dispose }
    });
    const observed = recordingContext("artifact_materialize", {
      manifestDigest: "sha256:manifest",
      targetTreeSha: "target-tree",
      preimageDigests: ["sha256:preimage-a", "sha256:preimage-b"]
    });
    const effect = intent("artifact_materialize", "sha256:artifact-materialize");

    await adapter.execute(effect, observed.context);

    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      effectId: effect.effectId,
      preimageDigests: ["sha256:preimage-a", "sha256:preimage-b"]
    }), "index:one");
    expect(dispose).toHaveBeenCalledWith(expect.objectContaining({ effectId: effect.effectId }), "index:one");
    expect(observed.records[0]).toEqual(expect.objectContaining({
      observation: "succeeded",
      resultDigest: "sha256:materialized-tree"
    }));
  });

  it("uses another fresh index during artifact recovery and records divergent output as failed", async () => {
    const createFreshIndex = vi.fn<ArtifactMaterializePort["createFreshIndex"]>()
      .mockResolvedValue({ indexId: "index:recovery", empty: true, evidenceDigest: "sha256:fresh-index" });
    const materialize = vi.fn<ArtifactMaterializePort["materialize"]>().mockResolvedValue(undefined);
    const inspect = vi.fn<ArtifactMaterializePort["inspect"]>().mockResolvedValue({
      state: "divergent",
      evidenceDigest: "sha256:wrong-materialization"
    });
    const dispose = vi.fn<ArtifactMaterializePort["dispose"]>().mockResolvedValue(undefined);
    const adapter = createArtifactMaterializePhysicalEffectAdapter({
      clock: fixedClock,
      port: { createFreshIndex, materialize, inspect, dispose }
    });
    const observed = recordingContext("artifact_materialize", {
      manifestDigest: "sha256:manifest",
      targetTreeSha: "target-tree",
      preimageDigests: ["sha256:preimage-a"]
    });

    await adapter.reconcile(intent("artifact_materialize", "sha256:artifact-recovery"), observed.context);

    expect(createFreshIndex).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(observed.records[0]).toEqual(expect.objectContaining({ observation: "failed" }));
  });

  it("creates a new validation execution on recovery for the same exact candidate and recipe", async () => {
    const start = vi.fn<ValidationPort["start"]>()
      .mockResolvedValueOnce({ executionId: "validation:one" })
      .mockResolvedValueOnce({ executionId: "validation:two" });
    const inspect = vi.fn<ValidationPort["inspect"]>().mockImplementation(async (request, executionId) => ({
      state: "succeeded" as const,
      executionId,
      candidateTreeSha: request.candidateTreeSha,
      recipeDigest: request.recipeDigest,
      environmentDigest: request.environmentDigest,
      evidenceDigest: `sha256:${executionId}`
    }));
    const adapter = createValidationPhysicalEffectAdapter({ clock: fixedClock, port: { start, inspect } });
    const payload = {
      candidateTreeSha: "candidate-tree",
      recipeDigest: "sha256:recipe",
      environmentDigest: "sha256:environment"
    };
    const first = recordingContext("validation", payload);
    const recovered = recordingContext("validation", payload);
    const effect = intent("validation", "sha256:validation");

    await adapter.execute(effect, first.context);
    await adapter.reconcile(effect, recovered.context);

    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(1, expect.objectContaining(payload));
    expect(start).toHaveBeenNthCalledWith(2, expect.objectContaining(payload));
    expect(inspect.mock.calls.map((call) => call[1])).toEqual(["validation:one", "validation:two"]);
    expect(first.records[0]).toEqual(expect.objectContaining({ resultDigest: "sha256:validation:one" }));
    expect(recovered.records[0]).toEqual(expect.objectContaining({ resultDigest: "sha256:validation:two" }));
  });

  it("rejects validation evidence bound to a different candidate before recording success", async () => {
    const start = vi.fn<ValidationPort["start"]>().mockResolvedValue({ executionId: "validation:wrong" });
    const inspect = vi.fn<ValidationPort["inspect"]>().mockResolvedValue({
      state: "succeeded",
      executionId: "validation:wrong",
      candidateTreeSha: "another-tree",
      recipeDigest: "sha256:recipe",
      environmentDigest: "sha256:environment",
      evidenceDigest: "sha256:invalid-evidence"
    });
    const adapter = createValidationPhysicalEffectAdapter({ clock: fixedClock, port: { start, inspect } });
    const observed = recordingContext("validation", {
      candidateTreeSha: "candidate-tree",
      recipeDigest: "sha256:recipe",
      environmentDigest: "sha256:environment"
    });

    await expect(adapter.execute(intent("validation", "sha256:validation-wrong"), observed.context))
      .rejects.toThrow(/different candidate/i);
    expect(observed.records).toEqual([]);
  });

  it("delivers only by compare-and-swap from the approved destination head", async () => {
    const inspect = vi.fn<DeliveryPort["inspect"]>()
      .mockResolvedValueOnce({
        state: "expected",
        headSha: "approved-head",
        treeSha: "approved-tree",
        evidenceDigest: "sha256:before-delivery"
      })
      .mockResolvedValueOnce({
        state: "published",
        headSha: "candidate-commit",
        treeSha: "candidate-tree",
        evidenceDigest: "sha256:published"
      });
    const compareAndSwap = vi.fn<DeliveryPort["compareAndSwap"]>().mockResolvedValue(undefined);
    const adapter = createDeliveryPhysicalEffectAdapter({ clock: fixedClock, port: { inspect, compareAndSwap } });
    const payload = deliveryPayload();
    const observed = recordingContext("delivery", payload);
    const effect = intent("delivery", "sha256:delivery");

    await adapter.execute(effect, observed.context);

    expect(compareAndSwap).toHaveBeenCalledWith(expect.objectContaining({ effectId: effect.effectId, ...payload }));
    expect(observed.records[0]).toEqual(expect.objectContaining({
      observation: "succeeded",
      resultDigest: "sha256:published"
    }));
  });

  it("adopts an exact published delivery on recovery and never overwrites divergence", async () => {
    const inspect = vi.fn<DeliveryPort["inspect"]>().mockResolvedValue({
      state: "published",
      headSha: "candidate-commit",
      treeSha: "candidate-tree",
      evidenceDigest: "sha256:already-published"
    });
    const compareAndSwap = vi.fn<DeliveryPort["compareAndSwap"]>();
    const adapter = createDeliveryPhysicalEffectAdapter({ clock: fixedClock, port: { inspect, compareAndSwap } });
    const adopted = recordingContext("delivery", deliveryPayload());

    await adapter.reconcile(intent("delivery", "sha256:delivery-adopt"), adopted.context);

    expect(compareAndSwap).not.toHaveBeenCalled();
    expect(adopted.records[0]).toEqual(expect.objectContaining({ observation: "succeeded" }));

    inspect.mockResolvedValueOnce({
      state: "divergent",
      headSha: "someone-else-moved-head",
      treeSha: "someone-else-tree",
      evidenceDigest: "sha256:delivery-diverged"
    });
    const divergent = recordingContext("delivery", deliveryPayload());
    await adapter.reconcile(intent("delivery", "sha256:delivery-diverged"), divergent.context);

    expect(compareAndSwap).not.toHaveBeenCalled();
    expect(divergent.records[0]).toEqual(expect.objectContaining({
      observation: "failed",
      resultDigest: "sha256:delivery-diverged"
    }));
  });

  it("makes cleanup repeat-safe while refusing to remove a divergent resource identity", async () => {
    const inspect = vi.fn<CleanupPort["inspect"]>()
      .mockResolvedValueOnce({ state: "present", evidenceDigest: "sha256:resource-present" })
      .mockResolvedValueOnce({ state: "absent", evidenceDigest: "sha256:resource-removed" });
    const remove = vi.fn<CleanupPort["remove"]>().mockResolvedValue(undefined);
    const adapter = createCleanupPhysicalEffectAdapter({ clock: fixedClock, port: { inspect, remove } });
    const payload = {
      resourceKind: "sandbox",
      resourceId: "sandbox:one",
      ownershipDigest: "sha256:owner-one"
    };
    const effect = intent("cleanup", "sha256:cleanup");
    const first = recordingContext("cleanup", payload);

    await adapter.execute(effect, first.context);

    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ effectId: effect.effectId, ...payload }));
    expect(first.records[0]).toEqual(expect.objectContaining({ observation: "succeeded" }));

    inspect.mockReset().mockResolvedValueOnce({ state: "absent", evidenceDigest: "sha256:already-absent" });
    remove.mockClear();
    const recovered = recordingContext("cleanup", payload);
    await adapter.reconcile(effect, recovered.context);
    expect(remove).not.toHaveBeenCalled();
    expect(recovered.records[0]).toEqual(expect.objectContaining({ observation: "succeeded" }));

    inspect.mockResolvedValueOnce({ state: "divergent", evidenceDigest: "sha256:new-owner" });
    const divergent = recordingContext("cleanup", payload);
    await adapter.reconcile(effect, divergent.context);
    expect(remove).not.toHaveBeenCalled();
    expect(divergent.records[0]).toEqual(expect.objectContaining({ observation: "failed" }));
  });

  it.each(strictInputCases())("rejects unknown $kind input fields before touching its port", async ({
    adapter,
    kind,
    payload
  }) => {
    const observed = recordingContext(kind, { ...payload, unexpected: true });

    await expect(adapter.execute(intent(kind, `sha256:strict-${kind}`), observed.context))
      .rejects.toThrow(/exactly/i);
    expect(observed.records).toEqual([]);
  });
});

const fixedClock = (): string => "2026-08-12T22:00:00.000Z";

function intent(kind: EffectIntent["kind"], effectId: string): EffectIntent {
  return {
    effectId,
    runId: "run:physical-adapters",
    attemptId: `attempt:${kind}`,
    kind,
    inputDigest: `sha256:input-${kind}`,
    daemonEpoch: "daemon:epoch-1",
    idempotency: "reconcile_then_repeat",
    requestedAt: "2026-08-12T21:59:00.000Z"
  };
}

function recordingContext(
  kind: EffectIntent["kind"],
  payload: EffectInputSpec["payload"]
): {
  context: PhysicalEffectAdapterContext;
  records: PhysicalEffectObservationInput[];
} {
  const records: PhysicalEffectObservationInput[] = [];
  return {
    records,
    context: {
      observerDaemonEpoch: "daemon:epoch-1",
      inputSpec: { schemaVersion: 1, kind, payload },
      priorReceipts: [],
      async record(observation) {
        records.push(structuredClone(observation));
        return {} as PhysicalEffectReceipt;
      }
    }
  };
}

function deliveryPayload(): EffectInputSpec["payload"] {
  return {
    destinationRef: "refs/heads/main",
    expectedHeadSha: "approved-head",
    expectedTreeSha: "approved-tree",
    candidateCommitSha: "candidate-commit",
    candidateTreeSha: "candidate-tree"
  };
}

function strictInputCases(): Array<{
  kind: EffectIntent["kind"];
  payload: EffectInputSpec["payload"];
  adapter: PhysicalEffectAdapter;
}> {
  const portCalled = async (): Promise<never> => {
    throw new Error("port must not be called for schema-invalid input");
  };
  return [
    {
      kind: "model_call",
      payload: {
        repositoryViewDigest: "sha256:view",
        requestDigest: "sha256:request",
        modelProfileDigest: "sha256:profile"
      },
      adapter: createModelCallPhysicalEffectAdapter({
        clock: fixedClock,
        port: { inspect: portCalled, invoke: portCalled }
      })
    },
    {
      kind: "sandbox_create",
      payload: {
        sandboxPath: "C:/manyhands/sandboxes/strict",
        repositoryViewDigest: "sha256:view",
        policyDigest: "sha256:policy"
      },
      adapter: createSandboxCreatePhysicalEffectAdapter({
        clock: fixedClock,
        port: { inspect: portCalled, create: portCalled, dispose: portCalled }
      })
    },
    {
      kind: "git_mutation",
      payload: {
        baseTreeSha: "base-tree",
        expectedTreeSha: "expected-tree",
        operationDigest: "sha256:operation"
      },
      adapter: createGitMutationPhysicalEffectAdapter({
        clock: fixedClock,
        port: { inspect: portCalled, mutate: portCalled, discard: portCalled }
      })
    },
    {
      kind: "artifact_materialize",
      payload: {
        manifestDigest: "sha256:manifest",
        targetTreeSha: "target-tree",
        preimageDigests: ["sha256:preimage"]
      },
      adapter: createArtifactMaterializePhysicalEffectAdapter({
        clock: fixedClock,
        port: {
          createFreshIndex: portCalled,
          materialize: portCalled,
          inspect: portCalled,
          dispose: portCalled
        }
      })
    },
    {
      kind: "validation",
      payload: {
        candidateTreeSha: "candidate-tree",
        recipeDigest: "sha256:recipe",
        environmentDigest: "sha256:environment"
      },
      adapter: createValidationPhysicalEffectAdapter({
        clock: fixedClock,
        port: { start: portCalled, inspect: portCalled }
      })
    },
    {
      kind: "delivery",
      payload: deliveryPayload(),
      adapter: createDeliveryPhysicalEffectAdapter({
        clock: fixedClock,
        port: { inspect: portCalled, compareAndSwap: portCalled }
      })
    },
    {
      kind: "cleanup",
      payload: {
        resourceKind: "sandbox",
        resourceId: "sandbox:strict",
        ownershipDigest: "sha256:owner"
      },
      adapter: createCleanupPhysicalEffectAdapter({
        clock: fixedClock,
        port: { inspect: portCalled, remove: portCalled }
      })
    }
  ];
}
