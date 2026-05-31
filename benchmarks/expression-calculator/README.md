# expression-calculator — Benchmark Fixture

An arithmetic **expression evaluator**: takes a string like `2 + 3 * (4 - 1)` and
returns its numeric value. Used as a target repository for ManyHands granularity
experiments and as the showcase fixture for the recursive-decomposition design
(see `docs/design/decomposer-composer-redesign.md`).

## Why this fixture

Unlike a flat CRUD fixture, an expression calculator has a **natural pipeline
with real seams between stages**:

```
   "2 + 3 * 4"  ──▶  tokenize  ──▶  Token[]  ──▶  parse  ──▶  Ast  ──▶  evaluate  ──▶  14
                                    └─ seam ─┘              └ seam ┘
```

- The `Token[]` (tokenizer→parser) and the `Ast` (parser→evaluator) are
  **shared interfaces**. If they are agreed up front, the three stages can be
  implemented independently — in parallel — against the same contract. If they
  are not, parallel agents invent incompatible versions and integration breaks.
  This is exactly the tension the decomposer/composer redesign addresses.
- The pieces have **uneven natural depth**: the precedence parser is deep
  (primary → unary → power → term → expression), the tokenizer is shallow. The
  decomposition tree should reflect that, not force uniform levels.

## The contract is the public interface only

The fixture fixes **only** the public surface, via the integration test suite:

```ts
export type CalcResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function calculate(expression: string): CalcResult;
```

Everything else — module layout, internal types, how work is split — is **left
to the decomposer to design**. That is the point: the experiment measures
whether ManyHands' decomposer produces good internal interfaces and whether the
composer integrates the pieces into a correct whole.

## Supported language

| Feature | Examples |
|---------|----------|
| Numbers | `3`, `3.14`, `0.5` |
| Binary operators | `+` `-` `*` `/` `%` `^` (`^` is right-associative) |
| Unary minus | `-5`, `-(2 + 3)`, `3 * -2` |
| Parentheses | `(2 + 3) * 4`, nested |
| Functions | `sqrt(x)`, `abs(x)`, `min(a, b)`, `max(a, b)` |
| Whitespace | ignored between tokens |

Precedence (high → low): function call / parentheses, `^`, unary `-`, `* / %`, `+ -`.

Errors return `{ ok: false, error }` (never throw): division/modulo by zero,
unbalanced parentheses, invalid characters, unknown functions, wrong arity,
empty input, dangling operators.

## Setup

```bash
npm install
npm test     # vitest — every test fails until calculate() is implemented (by design)
```

## Structure

```
src/
  calculate.ts        — public stub: calculate(expression) => CalcResult
tests/
  calculate.test.ts   — integration suite (the immutable external contract)
```

The agent's job: implement `calculate` (designing whatever internal modules it
needs) so the integration suite passes.
