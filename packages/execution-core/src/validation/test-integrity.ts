import { createHash } from "node:crypto";
import ts from "typescript";

export const TEST_INTEGRITY_DETECTOR_VERSION = 4 as const;

export interface TestIntegrityFinding {
  findingId: string;
  code: "test_removed" | "test_script_weakened" | "test_configuration_changed" | "test_skipped" | "test_only" | "assertion_removed" | "required_public_surface_unchanged" | "required_public_surface_unrepresented";
  path: string;
  message: string;
}

/**
 * A task that promises a new observable public API cannot be discharged by a
 * test-only commit when its declared scope contains an API implementation.
 * The test may prove a pre-existing, incidental read path while leaving the
 * promised boundary unchanged.
 */
export function detectRequiredPublicSurfaceFindings(input: {
  goal: string;
  acceptanceCriteria: readonly { description: string }[];
  allowedPaths: readonly string[];
  changedFiles: readonly string[];
  candidatePublicSourceContents?: Readonly<Record<string, string>>;
}): TestIntegrityFinding[] {
  const promise = [input.goal, ...input.acceptanceCriteria.map((criterion) => criterion.description)].join(" ");
  if (!/\b(?:api|endpoint|route|public interface)\b/iu.test(promise) || !/\b(?:expose|observable|observe|read|list|retrieve|access)\b/iu.test(promise)) return [];
  const publicSources = input.allowedPaths
    .filter((file) => !isTestFilePath(file))
    .filter((file) => /(?:^|\/)(?:api|routes?|controllers?)(?:\/|$)/iu.test(file));
  if (publicSources.length === 0) return [];
  const changed = new Set(input.changedFiles.map((file) => file.replaceAll("\\", "/")));
  const changedSources = publicSources.filter((file) => changed.has(file.replaceAll("\\", "/")));
  if (changedSources.length > 0) {
    const requestedStateTerms = [...new Set([...promise.matchAll(/\bbackorders?\b/giu)].map((match) => match[0].toLowerCase()))];
    const sourceContents = input.candidatePublicSourceContents ?? {};
    if (requestedStateTerms.length > 0 && changedSources.every((file) => {
      const source = sourceContents[file.replaceAll("\\", "/")];
      return source === undefined || requestedStateTerms.every((term) => !source.toLowerCase().includes(term));
    })) {
      const path = changedSources.sort()[0]!;
      return [finding(
        "required_public_surface_unrepresented",
        path,
        `Task requires observable ${requestedStateTerms.join(", ")}, but the changed API source does not represent that requested state.`
      )];
    }
    return [];
  }
  const path = publicSources.sort()[0]!;
  return [finding(
    "required_public_surface_unchanged",
    path,
    `Task promises a new observable public API surface, but candidate changes no declared API implementation.`
  )];
}

export function detectTestIntegrityFindings(input: {
  baselineTestFiles: string[];
  candidateTestFiles: string[];
  baselineScripts: Record<string, string>;
  candidateScripts: Record<string, string>;
  baselineTestContents?: Record<string, string>;
  candidateTestContents?: Record<string, string>;
  changedTestConfigurationPaths?: string[];
}): TestIntegrityFinding[] {
  const candidateFiles = new Set(input.candidateTestFiles);
  const findings: TestIntegrityFinding[] = input.baselineTestFiles
    .filter((path) => !candidateFiles.has(path))
    .sort()
    .map((path) => finding("test_removed", path, `Baseline test ${path} is missing from the candidate.`));
  for (const path of [...(input.changedTestConfigurationPaths ?? [])].sort()) {
    findings.push(finding("test_configuration_changed", path, `Candidate changes test discovery configuration ${path}; prior coverage equivalence is no longer established.`));
  }
  for (const [name, baseline] of Object.entries(input.baselineScripts).sort(([left], [right]) => left.localeCompare(right))) {
    const candidate = input.candidateScripts[name];
    if (candidate === undefined || isWeaker(candidate, baseline)) {
      const path = name.includes("#scripts.") ? name : `package.json#scripts.${name}`;
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
  const normalizedCandidate = candidate.trim();
  const normalizedBaseline = baseline.trim();
  return normalizedCandidate !== normalizedBaseline
    && !isAdditiveNodeTestDiscovery(normalizedCandidate, normalizedBaseline);
}

/**
 * The baseline command remains intact and the added arguments are only test
 * paths. This is the one script change whose coverage relation is observable
 * without trying to interpret arbitrary shell syntax.
 */
function isAdditiveNodeTestDiscovery(candidate: string, baseline: string): boolean {
  if (!baseline.startsWith("node --test ") || !candidate.startsWith(`${baseline} `)) return false;
  const addedPaths = candidate.slice(baseline.length).trim().split(/\s+/u);
  return addedPaths.length > 0 && addedPaths.every((path) =>
    path.length > 0 && !path.startsWith("-") && !/[;&|`$<>()]/u.test(path)
  );
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
      if (ts.isIdentifier(node.expression) && node.expression.text === "assert") result.assertions += 1;
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

export function isTestDiscoveryConfigurationPath(filePath: string): boolean {
  const base = filePath.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  return /^(?:vitest|vite|jest|playwright|cypress|karma|ava)\.(?:config|workspace)\./u.test(base)
    || /^(?:\.mocharc(?:\.(?:js|cjs|mjs|json|ya?ml))?|pytest\.ini|pyproject\.toml)$/u.test(base)
    || /(?:^|[._-])test(?:s)?[._-]config/u.test(base);
}
