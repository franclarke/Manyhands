/**
 * Deterministic walking-skeleton scaffolder (Type Extractor) for the
 * GroundingAgent.
 *
 * Given the InterfaceContracts of an approved plan, produces syntactically
 * verified TypeScript skeleton files WITHOUT an LLM whenever the contract is
 * mechanically scaffoldable:
 *  - the contract id is a repo-relative .ts/.tsx path (where the seam lives);
 *  - the signature can be turned into a parseable export through a small set
 *    of candidate renderings (verbatim, `export`-prefixed, ambient declare,
 *    or function-with-throw body);
 *  - type names referenced by the signature that exist in the repository's
 *    export index are imported with correct relative specifiers.
 *
 * Contracts that cannot be scaffolded deterministically are returned as
 * `unresolved` so the GroundingAgent can fall back to the LLM for exactly
 * those — never for the whole skeleton (docs/design/future-frontier-tasks.md §4).
 */
import { dirname, posix } from "node:path";
import ts from "typescript";
import type { InterfaceContract } from "@manyhands/contracts";

export interface ScaffoldedFile {
  /** Repo-relative POSIX path. */
  path: string;
  content: string;
}

export interface ScaffoldOutcome {
  files: ScaffoldedFile[];
  unresolved: InterfaceContract[];
}

export interface ScaffoldParams {
  contracts: readonly InterfaceContract[];
  /**
   * Exported symbol name → repo-relative file path, used to emit type imports
   * for signature references that already exist in the repository.
   */
  repoExports?: ReadonlyMap<string, string>;
}

export function scaffoldInterfaces(params: ScaffoldParams): ScaffoldOutcome {
  const repoExports = params.repoExports ?? new Map<string, string>();
  const unresolved: InterfaceContract[] = [];
  const byFile = new Map<string, { declarations: string[]; imports: Map<string, Set<string>> }>();

  for (const contract of params.contracts) {
    const filePath = scaffoldTargetPath(contract);
    const declaration = filePath !== undefined ? renderDeclaration(contract) : undefined;
    if (filePath === undefined || declaration === undefined) {
      unresolved.push(contract);
      continue;
    }

    const bucket = byFile.get(filePath) ?? { declarations: [], imports: new Map<string, Set<string>>() };
    bucket.declarations.push(declaration);

    for (const name of referencedTypeNames(declaration)) {
      const exporterPath = repoExports.get(name);
      if (exporterPath === undefined || normalizePath(exporterPath) === filePath) continue;
      const specifier = importSpecifier(filePath, exporterPath);
      const names = bucket.imports.get(specifier) ?? new Set<string>();
      names.add(name);
      bucket.imports.set(specifier, names);
    }

    byFile.set(filePath, bucket);
  }

  const files: ScaffoldedFile[] = [];
  for (const [path, bucket] of byFile) {
    const importLines = [...bucket.imports.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([specifier, names]) => `import type { ${[...names].sort().join(", ")} } from "${specifier}";`);
    const content = [
      "// Walking skeleton scaffolded by ManyHands GroundingAgent. Parallel leaves",
      "// build against these seams; implementations replace the stubs below.",
      ...(importLines.length > 0 ? ["", ...importLines] : []),
      "",
      bucket.declarations.join("\n\n"),
      ""
    ].join("\n");

    if (parsesClean(path, content)) {
      files.push({ path, content });
    } else {
      // The merged file failed to parse (e.g. duplicated declarations): hand
      // every contract that targeted it to the LLM fallback instead.
      unresolved.push(...params.contracts.filter((contract) => scaffoldTargetPath(contract) === path));
    }
  }

  return { files, unresolved };
}

/** Repo-relative target path when the contract id is a TS file path. */
export function scaffoldTargetPath(contract: InterfaceContract): string | undefined {
  const id = normalizePath(contract.id);
  if (!/\.(ts|tsx|mts|cts)$/i.test(id)) return undefined;
  if (id.startsWith("/") || /^[a-zA-Z]:/.test(contract.id)) return undefined; // absolute paths are not repo-relative
  if (id.includes("..")) return undefined;
  return id;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Render the contract signature as a single parseable TypeScript declaration.
 * Candidates are tried in order; the first that parses clean wins.
 */
function renderDeclaration(contract: InterfaceContract): string | undefined {
  const signature = contract.signature.trim().replace(/;$/, "");
  const stubName = signature.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/)?.[1];

  const candidates: string[] = [];

  // Function signature without a body → stub body that throws.
  if (stubName !== undefined && !signature.includes("{")) {
    const withoutExport = signature.replace(/^export\s+/, "");
    candidates.push(`export ${withoutExport} {\n  throw new Error("Not implemented: ${stubName}");\n}`);
  }

  if (signature.startsWith("export ")) {
    candidates.push(signature);
  } else {
    candidates.push(`export ${signature}`);
  }
  // Ambient declaration absorbs bodyless classes/functions.
  candidates.push(`export declare ${signature.replace(/^(export\s+)?(declare\s+)?/, "")}`);

  return candidates.find((candidate) => parsesClean(`${contract.id}.probe.ts`, candidate));
}

function parsesClean(fileName: string, content: string): boolean {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const diagnostics =
    (sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  return diagnostics.length === 0 && sourceFile.statements.length > 0;
}

/**
 * Type names referenced by the declaration that are not declared inside it —
 * the candidates for repository imports (the "type extraction" step).
 */
export function referencedTypeNames(declaration: string): Set<string> {
  const sourceFile = ts.createSourceFile("probe.ts", declaration, ts.ScriptTarget.Latest, true);
  const referenced = new Set<string>();
  const declared = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      referenced.add(node.typeName.text);
    }
    if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
      referenced.add(node.expression.text); // extends / implements clauses
    }
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name !== undefined
    ) {
      declared.add(node.name.text);
    }
    if (ts.isTypeParameterDeclaration(node)) {
      declared.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const name of declared) {
    referenced.delete(name);
  }
  return referenced;
}

/** Relative import specifier (POSIX, extensionless) from one repo file to another. */
function importSpecifier(fromFile: string, toFile: string): string {
  const target = normalizePath(toFile).replace(/\.(ts|tsx|mts|cts)$/i, "");
  let relative = posix.relative(dirname(normalizePath(fromFile)).replace(/\\/g, "/"), target);
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}
