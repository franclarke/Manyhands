import type { ValidationRunResult } from "../types";

const SPAWN_FAILURE_EXIT_CODE = 127;

export type DeferredValidationReason =
  | "toolchain_missing"
  | "manifest_missing"
  | "no_tests_found"
  | "missing_test_script";

// A leaf branches from the walking skeleton, which carries no package.json. A
// leaf that touches only source files (and does not itself author a manifest)
// makes any npm/pnpm/yarn validation command exit with ENOENT because it cannot
// read package.json. The manifest is composed later, so this is an infra gap at
// the leaf altitude — defer to run level, don't wedge the leaf gate. Keyed off
// the output text, not the exit code: ENOENT surfaces as a platform-specific
// errno (e.g. -4058 / 4294963238 on Windows), which is not portable.
const MANIFEST_MISSING_PATTERN =
  /could not read package\.json|ENOENT[\s\S]*package\.json|package\.json[\s\S]*ENOENT/i;

export function classifyDeferredValidation(
  validationResult: ValidationRunResult
): DeferredValidationReason | undefined {
  if (validationResult.exitCode === SPAWN_FAILURE_EXIT_CODE) {
    return "toolchain_missing";
  }

  if (validationResult.exitCode !== 0 && MANIFEST_MISSING_PATTERN.test(validationResult.output)) {
    return "manifest_missing";
  }

  if (validationResult.exitCode === 1 && /\bno test files? found\b/i.test(validationResult.output)) {
    return "no_tests_found";
  }

  if (validationResult.exitCode === 1 && /\bmissing script:\s*"test"/i.test(validationResult.output)) {
    return "missing_test_script";
  }

  return undefined;
}
