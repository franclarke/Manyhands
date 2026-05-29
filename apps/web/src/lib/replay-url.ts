import { toGranularityMode, type GranularityLevel } from "./granularity";

export interface ReplayDemoLinkInput {
  workspaceId: string;
  granularity: GranularityLevel;
  model?: string;
  benchmark?: string;
  config?: string;
}

const DEFAULT_BENCHMARK = "conflict-v0";
const DEFAULT_CONFIG = "B4";

export function buildReplayDemoUrl(input: ReplayDemoLinkInput): string {
  const params = new URLSearchParams({
    benchmark: input.benchmark ?? DEFAULT_BENCHMARK,
    config: input.config ?? DEFAULT_CONFIG,
    workspace: input.workspaceId,
    granularity: toGranularityMode(input.granularity)
  });
  if (input.model !== undefined && input.model.length > 0) {
    params.set("model", input.model);
  }
  return `/replay/demo?${params.toString()}`;
}
