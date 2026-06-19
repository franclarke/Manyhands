/**
 * Deterministic walking-skeleton scaffolder for the GroundingAgent.
 *
 * It writes mechanical, syntax-checked skeletons without an LLM when a seam can
 * be resolved from either an explicit TS path id or from the producing node's
 * expected output/scope metadata.
 */
import { dirname, posix } from "node:path";
import ts from "typescript";
import type { InterfaceContract } from "@manyhands/contracts";
import { stubThrow } from "./grounding-stub.js";

export interface ScaffoldContract extends InterfaceContract {
  /** Repo-relative file hints from the producing node's expected output/scope. */
  targetPathHints?: readonly string[];
  /** Node ids that produced this contract, retained for diagnostics after dedupe. */
  sourceNodeIds?: readonly string[];
}

export interface ScaffoldedFile {
  /** Repo-relative POSIX path. */
  path: string;
  content: string;
}

export interface ScaffoldOutcome {
  files: ScaffoldedFile[];
  unresolved: ScaffoldContract[];
}

export interface ScaffoldParams {
  contracts: readonly ScaffoldContract[];
  /**
   * Exported symbol name -> repo-relative file path, used to emit type imports
   * for signature references that already exist in the repository.
   */
  repoExports?: ReadonlyMap<string, string>;
}

export function scaffoldInterfaces(params: ScaffoldParams): ScaffoldOutcome {
  const contracts = dedupeScaffoldContracts(params.contracts);
  const repoExports = params.repoExports ?? new Map<string, string>();
  const unresolved: ScaffoldContract[] = [];
  const staticFiles = new Map<string, string>();
  const htmlSelectors = new Map<string, Set<string>>();
  const byFile = new Map<string, { declarations: string[]; imports: Map<string, Set<string>> }>();

  for (const contract of contracts) {
    const selectors = domSelectors(contract.signature);
    if (selectors.length > 0) {
      const htmlPath = bestTargetPath(contract, /\.html$/i) ?? "public/index.html";
      const bucket = htmlSelectors.get(htmlPath) ?? new Set<string>();
      for (const selector of selectors) {
        bucket.add(selector);
      }
      htmlSelectors.set(htmlPath, bucket);
      continue;
    }

    const specialFiles = renderStaticFiles(contract);
    if (specialFiles !== undefined) {
      for (const file of specialFiles) {
        staticFiles.set(file.path, file.content);
      }
      continue;
    }

    const declaration = renderDeclaration(contract);
    const filePath = declaration !== undefined ? scaffoldTargetPath(contract, declaration) : undefined;
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

  const files: ScaffoldedFile[] = [
    ...[...staticFiles.entries()].map(([path, content]) => ({ path, content })),
    ...[...htmlSelectors.entries()].map(([path, selectors]) => ({
      path,
      content: renderDomSkeleton([...selectors].sort())
    }))
  ];
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
      unresolved.push(
        ...contracts.filter((contract) => scaffoldTargetPath(contract, renderDeclaration(contract) ?? "") === path)
      );
    }
  }

  return { files, unresolved };
}

export function dedupeScaffoldContracts(contracts: readonly ScaffoldContract[]): ScaffoldContract[] {
  const byIdentity = new Map<string, ScaffoldContract>();

  for (const contract of contracts) {
    const key = [
      normalizePath(contract.id),
      contract.kind,
      contract.signature.replace(/\s+/g, " ").trim()
    ].join("\u0000");
    const existing = byIdentity.get(key);
    if (existing === undefined) {
      byIdentity.set(key, {
        ...contract,
        targetPathHints: uniquePaths(contract.targetPathHints ?? []),
        sourceNodeIds: [...(contract.sourceNodeIds ?? [])]
      });
      continue;
    }

    byIdentity.set(key, {
      ...existing,
      targetPathHints: uniquePaths([...(existing.targetPathHints ?? []), ...(contract.targetPathHints ?? [])]),
      sourceNodeIds: uniqueStrings([...(existing.sourceNodeIds ?? []), ...(contract.sourceNodeIds ?? [])])
    });
  }

  return [...byIdentity.values()];
}

/** Repo-relative target path when the id is a TS path or metadata gives one. */
export function scaffoldTargetPath(contract: ScaffoldContract, declaration = ""): string | undefined {
  const id = normalizePath(contract.id);
  if (isSafeRepoRelativePath(id) && /\.(ts|tsx|mts|cts)$/i.test(id)) return id;
  if (declaration.length === 0) return undefined;
  return bestTargetPath(contract, /\.(ts|tsx|mts|cts)$/i);
}

function renderStaticFiles(contract: ScaffoldContract): ScaffoldedFile[] | undefined {
  if (contract.id === "NotesFrontendApp") {
    const jsPath = bestTargetPath(contract, /\.(js|mjs)$/i);
    if (jsPath !== undefined) {
      return [{ path: jsPath, content: renderBrowserEntrypointStub() }];
    }
  }

  return undefined;
}

