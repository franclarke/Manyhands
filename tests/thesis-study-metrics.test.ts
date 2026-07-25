import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJournal, summarizeRunJournal } from "../docs/tesis/evidence/scripts/lib/study-metrics.mjs";

const fixtures = path.resolve("tests/fixtures/thesis-metrics");

describe("uncensored thesis study metrics", () => {
  it("keeps time and token cost from a failed attempt without fabricating oracle coverage", async () => {
    const events = await readJournal(path.join(fixtures, "failed-after-usage.events.jsonl"));
    const summary = summarizeRunJournal(events);

    expect(summary).toMatchObject({
      runId: "failed-run",
      delivered: 0,
      wallClockSeconds: 20,
      tokensTotal: 1200,
      usageStatus: "reported",
      externalOracleCoverage: "not_applicable"
    });
  });

  it("distinguishes a measured zero from unavailable usage and emits assessment rows", async () => {
    const events = await readJournal(path.join(fixtures, "completed-c2.events.jsonl"));
    const summary = summarizeRunJournal(events, { satisfied: 4, total: 5 });

    expect(summary.tokensTotal).toBe(0);
    expect(summary.usageStatus).toBe("reported");
    expect(summary.externalOracleCoverage).toBe(0.8);
    expect(summary.strategyAssessments).toEqual([
      expect.objectContaining({ runId: "complete-run", unitKey: "warehouse", selected: "split", splitAdvantage: 0.6 })
    ]);
  });

  it("contains only versioned fixture data", async () => {
    expect((await readFile(path.join(fixtures, "failed-after-usage.events.jsonl"), "utf8")).trim()).not.toBe("");
  });
});
