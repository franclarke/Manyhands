import { createHash } from "node:crypto";
import type { ScopeContract } from "@manyhands/contracts";

export type InputFingerprint = `sha256:${string}`;

export interface RepositoryContextFile {
  path: string;
  content: string;
}

export interface ContextCompressionInput {
  scope: ScopeContract;
  files: readonly RepositoryContextFile[];
  inputs: unknown;
}

export interface CompressedContext {
  scopeNodeId: string;
  files: RepositoryContextFile[];
  treeSummary: string[];
  interfaceSignatures: string;
  inputFingerprint: InputFingerprint;
}

export function compressContext(input: ContextCompressionInput): CompressedContext {
  const files = input.files
    .map((file) => ({ path: normalizeRepositoryPath(file.path), content: file.content }))
    .filter((file) => isAllowedByScope(file.path, input.scope))
    .sort((left, right) => left.path.localeCompare(right.path));
  const treeSummary = summarizeTreeByScope(files);
  const signaturesByFile = files
    .map((file) => {
      const signatures = extractInterfaceSignatures(file.content);
      return signatures.length === 0 ? "" : `// ${file.path}\n${signatures}`;
    })
    .filter((value) => value.length > 0);
  const fingerprintSource = {
    scope: {
      id: input.scope.id,
      revision: input.scope.revision,
      nodeId: input.scope.nodeId,
      allowedPaths: [...input.scope.allowedPaths].sort(),
      forbiddenPaths: [...input.scope.forbiddenPaths].sort()
    },
    files,
    inputs: input.inputs
  };

  return {
    scopeNodeId: input.scope.nodeId,
    files,
    treeSummary,
    interfaceSignatures: signaturesByFile.join("\n\n"),
    inputFingerprint: computeInputFingerprint(fingerprintSource)
  };
}

export function summarizeTreeByScope(files: readonly RepositoryContextFile[]): string[] {
  return [...new Set(files.map((file) => normalizeRepositoryPath(file.path)))].sort();
}

export function extractInterfaceSignatures(source: string): string {
  const searchable = maskCommentsAndStrings(source);
  const declarationPattern = /\bexport\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(interface|type|function)\s+[A-Za-z_$][\w$]*/g;
  const declarations: string[] = [];
  for (const match of searchable.matchAll(declarationPattern)) {
    const kind = match[1];
    const start = match.index;
    if (start === undefined || kind === undefined) continue;
    const declaration = extractDeclaration(source, searchable, start, kind);
    if (declaration !== undefined) declarations.push(normalizeDeclaration(declaration, kind));
  }
  return declarations.join("\n");
}

export function computeInputFingerprint(value: unknown): InputFingerprint {
  const digest = createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
  return `sha256:${digest}`;
}

function extractDeclaration(
  source: string,
  searchable: string,
  start: number,
  kind: string
): string | undefined {
  if (kind === "interface") {
    const open = searchable.indexOf("{", start);
    if (open === -1) return undefined;
    const close = matchingDelimiter(searchable, open, "{", "}");
    return close === -1 ? undefined : source.slice(start, close + 1);
  }
  if (kind === "type") {
    const end = findTopLevelSemicolon(searchable, start);
    return end === -1 ? undefined : source.slice(start, end + 1);
  }

  const openParameters = searchable.indexOf("(", start);
  if (openParameters === -1) return undefined;
  const closeParameters = matchingDelimiter(searchable, openParameters, "(", ")");
  if (closeParameters === -1) return undefined;
  const terminator = findFunctionTerminator(searchable, closeParameters + 1);
  if (terminator === -1) return undefined;
  return source.slice(start, terminator);
}

function findFunctionTerminator(source: string, start: number): number {
  let returnTypeBraceDepth = 0;
  let returnTypeColon = -1;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === ":" && returnTypeBraceDepth === 0 && returnTypeColon === -1) returnTypeColon = index;
    if (character === ";" && returnTypeBraceDepth === 0) return index + 1;
    if (character === "{") {
      const opensObjectReturnType =
        returnTypeBraceDepth > 0 ||
        returnTypeColon !== -1 && source.slice(returnTypeColon + 1, index).trim().length === 0;
      if (!opensObjectReturnType) return index;
      returnTypeBraceDepth += 1;
    } else if (character === "}" && returnTypeBraceDepth > 0) {
      returnTypeBraceDepth -= 1;
    }
  }
  return -1;
}

function findTopLevelSemicolon(source: string, start: number): number {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let angles = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "<") angles += 1;
    else if (character === ">") angles = Math.max(0, angles - 1);
    else if (character === ";" && braces === 0 && brackets === 0 && parentheses === 0 && angles === 0) return index;
  }
  return -1;
}

function matchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    else if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeDeclaration(declaration: string, kind: string): string {
  const compact = declaration.replace(/\s+/g, " ").trim();
  if (kind !== "function") return compact;
  return `${compact.replace(/[;{]\s*$/, "").trim()};`;
}

function maskCommentsAndStrings(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    (match) => match.replace(/[^\r\n]/g, " ")
  );
}

function isAllowedByScope(path: string, scope: ScopeContract): boolean {
  return scope.allowedPaths.some((pattern: string) => globMatches(path, pattern)) &&
    !scope.forbiddenPaths.some((pattern: string) => globMatches(path, pattern));
}

function globMatches(path: string, rawPattern: string): boolean {
  const pattern = normalizeRepositoryPath(rawPattern);
  const expression = pattern
    .split("**")
    .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(path) ||
    (!pattern.includes("*") && (path === pattern || path.startsWith(`${pattern.replace(/\/$/, "")}/`)));
}

function normalizeRepositoryPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Repository context path escapes scope: ${path}`);
  }
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}
