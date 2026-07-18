import type { RunSeed } from "@/lib/run-model/types";

import type { RunRecord } from "./schema";

export function buildRunModelSeed(run: RunRecord): RunSeed {
  return {
    id: run.runId,
    title: run.title,
    goal: run.userPrompt,
    lifecycle: run.projection.lifecycle,
    eventSequence: run.projection.eventSequence
  };
}
