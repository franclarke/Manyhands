/** Build the immutable run-creation payload from a frozen cell definition. */
export function buildRunRequest(config, workspaceId) {
  return {
    workspaceId,
    userPrompt: config.goal,
    ...(config.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: [...config.acceptanceCriteria] }),
    planningSelection: config.planningSelection,
    executionSelection: config.executionSelection,
    repairSelection: config.repairSelection ?? config.executionSelection,
    ...(config.candidateCount !== undefined ? { candidateCount: config.candidateCount } : {}),
    ...(config.granularityCondition !== undefined
      ? { granularityCondition: config.granularityCondition }
      : {}),
    executionConfig: config.executionConfig
  };
}
