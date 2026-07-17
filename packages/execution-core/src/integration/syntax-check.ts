/**
 * Post-repair syntactic validation for the Composer (IntegrationAgent).
 *
 * After an LLM repairs a cherry-pick conflict, the repaired files must be
 * structurally sound BEFORE the orchestrator commits them:
 *  - no leftover git conflict markers in any text file;
 *  - TypeScript/JavaScript sources must parse without syntax diagnostics
 *    (full TS parser, syntax-only — no type checking, so it is fast and
 *    needs no tsconfig resolution).
 *
 * Findings feed back into the repair prompt so the executor gets the exact
 * compiler error on its next attempt (docs/system/09-composer.md).
 */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import ts from "typescript";

export interface SyntaxFinding {
  file: string;
  message: string;
}

export interface SyntaxCheckResult {
  passed: boolean;
  findings: SyntaxFinding[];
}

const PARSEABLE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const CONFLICT_OPEN = /^(<{7}|>{7})(\s|$)/m;
const CONFLICT_SEPARATOR = /^={7}(\s|$)/m;

/**
 * A lone `=======` line is a valid Markdown setext heading; only treat it as a
 * conflict marker when an open/close marker is also present in the file.
 */
function hasConflictMarkers(content: string): boolean {
  return CONFLICT_OPEN.test(content) || (CONFLICT_SEPARATOR.test(content) && /^<{7}|^>{7}/m.test(content));
}

/**
 * Validate a set of repaired files (paths relative to worktreePath).
 * Unreadable files are reported as findings — a repair that deleted a file it
 * was supposed to fix should not silently pass.
 */
export async function checkRepairedFiles(params: {
  worktreePath: string;
  files: readonly string[];
}): Promise<SyntaxCheckResult> {
  const findings: SyntaxFinding[] = [];

  for (const file of params.files) {
    let content: string;
    try {
      content = await readFile(join(params.worktreePath, file), "utf8");
    } catch {
      // A repair may legitimately delete a file (e.g. resolving a rename);
      // only flag files that still exist but are unreadable as text.
      continue;
    }

    if (hasConflictMarkers(content)) {
      findings.push({ file, message: "unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>) remain" });
      continue;
    }

    if (PARSEABLE_EXTENSIONS.has(extname(file).toLowerCase())) {
      findings.push(...parseDiagnostics(file, content));
    }
  }

  return { passed: findings.length === 0, findings };
}

function parseDiagnostics(file: string, content: string): SyntaxFinding[] {
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(file)
  );
  // parseDiagnostics is not exposed on the public SourceFile type, but it is
  // the only reliable syntax-only diagnostic source without a full Program.
  const diagnostics =
    (sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];

  return diagnostics.slice(0, 5).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const position =
      diagnostic.start !== undefined
        ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
    const location = position !== undefined ? `:${position.line + 1}:${position.character + 1}` : "";
    return { file: `${file}${location}`, message };
  });
}

function scriptKindFor(file: string): ts.ScriptKind {
  switch (extname(file).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/** Render findings as a compiler-feedback block for the repair prompt. */
export function describeSyntaxFindings(findings: readonly SyntaxFinding[]): string {
  return findings.map((finding) => `- ${finding.file}: ${finding.message}`).join("\n");
}
