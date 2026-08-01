const REQUIRED_PROTOCOL = {
  version: 1,
  maxPlanningAttempts: 1,
  maxAutomaticRetryBudget: 0,
  maxCellCostUsd: 8,
  maxSeriesCostUsd: 40,
  maxSeriesTokens: 2_000_000
};

export function assertG6ComparativeCellProtocol(config) {
  if (config?.seriesKind !== "comparative") return undefined;

  const protocol = config.g6Protocol;
  if (!isRecord(protocol)) throw new Error("G6 comparative cell must declare g6Protocol.");
  for (const [key, expected] of Object.entries(REQUIRED_PROTOCOL)) {
    if (protocol[key] !== expected) {
      throw new Error(`G6 protocol ${key} must be ${expected}.`);
    }
  }

  const executionConfig = config.executionConfig;
  if (!isRecord(executionConfig)) throw new Error("G6 comparative cell must declare executionConfig.");
  if (executionConfig.automaticRetryBudget !== protocol.maxAutomaticRetryBudget) {
    throw new Error("G6 executionConfig.automaticRetryBudget must match the frozen protocol.");
  }
  if (executionConfig.maxPlanningAttempts !== protocol.maxPlanningAttempts) {
    throw new Error("G6 executionConfig.maxPlanningAttempts must match the frozen protocol.");
  }
  if (executionConfig.maxCostUsd !== protocol.maxCellCostUsd) {
    throw new Error("G6 executionConfig.maxCostUsd must match the frozen protocol.");
  }
  return protocol;
}

export function executionConfigForG6Cell(config) {
  assertG6ComparativeCellProtocol(config);
  return config.executionConfig ?? {};
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
