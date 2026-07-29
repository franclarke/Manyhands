import { createHash } from "node:crypto";
import ts from "typescript";

export interface TestIntegrityFinding {
  findingId: string;
  code: "test_removed" | "test_script_weakened" | "test_skipped" | "test_only" | "assertion_removed";
  path: string;
  message: string;
}

export function detectTestIntegrityFindings(input: {
  baselineTestFiles: string[];
  candidateTestFiles: string[];
  baselineScripts: Record<string, string>;
  candidateScripts: Record<string, string>;
  baselineTestContents?: Record<string, string>;
  candidateTestContents?: Record<string, string>;
}): TestIntegrityFinding[] {
  const candidateFiles = new Set(input.candidateTestFiles);
  const findings: TestIntegrityFinding[] = input.baselineTestFiles
    .filter((path) => !candidateFiles.has(path))
    .sort()
    .map((path) => finding("test_removed", path, `Baseline test ${path} is missing from the candidate.`));
  for (const [name, baseline] of Object.entries(input.baselineScripts).sort(([left], [right]) => left.localeCompare(right))) {
    const candidate = input.candidateScripts[name];
    if (candidate === undefined || isWeaker(candidate, baseline)) {
      const path = `package.json#scripts.${name}`;
      findings.push(finding("test_script_weakened", path, `Candidate script ${name} is missing or weaker than the baseline.`));
    }
  }
  for (const path of [...candidateFiles].sort()) {
    const baseline = input.baselineTestContents?.[path];
    const candidate = input.candidateTestContents?.[path];
    if (candidate === undefined || baseline === candidate) continue;
    const before = baseline === undefined ? { skipped: 0, only: 0, assertions: 0 } : testStrength(baseline, path);
    const after = testStrength(candidate, path);
    if (after.skipped > before.skipped) {
      findings.push(finding("test_skipped", path, `Candidate introduces ${after.skipped - before.skipped} skipped or todo test declaration(s).`));
    }
    if (after.only > before.only) {
      findings.push(finding("test_only", path, `Candidate introduces ${after.only - before.only} focused test declaration(s).`));
    }
    if (baseline !== undefined && after.assertions < before.assertions) {
      findings.push(finding("assertion_removed", path, `Candidate reduces assertion sites from ${before.assertions} to ${after.assertions}.`));
    }
  }
  return findings;
}

function isWeaker(candidate: string, baseline: string): boolean {
  if (candidate.trim() === baseline.trim()) return false;
  return /--passWithNoTests|--allowNoTests|\|\|\s*(?:true|exit\s+0)/u.test(candidate);
}

function finding(code: TestIntegrityFinding["code"], path: string, message: string): TestIntegrityFinding {
  const digest = createHash("sha256").update(`${code}\0${path}\0${message}`).digest("hex").slice(0, 16);
  return { findingId: `test-integrity:${code}:${digest}`, code, path, message };
}

function testStrength(source: string, path: string): { skipped: number; only: number; assertions: number } {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const result = { skipped: 0, only: 0, assertions: 0 };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const modifier = node.expression.name.text;
        const root = callRootIdentifier(node.expression.expression);
        if ((modifier === "skip" || modifier === "todo") && isTestDeclarationRoot(root)) result.skipped += 1;
        if (modifier === "only" && isTestDeclarationRoot(root)) result.only += 1;
        if (isExpectMatcher(node.expression) || root === "assert") result.assertions += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function callRootIdentifier(node: ts.Expression): string | undefined {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  if (ts.isCallExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

function isTestDeclarationRoot(value: string | undefined): boolean {
  return value === "it" || value === "test" || value === "describe";
}

function isExpectMatcher(expression: ts.PropertyAccessExpression): boolean {
  let current: ts.Expression = expression.expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "expect";
}

function scriptKind(path: string): ts.ScriptKind {
  return path.endsWith(".tsx") || path.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function isTestFilePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("tests/") || normalized.includes("/tests/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized);
}
