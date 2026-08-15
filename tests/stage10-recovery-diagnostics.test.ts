import { describe, expect, it } from "vitest";

import {
  RecoveryDiagnosticSchema,
  describeRecoveryDiagnostic,
  type RecoveryDiagnostic
} from "@manyhands/contracts";

/**
 * Recovery failures reached operators as prose. "The delivery target changed"
 * names neither the ref nor either OID, so nobody can tell whether the branch
 * advanced to an ancestor, moved to an unrelated commit, or was never the
 * approved one — three situations with three different answers.
 *
 * A diagnostic carries the evidence that makes it actionable, and the schema is
 * what stops a member from being added without it.
 */
describe("Recovery diagnostics", () => {
  const wellFormed: Record<RecoveryDiagnostic["kind"], RecoveryDiagnostic> = {
    corrupt_journal: { kind: "corrupt_journal", runId: "run:a", sequence: 12, detail: "truncated record" },
    missing_object: { kind: "missing_object", oid: "a".repeat(40), expectedBy: "artifact:a" },
    unresolved_process: { kind: "unresolved_process", processId: "process:a", lastReceiptId: "receipt:a" },
    stale_decision: {
      kind: "stale_decision",
      decisionId: "decision:a",
      raisedAtGraphRevision: 1,
      currentGraphRevision: 2
    },
    target_divergence: {
      kind: "target_divergence",
      ref: "refs/heads/main",
      expectedOid: "b".repeat(40),
      actualOid: "c".repeat(40)
    },
    unrecoverable_external_effect: {
      kind: "unrecoverable_external_effect",
      effectId: "sha256:effect",
      detail: "the provider confirmed no receipt exists"
    }
  };

  it.each(Object.entries(wellFormed))("accepts a well-formed %s", (_kind, diagnostic) => {
    expect(RecoveryDiagnosticSchema.safeParse(diagnostic).success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(RecoveryDiagnosticSchema.safeParse({ kind: "something_else", detail: "x" }).success).toBe(false);
  });

  it.each(Object.entries(wellFormed))("rejects a %s missing its evidence", (_kind, diagnostic) => {
    // Drop the last field of each member: a diagnostic without its evidence is
    // the prose this replaces, wearing a type.
    const keys = Object.keys(diagnostic).filter((key) => key !== "kind");
    const withoutEvidence = { ...diagnostic } as Record<string, unknown>;
    delete withoutEvidence[keys.at(-1)!];
    expect(RecoveryDiagnosticSchema.safeParse(withoutEvidence).success).toBe(false);
  });

  it.each(Object.entries(wellFormed))("describes a %s in one actionable line", (_kind, diagnostic) => {
    const line = describeRecoveryDiagnostic(diagnostic);
    expect(line).not.toContain("\n");
    expect(line.length).toBeGreaterThan(0);
  });

  it("names both OIDs when the target diverged", () => {
    // The case that motivated this: an operator cannot act on "the target
    // changed" without knowing what it was expected to be and what it is.
    const line = describeRecoveryDiagnostic(wellFormed.target_divergence);
    expect(line).toContain("refs/heads/main");
    expect(line).toContain("b".repeat(40));
    expect(line).toContain("c".repeat(40));
  });

  it("names the run and the record when a journal is corrupt", () => {
    const line = describeRecoveryDiagnostic(wellFormed.corrupt_journal);
    expect(line).toContain("run:a");
    expect(line).toContain("12");
  });

  it("names both revisions when a decision went stale", () => {
    const line = describeRecoveryDiagnostic(wellFormed.stale_decision);
    expect(line).toContain("decision:a");
    expect(line).toContain("1");
    expect(line).toContain("2");
  });
});
