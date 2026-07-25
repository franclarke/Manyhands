import { describe, expect, it, vi } from "vitest";
import {
  NonRetryablePlanningError,
  WorkBreakdownPlanner,
  WorkBreakdownSchema,
  buildWorkBreakdownPrompt,
  type WorkBreakdown
} from "@manyhands/decomposer";

describe("WorkBreakdown", () => {
  it("accepts a hybrid vertical leaf that crosses UI, API and tests", () => {
    const breakdown = fixture();
    expect(WorkBreakdownSchema.parse(breakdown).root.children[0]).toMatchObject({
      kind: "leaf",
      concerns: ["ui", "api", "tests"]
    });
  });

  it.each(["targetDepth", "maxChildren", "dependencies", "worktreePath", "commands", "executorProfile"])(
    "rejects executable or template field %s",
    (field) => {
      const breakdown = fixture() as WorkBreakdown & Record<string, unknown>;
      breakdown[field] = field === "commands" ? ["pnpm test"] : 3;
      expect(WorkBreakdownSchema.safeParse(breakdown).success).toBe(false);
    }
  );

  it("preserves a relevant human question and the repository evidence behind it", () => {
    const breakdown = WorkBreakdownSchema.parse(fixture());
    expect(breakdown.repositoryEvidence).toContainEqual(
      expect.objectContaining({ id: "route-evidence", kind: "path", reference: "src/routes/bookings.ts" })
    );
    expect(breakdown.questions).toContainEqual(
      expect.objectContaining({
        id: "booking-policy",
        question: "Can a booking overlap an existing booking?",
        evidenceIds: ["route-evidence"],
        impact: "behavior"
      })
    );
  });

  it("uses bounded schema repair and cache without falling back to a synthetic plan", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 2, objective: "incomplete" })
      .mockResolvedValueOnce(fixture());
    const cache = new Map<string, WorkBreakdown>();
    const planner = new WorkBreakdownPlanner({ model: { generate }, maxAttempts: 2, cache, retryDelayMs: 0 });
    const input = plannerInput();

    const first = await planner.plan(input);
    const second = await planner.plan(input);

    expect(first).toEqual(fixture());
    expect(second).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toMatchObject({ repairIssues: expect.arrayContaining([expect.stringContaining("root")]) });

    const failing = new WorkBreakdownPlanner({
      model: { generate: vi.fn().mockResolvedValue({ not: "a breakdown" }) },
      maxAttempts: 2,
      retryDelayMs: 0
    });
    await expect(failing.plan(input)).rejects.toThrow(/after 2 attempts/i);
  });

  it("does not retry a planning protocol failure that cannot be repaired by another model attempt", async () => {
    const generate = vi.fn().mockRejectedValue(new NonRetryablePlanningError("Claude stream closed without a successful terminal result."));
    const attempts: string[] = [];
    const planner = new WorkBreakdownPlanner({ model: { generate }, maxAttempts: 3, retryDelayMs: 0 });

    await expect(planner.plan(plannerInput(), {
      onAttemptFailed: ({ attempt, reason }) => { attempts.push(`${attempt}:${reason}`); }
    })).rejects.toThrow(/stopped after 1 attempt.*terminal result/i);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual(["1:Claude stream closed without a successful terminal result."]);
  });

  it("accepts declared planned paths for a greenfield leaf without treating them as repository evidence", () => {
    const breakdown = fixture();
    if (breakdown.root.kind !== "composite") throw new Error("Expected a composite fixture root.");
    const leaf = breakdown.root.children[0]!;
    leaf.evidenceIds = [];
    leaf.plannedPaths = ["src/app/bookings/page.tsx", "src/app/api/bookings/route.ts"];

    const parsed = WorkBreakdownSchema.parse(breakdown);

    expect(parsed.root.kind === "composite" ? parsed.root.children[0]?.plannedPaths : undefined).toEqual([
      "src/app/bookings/page.tsx",
      "src/app/api/bookings/route.ts"
    ]);
    expect(parsed.repositoryEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: "src/app/bookings/page.tsx" })
    ]));
  });

  it("rejects a leaf with neither grounded path evidence nor declared planned paths", () => {
    const breakdown = fixture();
    if (breakdown.root.kind !== "composite") throw new Error("Expected a composite fixture root.");
    breakdown.root.children[0]!.evidenceIds = [];

    expect(WorkBreakdownSchema.safeParse(breakdown)).toMatchObject({ success: false });
  });

  it("reports planning attempts and units while the model is still generating", async () => {
    const observed: string[] = [];
    const planner = new WorkBreakdownPlanner({
      model: {
        generate: async (request) => {
          await request.onProgress({
            key: "booking-feature",
            parentKey: null,
            kind: "composite",
            title: "Booking creation",
            objective: "Deliver booking creation end to end",
            siblingIndex: 0,
            siblingCount: 1
          });
          observed.push("model-completed");
          return fixture();
        }
      },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await planner.plan(plannerInput(), {
      onAttemptStarted: ({ attempt }) => { observed.push(`attempt-${attempt}`); },
      onUnitDiscovered: ({ unit }) => { observed.push(`unit-${unit.key}`); }
    });

    expect(observed.slice(0, 3)).toEqual(["attempt-1", "unit-booking-feature", "model-completed"]);
    expect(observed).toEqual(expect.arrayContaining(["unit-booking-flow", "unit-booking-policy"]));
  });

  it("prompts for semantic cuts without imposing graph shape or executable details", () => {
    const prompt = buildWorkBreakdownPrompt({
      ...plannerInput(),
      questionAnswers: { "booking-policy": "Reject overlap" }
    });
    expect(prompt.system).toContain("hybrid vertical slice");
    expect(prompt.system).toContain("Do not emit worktrees, exact commands, executor profiles, or generic dependency edges");
    expect(prompt.system).toContain("Do not target a fixed depth, child count, or layer template");
    expect(prompt.system).toContain('"candidateArtifacts"');
    expect(prompt.system).toContain("plannedPaths");
    expect(prompt.system).toContain("planning.node");
    expect(prompt.user).toContain("src/routes/bookings.ts");
    expect(prompt.user).toContain("repository snapshot snapshot-1");
    expect(prompt.user).toContain("booking-policy: Reject overlap");
    expect(prompt.system).toContain("do not ask the same question again");
  });

  it("retries a greenfield plan that leaves stub validation scripts out of scope", async () => {
    const incomplete = fixture();
    const repaired = fixture();
    const manifestEvidence = {
      id: "config-package-json",
      kind: "path" as const,
      reference: "package.json",
      observation: "Repository package manifest defining scripts",
      confidence: 1
    };
    for (const breakdown of [incomplete, repaired]) {
      breakdown.repositoryEvidence.push(manifestEvidence, {
        id: "script-empty-test",
        kind: "script",
        reference: "test",
        observation: "node -e \"console.log('empty seed tests: ok')\"",
        confidence: 1
      });
      if (breakdown.root.kind !== "composite") throw new Error("Expected composite fixture.");
      breakdown.root.children[0]!.plannedPaths = ["src/new-domain.ts"];
    }
    if (repaired.root.kind !== "composite") throw new Error("Expected composite fixture.");
    repaired.root.children[0]!.evidenceIds.push(manifestEvidence.id);

    const generate = vi.fn().mockResolvedValueOnce(incomplete).mockResolvedValueOnce(repaired);
    const planner = new WorkBreakdownPlanner({ model: { generate }, maxAttempts: 2, retryDelayMs: 0 });
    const result = await planner.plan({
      ...plannerInput(),
      repositorySnapshot: {
        ...plannerInput().repositorySnapshot,
        evidence: [...plannerInput().repositorySnapshot.evidence, manifestEvidence, {
          id: "script-empty-test",
          kind: "script",
          reference: "test",
          observation: "node -e \"console.log('empty seed tests: ok')\"",
          confidence: 1
        }]
      }
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].repairIssues).toEqual(expect.arrayContaining([
      expect.stringContaining("package.json")
    ]));
    expect(result).toEqual(repaired);
  });

  it("retries when a declared contract section is flattened instead of preserved verbatim", async () => {
    const contract = [
      "## Probe contract",
      "",
      "Emit `{ capabilities: { layout, inventory } }` and a `sha256:` state hash."
    ].join("\n");
    const incomplete = fixture();
    incomplete.acceptanceIntents[0]!.description = "Emit capabilities, layout, inventory and a state hash.";
    const repaired = fixture();
    repaired.acceptanceIntents[0]!.description = contract;
    const generate = vi.fn().mockResolvedValueOnce(incomplete).mockResolvedValueOnce(repaired);
    const planner = new WorkBreakdownPlanner({ model: { generate }, maxAttempts: 2, retryDelayMs: 0 });

    const result = await planner.plan({
      ...plannerInput(),
      goal: `Build the probe.\n\n${contract}\n\n## Constraints\n\nKeep it deterministic.`
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].repairIssues).toEqual(expect.arrayContaining([
      expect.stringContaining("Probe contract")
    ]));
    expect(result).toEqual(repaired);
  });

  it("passes measured granularity feedback into a semantic replan without prescribing a path split", () => {
    const prompt = buildWorkBreakdownPrompt({
      ...plannerInput(),
      granularityFeedback: {
        unitKey: "booking-feature",
        reason: "missing_semantic_cut",
        evidence: [
          "estimated context exceeds the configured leaf budget",
          "the previous proposal exposed only one child"
        ]
      }
    });

    expect(prompt.user).toContain("Granularity replan feedback for booking-feature");
    expect(prompt.user).toContain("missing_semantic_cut");
    expect(prompt.user).toContain("previous proposal exposed only one child");
    expect(prompt.system).toContain("Revise the semantic cut when granularity feedback is supplied");
    expect(prompt.system).toContain("Never partition a task by mechanically distributing paths");
    // Warehouse pilot W1 lost every planning attempt to an empty
    // consumerUnitKeys array; the schema forbids it but the prompt only asked
    // for consumers to be "explicit", which an empty array formally satisfies.
    expect(prompt.system).toContain("at least one consumer unit key");
    expect(prompt.system).toContain("omit it entirely rather than emitting an empty consumerUnitKeys array");
    expect(prompt.system).toContain("at least two cohesive children");
  });

  it("does not mistake streamed planning-node envelopes for complete WorkBreakdown documents", async () => {
    const planner = new WorkBreakdownPlanner({
      model: {
        generate: async () => [
          JSON.stringify({
            type: "planning.node",
            unit: {
              key: "booking-feature",
              parentKey: null,
              kind: "composite",
              title: "Booking creation",
              objective: "Deliver booking creation end to end",
              siblingIndex: 0,
              siblingCount: 1
            }
          }),
          JSON.stringify(fixture())
        ].join("\n")
      },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(planner.plan(plannerInput())).resolves.toEqual(fixture());
  });

  /**
   * Progress envelopes were classified by whether they fully validated, so an
   * imperfect one fell through to the document candidates and was rejected as a
   * malformed WorkBreakdown. Warehouse pilot W1 burned all three planning
   * attempts on `root: Unrecognized key(s) in object: 'type', 'unit'` — the
   * planner never saw the document the model had also emitted. `type` is the
   * discriminator: a planning.node envelope is never a WorkBreakdown, however
   * badly formed its unit payload is.
   */
  it.each([
    ["a missing siblingCount", { key: "u", parentKey: null, kind: "leaf", title: "T", objective: "O", siblingIndex: 0 }],
    ["a siblingIndex past siblingCount", { key: "u", parentKey: null, kind: "leaf", title: "T", objective: "O", siblingIndex: 3, siblingCount: 1 }],
    ["an unexpected extra field", { key: "u", parentKey: null, kind: "leaf", title: "T", objective: "O", siblingIndex: 0, siblingCount: 1, depth: 2 }],
    ["an entirely absent unit", undefined]
  ])("ignores a planning-node envelope with %s instead of failing the attempt", async (_label, unit) => {
    const planner = new WorkBreakdownPlanner({
      model: {
        generate: async () => [
          JSON.stringify({ type: "planning.node", ...(unit === undefined ? {} : { unit }) }),
          JSON.stringify(fixture())
        ].join("\n")
      },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(planner.plan(plannerInput())).resolves.toEqual(fixture());
  });

  it("still reports when the model emitted only progress and no document", async () => {
    const planner = new WorkBreakdownPlanner({
      model: {
        generate: async () => JSON.stringify({ type: "planning.node", unit: { key: "u" } })
      },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(planner.plan(plannerInput())).rejects.toThrow(/no complete WorkBreakdown/u);
  });
});

function plannerInput() {
  return {
    goal: "Add booking creation",
    acceptanceCriteria: ["A visitor can create a valid booking"],
    constraints: ["Keep the existing route structure"],
    repositorySnapshot: {
      snapshotId: "snapshot-1",
      inspectionDisposition: "complete" as const,
      evidence: [{ id: "route-evidence", kind: "path" as const, reference: "src/routes/bookings.ts", observation: "Existing booking route", confidence: 1 }]
    }
  };
}

function fixture(): WorkBreakdown {
  return {
    schemaVersion: 2,
    breakdownId: "booking-breakdown",
    objective: "Allow a visitor to create a booking",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: [{ id: "booking-created", description: "A valid booking is stored and shown", required: true }],
    root: {
      key: "booking-feature",
      kind: "composite",
      title: "Booking creation",
      objective: "Deliver booking creation end to end",
      concerns: ["product-flow"],
      expectedOutcomes: ["A usable booking flow"],
      acceptanceIntentIds: ["booking-created"],
      evidenceIds: ["route-evidence"],
      cut: { criterion: "cohesion", rationale: "Keep the observable flow together while isolating policy." },
      children: [
        {
          key: "booking-flow",
          kind: "leaf",
          title: "Create a booking",
          objective: "Implement the cohesive booking flow",
          concerns: ["ui", "api", "tests"],
          expectedOutcomes: ["The form submits and renders the stored booking"],
          acceptanceIntentIds: ["booking-created"],
          evidenceIds: ["route-evidence"]
        },
        {
          key: "booking-policy",
          kind: "leaf",
          title: "Booking policy",
          objective: "Define overlap behavior after the user decides it",
          concerns: ["domain"],
          expectedOutcomes: ["Overlap rules are explicit"],
          acceptanceIntentIds: ["booking-created"],
          evidenceIds: ["route-evidence"]
        }
      ]
    },
    candidateArtifacts: [{
      id: "booking-record",
      artifactType: "domain-model",
      producerUnitKey: "booking-policy",
      consumerUnitKeys: ["booking-flow"],
      purpose: "Share the booking representation",
      materializationHint: "logical",
      evidenceIds: ["route-evidence"]
    }],
    candidateSeams: [{
      id: "booking-contract",
      kind: "type",
      specification: "Booking data required by the flow",
      producerUnitKey: "booking-policy",
      consumerUnitKeys: ["booking-flow"],
      evidenceIds: ["route-evidence"]
    }],
    repositoryEvidence: [{
      id: "route-evidence",
      kind: "path",
      reference: "src/routes/bookings.ts",
      observation: "Existing booking route",
      confidence: 1
    }],
    uncertainties: [{
      id: "overlap-unknown",
      description: "Overlap policy is unspecified",
      impact: "Changes validation and persistence behavior",
      requiresHumanDecision: true,
      evidenceIds: ["route-evidence"]
    }],
    questions: [{
      id: "booking-policy",
      question: "Can a booking overlap an existing booking?",
      reason: "The answer changes observable validation behavior",
      impact: "behavior",
      options: ["Reject overlap", "Allow overlap"],
      evidenceIds: ["route-evidence"]
    }]
  };
}
