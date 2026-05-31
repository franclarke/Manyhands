import { describe, it, expect } from "vitest";
import { calculate } from "../src/calculate.js";

/**
 * Integration suite — the immutable external contract of the calculator.
 *
 * It depends ONLY on the public `calculate(expression): CalcResult`. It does not
 * know or care how the implementation is split internally. This is what makes
 * the fixture a good probe for ManyHands: the decomposer is free to design the
 * internal architecture (tokenizer / parser / evaluator / …) and the seams
 * between those pieces; this suite measures whether the integrated result is
 * correct, regardless of that internal shape.
 *
 * Helpers below keep the assertions terse. `val()` asserts success and returns
 * the numeric value; `err()` asserts a failure result.
 */
function val(expression: string): number {
  const result = calculate(expression);
  if (!result.ok) {
    throw new Error(`expected success for "${expression}" but got error: ${result.error}`);
  }
  return result.value;
}

function isErr(expression: string): boolean {
  return calculate(expression).ok === false;
}

describe("basic arithmetic", () => {
  it("adds", () => expect(val("2 + 3")).toBe(5));
  it("subtracts", () => expect(val("10 - 4")).toBe(6));
  it("multiplies", () => expect(val("6 * 7")).toBe(42));
  it("divides", () => expect(val("20 / 4")).toBe(5));
  it("evaluates a lone number", () => expect(val("42")).toBe(42));
  it("evaluates a chain left-to-right for same precedence", () => {
    expect(val("10 - 4 - 3")).toBe(3);
    expect(val("100 / 5 / 2")).toBe(10);
  });
});

describe("operator precedence", () => {
  it("multiplication before addition", () => expect(val("2 + 3 * 4")).toBe(14));
  it("division before subtraction", () => expect(val("20 - 8 / 4")).toBe(18));
  it("mixed precedence", () => expect(val("2 + 3 * 4 - 1")).toBe(13));
});

describe("parentheses", () => {
  it("overrides precedence", () => expect(val("(2 + 3) * 4")).toBe(20));
  it("nests", () => expect(val("((1 + 2) * (3 + 4))")).toBe(21));
  it("deeply nests", () => expect(val("2 * (3 + (4 - 1) * 2)")).toBe(18));
});

describe("unary minus", () => {
  it("negates a number", () => expect(val("-5")).toBe(-5));
  it("negates a parenthesized expression", () => expect(val("-(2 + 3)")).toBe(-5));
  it("combines with binary operators", () => expect(val("-5 + 2")).toBe(-3));
  it("applies to the right operand", () => expect(val("3 * -2")).toBe(-6));
});

describe("exponentiation", () => {
  it("raises to a power", () => expect(val("2 ^ 3")).toBe(8));
  it("is right-associative", () => expect(val("2 ^ 3 ^ 2")).toBe(512));
  it("binds tighter than multiplication", () => expect(val("2 * 3 ^ 2")).toBe(18));
  it("binds tighter than unary minus", () => expect(val("-2 ^ 2")).toBe(-4));
});

describe("modulo", () => {
  it("computes a remainder", () => expect(val("10 % 3")).toBe(1));
  it("shares precedence with multiplication", () => expect(val("2 + 10 % 3")).toBe(3));
});

describe("decimals", () => {
  it("parses a decimal literal", () => expect(val("3.14")).toBeCloseTo(3.14));
  it("adds decimals", () => expect(val("0.1 + 0.2")).toBeCloseTo(0.3));
  it("multiplies decimals", () => expect(val("1.5 * 2")).toBeCloseTo(3));
});

describe("functions", () => {
  it("sqrt", () => expect(val("sqrt(16)")).toBe(4));
  it("abs of a negative", () => expect(val("abs(-7)")).toBe(7));
  it("min of two args", () => expect(val("min(3, 8)")).toBe(3));
  it("max of two args", () => expect(val("max(3, 8)")).toBe(8));
  it("composes functions with arithmetic", () => expect(val("sqrt(9) + max(1, 2) * 2")).toBe(7));
  it("nests function calls", () => expect(val("max(min(10, 4), 3)")).toBe(4));
});

describe("whitespace", () => {
  it("ignores surrounding and internal whitespace", () => {
    expect(val("   2   +   3   ")).toBe(5);
    expect(val("2*3")).toBe(6);
  });
});

describe("error handling (returns ok:false, never throws)", () => {
  it("division by zero", () => expect(isErr("1 / 0")).toBe(true));
  it("modulo by zero", () => expect(isErr("5 % 0")).toBe(true));
  it("unbalanced opening parenthesis", () => expect(isErr("(2 + 3")).toBe(true));
  it("unbalanced closing parenthesis", () => expect(isErr("2 + 3)")).toBe(true));
  it("invalid character", () => expect(isErr("2 + $")).toBe(true));
  it("unknown function", () => expect(isErr("foo(2)")).toBe(true));
  it("wrong arity (too few args)", () => expect(isErr("min(3)")).toBe(true));
  it("wrong arity (too many args)", () => expect(isErr("sqrt(1, 2)")).toBe(true));
  it("empty input", () => expect(isErr("")).toBe(true));
  it("dangling operator", () => expect(isErr("2 +")).toBe(true));
});
