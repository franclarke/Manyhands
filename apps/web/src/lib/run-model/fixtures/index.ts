/**
 * Golden fixtures registry. Each fixture is a `RunFixture` (array of `RunEvent`)
 * with the same shape as the future SSE stream, so it reduces identically to live.
 * See docs/design/golden-fixtures.md and docs/design/implementation-plan.md (PR 03).
 */
import type { RunFixture } from "../types";
import { goldenHappyPath } from "./golden-happy-path";
import { goldenPlanningQuestion } from "./golden-planning-question";
import { goldenVerifyAutoRepair } from "./golden-verify-auto-repair";
import { goldenBehavioralConflict } from "./golden-behavioral-conflict";
import { goldenSeamAmendmentBlastRadius } from "./golden-seam-amendment-blast-radius";
import { goldenExecutionFailed } from "./golden-execution-failed";
import { goldenPlanningFallback } from "./golden-planning-fallback";

export {
  goldenHappyPath,
  goldenPlanningQuestion,
  goldenVerifyAutoRepair,
  goldenBehavioralConflict,
  goldenSeamAmendmentBlastRadius,
  goldenExecutionFailed,
  goldenPlanningFallback
};

/** Discover fixtures by name. */
export const GOLDEN_FIXTURES = {
  "golden-happy-path": goldenHappyPath,
  "golden-planning-question": goldenPlanningQuestion,
  "golden-verify-auto-repair": goldenVerifyAutoRepair,
  "golden-behavioral-conflict": goldenBehavioralConflict,
  "golden-seam-amendment-blast-radius": goldenSeamAmendmentBlastRadius,
  "golden-execution-failed": goldenExecutionFailed,
  "golden-planning-fallback": goldenPlanningFallback
} satisfies Record<string, RunFixture>;

export type GoldenFixtureName = keyof typeof GOLDEN_FIXTURES;

export const GOLDEN_FIXTURE_NAMES = Object.keys(GOLDEN_FIXTURES) as GoldenFixtureName[];