function domSelectors(signature: string): string[] {
  return [...signature.matchAll(/Selector:\s*['"](#[-A-Za-z0-9_:.]+)['"]/g)]
    .map((match) => match[1])
    .filter((selector): selector is string => selector !== undefined);
}

function renderDomSkeleton(selectors: readonly string[]): string {
  const ids = new Set(selectors.map((selector) => selector.replace(/^#/, "")));
  const element = (id: string, html: string): string => (ids.has(id) ? html : "");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    "    <title>Notes</title>",
    '    <link rel="stylesheet" href="/styles.css">',
    "  </head>",
    "  <body>",
    '    <main id="app">',
    element(
      "note-form",
      [
        '      <form id="note-form">',
        element("note-title", '        <input id="note-title" name="title" type="text" required>'),
        element("note-content", '        <textarea id="note-content" name="content" required></textarea>'),
        "        <button type=\"submit\">Save</button>",
        "      </form>"
      ].filter(Boolean).join("\n")
    ),
    element("note-search", '      <input id="note-search" type="search" placeholder="Search notes">'),
    element("cancel-edit", '      <button id="cancel-edit" type="button" hidden>Cancel</button>'),
    element("notes-list", '      <ul id="notes-list"></ul>'),
    element("empty-state", '      <p id="empty-state">No notes yet.</p>'),
    element("status-message", '      <p id="status-message" role="status" aria-live="polite"></p>'),
    "    </main>",
    '    <script type="module" src="/app.js"></script>',
    "  </body>",
    "</html>",
    ""
  ].filter(Boolean).join("\n");
}

function renderBrowserEntrypointStub(): string {
  return [
    "// Walking skeleton scaffolded by ManyHands GroundingAgent.",
    "export function startNotesApp(_options = {}) {",
    "  // Implementation is supplied by the frontend leaf task.",
    "}",
    "",
    'if (typeof document !== "undefined") {',
    "  startNotesApp();",
    "}",
    ""
  ].join("\n");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniquePaths(paths: readonly string[]): string[] {
  return uniqueStrings(paths.map(normalizePath).filter(isSafeRepoRelativePath));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").some((segment) => segment === "..");
}

function bestTargetPath(contract: ScaffoldContract, extensionPattern: RegExp): string | undefined {
  const candidates = (contract.targetPathHints ?? [])
    .map(normalizePath)
    .filter((path) => isSafeRepoRelativePath(path) && extensionPattern.test(path) && !path.includes("*"));
  if (candidates.length === 0) return undefined;

  const normalizedId = normalizeIdentifier(contract.id);
  return [...candidates].sort((left, right) => scoreTarget(right, normalizedId) - scoreTarget(left, normalizedId))[0];
}

function scoreTarget(path: string, normalizedId: string): number {
  const base = normalizeIdentifier(path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""));
  let score = 0;
  if (base.length > 0 && (base.includes(normalizedId) || normalizedId.includes(base))) score += 100;
  if (!/(^|[./_-])(test|spec)([./_-]|$)/i.test(path)) score += 50;
  if (path.startsWith("src/")) score += 20;
  return score;
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function renderDeclaration(contract: InterfaceContract): string | undefined {
  const signature = contract.signature.trim();
  const declarations = extractDeclarationBlocks(signature)
    .map(renderDeclarationBlock)
    .filter((entry): entry is string => entry !== undefined);
  if (declarations.length > 0) {
    const rendered = declarations.join("\n\n");
    return parsesClean(`${contract.id}.probe.ts`, rendered) ? rendered : undefined;
  }

  return renderDeclarationBlock(signature);
}

function extractDeclarationBlocks(signature: string): string[] {
  const blocks: string[] = [];
  const startPattern = /^\s*(?:(?:export|declare)\s+)*(?:type|interface|function|const|class|enum)\s+/;
  let current: string[] = [];

  for (const line of signature.split(/\r?\n/)) {
    if (startPattern.test(line) && current.length > 0) {
      blocks.push(current.join("\n").trim());
      current = [];
    }
    if (startPattern.test(line) || current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    blocks.push(current.join("\n").trim());
  }
  return blocks;
}

function renderDeclarationBlock(block: string): string | undefined {
  const signature = block.trim().replace(/;$/, "");
  const functionName = signature.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/)?.[1];
  const constMatch = signature.match(/^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*:\s*([\s\S]+)$/);

  if (signature.startsWith("export ")) {
    if (functionName !== undefined && !hasFunctionBody(signature)) {
      const withoutExport = signature.replace(/^export\s+/, "");
      return parseableOrUndefined(`export ${withoutExport} {\n  ${stubThrow(functionName)}\n}`);
    }
    if (constMatch !== null && !signature.includes("=")) {
      return parseableOrUndefined(`export const ${constMatch[1]} = undefined as unknown as ${constMatch[2]};`);
    }
    return parseableOrUndefined(signature);
  }

  if (functionName !== undefined && !hasFunctionBody(signature)) {
    return parseableOrUndefined(`export ${signature} {\n  ${stubThrow(functionName)}\n}`);
  }
  if (constMatch !== null && !signature.includes("=")) {
    return parseableOrUndefined(`export const ${constMatch[1]} = undefined as unknown as ${constMatch[2]};`);
  }

  return parseableOrUndefined(`export ${signature}`);
}

function hasFunctionBody(signature: string): boolean {
  return /\)\s*(?::[\s\S]*?)?\s*\{[\s\S]*\}\s*$/.test(signature);
}

function parseableOrUndefined(candidate: string): string | undefined {
  return parsesClean("probe.ts", candidate) ? candidate : undefined;
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
 * Type names referenced by the declaration that are not declared inside it:
 * candidates for repository imports.
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
      referenced.add(node.expression.text);
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
