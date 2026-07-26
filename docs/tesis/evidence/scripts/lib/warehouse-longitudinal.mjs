export const MINIMUM_FREE_BYTES = 25 * 1024 ** 3;
export const INCREMENTS = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);

/**
 * The one executor selection the whole study runs on, for planning, execution
 * and repair alike.
 *
 * Claude Code reports token usage and an exact `total_cost_usd` per attempt;
 * the Codex CLI declares `usageSource: "unavailable"`, which would make cost —
 * a primary variable of this study — permanently unmeasurable and tokens a
 * lower bound. G5 already carries a cell whose token total is a floor because
 * an attempt reported nothing.
 *
 * `sonnet` is the declared model: strong enough for the increments and
 * sustainable across the full program's run count. If the pilot shows it is not
 * capable enough for the later increments, that is a pilot finding and the
 * model changes BEFORE the freeze — never during the Final series.
 *
 * Claude models expose no reasoning-effort knob (`efforts: null` in the
 * registry), so this selection carries no `effort` field by design.
 */
/**
 * 2026-07-26: the study moves back to Codex `gpt-5.5` at `high`.
 *
 * The reason for Claude Code was telemetry — Codex declares
 * `usageSource: "unavailable"`, so cost is unmeasurable and tokens are a lower
 * bound. That cost is now paid deliberately, because capacity turned out to be
 * the binding constraint: the Claude selection shares its quota with the
 * interactive session driving the pilot and sustained roughly forty minutes of
 * it, while a single increment can take thirty. Four series died on that.
 *
 * The consequence must be reported, not hidden: with this selection the study
 * reports tokens as a floor and cost as `unavailable`, exactly as G5 did. If a
 * measured cost is wanted later, it has to come from an executor that reports
 * it, and the whole series has to be re-run under that executor.
 */
export const STUDY_SELECTION = { executorId: "codex-cli", model: "gpt-5.5", effort: "high" };

/** The identical selection applied to every pipeline stage. */
export function studyStageSelections() {
  return {
    planningSelection: { ...STUDY_SELECTION },
    executionSelection: { ...STUDY_SELECTION },
    repairSelection: { ...STUDY_SELECTION }
  };
}

/** Whether an observed stage selection matches the declared study selection. */
export function selectionMatches(selection) {
  return selection?.executorId === STUDY_SELECTION.executorId
    && selection?.model === STUDY_SELECTION.model
    && selection?.effort === STUDY_SELECTION.effort;
}

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

export function seedIdentityMatches({ tree, expectedTree, lockfileGitBlob, expectedLockfileGitBlob }) {
  return tree === expectedTree && lockfileGitBlob === expectedLockfileGitBlob;
}
