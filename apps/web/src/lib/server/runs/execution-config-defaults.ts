import type { ExecutorSelection } from "@/lib/models";
import type { ExecutionConfigInput } from "./schema";

export function withDefaultReasoningEffort(
  config: ExecutionConfigInput | undefined,
  selection: Pick<ExecutorSelection, "executorId"> | undefined
): ExecutionConfigInput {
  if (selection?.executorId !== "codex-cli" || config?.reasoningEffort !== undefined) {
    return config ?? {};
  }
  return { ...(config ?? {}), reasoningEffort: "medium" };
}
