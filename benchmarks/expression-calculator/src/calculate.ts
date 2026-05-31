/**
 * Public contract of the expression calculator.
 *
 * This is the ONLY interface the integration test suite depends on. Everything
 * else — how tokenizing, parsing and evaluation are split into modules, and the
 * internal types that flow between them (tokens, AST, etc.) — is intentionally
 * left undefined. ManyHands' decomposer is expected to design that internal
 * architecture and the interfaces (the "seams") between the pieces.
 *
 * A discriminated result is used instead of throwing so that malformed input
 * and runtime errors (division by zero, unbalanced parentheses, unknown
 * functions, …) are observable, testable outcomes rather than crashes.
 */
export type CalcResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Evaluate an arithmetic expression string.
 *
 * Supported syntax:
 *   - Numbers: integers and decimals (`3`, `3.14`, `0.5`)
 *   - Binary operators: `+` `-` `*` `/` `%` and `^` (exponent, right-associative)
 *   - Unary minus: `-5`, `-(2 + 3)`
 *   - Parentheses for grouping
 *   - Functions: `sqrt(x)`, `abs(x)`, `min(a, b)`, `max(a, b)`
 *   - Arbitrary whitespace between tokens
 *
 * Precedence (highest to lowest): function call / parentheses, `^`, unary `-`,
 * `* / %`, `+ -`.
 *
 * Returns `{ ok: false, error }` (never throws) for: division/modulo by zero,
 * unbalanced parentheses, invalid characters, unknown functions, and wrong
 * function arity.
 *
 * NOT IMPLEMENTED — benchmark stub. An agent implements this so the integration
 * suite in `tests/calculate.test.ts` passes.
 */
export function calculate(_expression: string): CalcResult {
  throw new Error("calculate() is not implemented");
}
