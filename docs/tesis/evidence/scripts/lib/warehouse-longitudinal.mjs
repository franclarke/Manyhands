export const MINIMUM_FREE_BYTES = 25 * 1024 ** 3;
export const INCREMENTS = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);

export function evaluatePreflight(observation) {
  const failures = [];
  check(observation.freeBytes >= observation.minimumFreeBytes, "disk_insufficient", `${observation.freeBytes} bytes free; ${observation.minimumFreeBytes} required`);
  check(!observation.manyHandsDirty, "manyhands_dirty", "ManyHands has undeclared changes");
  check(!observation.targetDirty, "target_dirty", "target has undeclared changes");
  check(observation.targetHead === observation.expectedBase, "target_head_mismatch", `target ${observation.targetHead} != base ${observation.expectedBase}`);
  check(observation.seedMatches, "seed_hash_mismatch", "seed commit, tree, file list or lock hash differs");
  check(observation.promptHashesMatch, "prompt_hash_mismatch", "one or more prompt hashes differ");
  check(observation.oracleHashesMatch, "oracle_hash_mismatch", "one or more oracle hashes differ");
  check(observation.distHasPolicyMarker, "dist_stale", "compiled decomposer does not contain the frozen policy marker");
  check(observation.commitMatches, "manyhands_commit_mismatch", "ManyHands HEAD differs from declared commit");
  check(observation.toolchainMatches, "toolchain_mismatch", "Node or pnpm differs from protocol");
  check(observation.modelMatches, "model_mismatch", "model selection differs from protocol");
  return failures;

  function check(condition, code, message) { if (!condition) failures.push({ code, message }); }
}

export function buildLongitudinalPlan({ mode, baseSha, targetRepo, dryRun = true }) {
  if (!['pilot', 'final'].includes(mode)) throw new Error(`invalid mode ${mode}`);
  return INCREMENTS.map((increment, index) => ({
    increment,
    position: index + 1,
    mode,
    targetRepo,
    base: index === 0 ? baseSha : `verified-delivery:W${index}`,
    prompt: `protocol/prompts/${increment}.md`,
    oracleId: `warehouse-${increment.toLowerCase()}-v1`,
    dryRun
  }));
}

export function assertOraclePassed(result) {
  if (result?.outcome !== "pass") throw new Error(`oracle ${result?.increment ?? "unknown"} failed`);
}

export function advanceVerifiedBase({ deliveredSha, oracleOutcome }) {
  if (oracleOutcome !== "pass") throw new Error("cannot advance an unverified delivery");
  if (!/^[0-9a-f]{40}$/u.test(deliveredSha)) throw new Error(`invalid delivered SHA ${deliveredSha}`);
  return deliveredSha;
}
