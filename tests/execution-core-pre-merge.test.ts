import { describe, expect, it } from "vitest";
import { computePreMergeFindings } from "@manyhands/execution-core";

function child(taskId: string, changedFiles: string[], diff = "") {
  return { taskId, changedFiles, diff };
}

describe("computePreMergeFindings", () => {
  it("flags files changed by more than one child as a likely conflict", () => {
    const findings = computePreMergeFindings({
      childResults: [child("a", ["src/x.ts"]), child("b", ["src/x.ts", "src/y.ts"])]
    });
    const conflict = findings.find((f) => f.code === "likely_textual_conflict");
    expect(conflict?.files).toEqual(["src/x.ts"]);
  });

  it("flags a consumed seam with no producer among the children", () => {
    const findings = computePreMergeFindings({
      childResults: [child("a", [])],
      childIntents: [{ taskId: "a", produces: [], consumes: ["TaskStore"] }]
    });
    expect(findings.map((f) => f.code)).toContain("missing_producer");
  });

  it("notes a produced seam that is absent from the producer's diff", () => {
    const findings = computePreMergeFindings({
      childResults: [child("a", ["src/a.ts"], "export const foo = 1;")],
      childIntents: [{ taskId: "a", produces: ["TaskStore"], consumes: [] }]
    });
    expect(findings.map((f) => f.code)).toContain("seam_not_in_diff");
  });

  it("is clean when files are disjoint and seams are satisfied", () => {
    const findings = computePreMergeFindings({
      childResults: [child("a", ["src/a.ts"], "export const TaskStore = {}"), child("b", ["src/b.ts"], "")],
      childIntents: [
        { taskId: "a", produces: ["TaskStore"], consumes: [] },
        { taskId: "b", produces: [], consumes: ["TaskStore"] }
      ]
    });
    expect(findings).toEqual([]);
  });
});
