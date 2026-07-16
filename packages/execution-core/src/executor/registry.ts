/** Compatibility re-export. The registry is intentionally client-safe and lives in @manyhands/shared. */
export {
  CLAUDE_CODE_EXECUTOR_ID,
  CODEX_EXECUTOR_ID,
  OPENCODE_EXECUTOR_ID,
  EXECUTOR_IDS,
  EXECUTOR_DESCRIPTORS,
  DEFAULT_EXECUTOR_SELECTION,
  getExecutorDescriptor,
  findExecutorDescriptor,
  findExecutorModel,
  isExecutorSelection,
  normalizeExecutorSelection,
  resolveLegacyModelSelection,
  usageSourceForSelection,
  EFFORT_LEVELS,
  isEffortLevel,
  effortsForSelection,
  supportsEffortForSelection,
  defaultEffortForSelection,
  ReasoningEffortSchema
} from "@manyhands/shared";
export type {
  ExecutorId,
  ExecutorCapability,
  UsageSource,
  ExecutorModelDescriptor,
  ExecutorDescriptor,
  ExecutorSelection,
  StageSelection,
  EffortLevel
} from "@manyhands/shared";
