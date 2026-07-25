import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { uniqueValues } from "@manyhands/shared";
import ts from "typescript";

import type {
  RepositoryDiagnostic,
  RepositoryExportIndex,
  RepositoryFileIndex,
  RepositoryFileKind,
  RepositoryImportIndex,
  RepositorySymbolIndex,
  RepositorySymbolKind
} from "./index.js";

export interface ParsedRepositoryFile {
  file: RepositoryFileIndex;
  symbols: RepositorySymbolIndex[];
  imports: RepositoryImportIndex[];
  exports: RepositoryExportIndex[];
  diagnostics: RepositoryDiagnostic[];
}

export async function parseRepositoryFile(
  rootPath: string,
  absolutePath: string
): Promise<ParsedRepositoryFile> {
  const relativePath = normalizePath(path.relative(rootPath, absolutePath));
  return parseRepositorySourceText(relativePath, await readFile(absolutePath, "utf8"));
}

export function parseRepositorySourceText(
  relativePath: string,
  sourceText: string
): ParsedRepositoryFile {
  const normalizedPath = normalizePath(relativePath);
  const extension = path.extname(normalizedPath).toLowerCase();
  const kind = classifyFileKind(normalizedPath);
  const contentHash = createHash("sha256").update(sourceText).digest("hex");
  const emptyFile: RepositoryFileIndex = {
    path: normalizedPath,
    kind,
    contentHash,
    byteSize: Buffer.byteLength(sourceText, "utf8"),
    lineCount: physicalLineCount(sourceText),
    exportedSymbols: [],
    importedSymbols: [],
    declaredSymbols: []
  };

  if (extension === ".json") {
    return {
      file: emptyFile,
      symbols: [],
      imports: [],
      exports: [],
      diagnostics: []
    };
  }

  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    extension === ".tsx" || extension === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const symbols: RepositorySymbolIndex[] = [];
  const imports: RepositoryImportIndex[] = [];
  const exports: RepositoryExportIndex[] = [];
  const importedSymbols: string[] = [];
  const exportedSymbols: string[] = [];
  const declaredSymbols: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const imported = importedSymbolsFromImport(statement);
      const moduleSpecifier = stringLiteralText(statement.moduleSpecifier);
      if (moduleSpecifier !== undefined) {
        imports.push({ filePath: normalizedPath, moduleSpecifier, importedSymbols: imported });
      }
      importedSymbols.push(...imported);
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const exported = exportedSymbolsFromExportDeclaration(statement);
      const moduleSpecifier = statement.moduleSpecifier
        ? stringLiteralText(statement.moduleSpecifier)
        : undefined;
      exports.push({
        filePath: normalizedPath,
        exportedSymbols: exported,
        ...(moduleSpecifier !== undefined ? { moduleSpecifier } : {})
      });
      exportedSymbols.push(...exported);
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      exportedSymbols.push("default");
      exports.push({ filePath: normalizedPath, exportedSymbols: ["default"] });
      continue;
    }

    collectDeclaration(
      statement,
      sourceFile,
      normalizedPath,
      symbols,
      declaredSymbols,
      exportedSymbols,
      exports
    );
  }

  return {
    file: {
      ...emptyFile,
      exportedSymbols: uniqueValues(exportedSymbols).sort(),
      importedSymbols: uniqueValues(importedSymbols).sort(),
      declaredSymbols: uniqueValues(declaredSymbols).sort()
    },
    symbols: symbols.sort((left, right) =>
      compareByPathThenName(left.filePath, left.name, right.filePath, right.name)
    ),
    imports,
    exports,
    diagnostics: []
  };
}

/**
 * Fast path for the exports-only profile. Common top-level declarations avoid
 * constructing a full AST; any ambiguous syntax falls back to the canonical
 * AST parser above.
 */
export function parseExportedRepositorySourceText(
  relativePath: string,
  sourceText: string
): ParsedRepositoryFile {
  const exportStatements = sourceText.match(/^[ \t]*export\b/gmu)?.length ?? 0;
  const exportTokens = sourceText.match(/\bexport\b/gu)?.length ?? 0;
  const ambiguous =
    sourceText.includes("/*") ||
    sourceText.includes("`") ||
    exportTokens !== exportStatements ||
    /\bexport\s+(?:default|\{|\*)/u.test(sourceText) ||
    /^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:const|let|var)\b[^;]*,/mu.test(sourceText);
  if (ambiguous) return exportsOnly(parseRepositorySourceText(relativePath, sourceText));

  const declarationPattern =
    /^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:abstract[ \t]+)?(?:async[ \t]+)?(class|const|enum|function|interface|let|namespace|type|var)[ \t]+([A-Za-z_$][\w$]*)/gmu;
  const matches = [...sourceText.matchAll(declarationPattern)];
  if (matches.length !== exportStatements) {
    return exportsOnly(parseRepositorySourceText(relativePath, sourceText));
  }

  const normalizedPath = normalizePath(relativePath);
  const exportedSymbols = matches.map((match) => match[2]!).sort();
  const symbols: RepositorySymbolIndex[] = matches.map((match) => {
    const name = match[2]!;
    const token = match[1]!;
    return {
      name,
      kind: fastSymbolKind(token, name, normalizedPath),
      filePath: normalizedPath,
      exported: true,
      line: lineAt(sourceText, match.index ?? 0)
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return {
    file: {
      path: normalizedPath,
      kind: classifyFileKind(normalizedPath),
      contentHash: createHash("sha256").update(sourceText).digest("hex"),
      byteSize: Buffer.byteLength(sourceText, "utf8"),
      lineCount: physicalLineCount(sourceText),
      exportedSymbols,
      importedSymbols: [],
      declaredSymbols: [...exportedSymbols]
    },
    symbols,
    imports: [],
    exports: symbols.map((symbol) => ({
      filePath: normalizedPath,
      exportedSymbols: [symbol.name]
    })),
    diagnostics: []
  };
}

function physicalLineCount(sourceText: string): number {
  if (sourceText.length === 0) return 0;
  return sourceText.split(/\r\n|\n|\r/u).length;
}

function exportsOnly(parsed: ParsedRepositoryFile): ParsedRepositoryFile {
  const symbols = parsed.symbols.filter((symbol) => symbol.exported);
  return {
    ...parsed,
    file: {
      ...parsed.file,
      importedSymbols: [],
      declaredSymbols: [...parsed.file.exportedSymbols]
    },
    symbols,
    imports: []
  };
}

function fastSymbolKind(
  token: string,
  name: string,
  filePath: string
): RepositorySymbolKind {
  if (token === "function") return symbolKindForFunction(name, filePath);
  if (token === "class") return "class";
  if (token === "interface") return "interface";
  if (token === "type") return "type";
  if (token === "const" || token === "let" || token === "var") {
    return variableSymbolKind(name, filePath);
  }
  return "unknown";
}

function lineAt(sourceText: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (sourceText.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function collectDeclaration(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  filePath: string,
  symbols: RepositorySymbolIndex[],
  declaredSymbols: string[],
  exportedSymbols: string[],
  exports: RepositoryExportIndex[]
): void {
  if (ts.isFunctionDeclaration(statement)) {
    collectNamedOrDefaultDeclaration(
      statement.name?.text,
      statement.name === undefined ? "function" : symbolKindForFunction(statement.name.text, filePath),
      statement,
      sourceFile,
      filePath,
      symbols,
      declaredSymbols,
      exportedSymbols,
      exports
    );
    return;
  }

  if (ts.isClassDeclaration(statement)) {
    collectNamedOrDefaultDeclaration(
      statement.name?.text,
      "class",
      statement,
      sourceFile,
      filePath,
      symbols,
      declaredSymbols,
      exportedSymbols,
      exports
    );
    return;
  }

  if (ts.isInterfaceDeclaration(statement)) {
    collectSymbol(statement.name.text, "interface", hasExportModifier(statement), statement, sourceFile, filePath, symbols, declaredSymbols, exportedSymbols, exports);
    return;
  }

  if (ts.isTypeAliasDeclaration(statement)) {
    collectSymbol(statement.name.text, "type", hasExportModifier(statement), statement, sourceFile, filePath, symbols, declaredSymbols, exportedSymbols, exports);
    return;
  }

  if (ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
    collectSymbol(statement.name.getText(sourceFile), "unknown", hasExportModifier(statement), statement, sourceFile, filePath, symbols, declaredSymbols, exportedSymbols, exports);
    return;
  }

  if (ts.isVariableStatement(statement)) {
    const exported = hasExportModifier(statement);
    for (const declaration of statement.declarationList.declarations) {
      for (const name of bindingNames(declaration.name)) {
        collectSymbol(
          name,
          variableSymbolKind(name, filePath),
          exported,
          declaration,
          sourceFile,
          filePath,
          symbols,
          declaredSymbols,
          exportedSymbols,
          exports
        );
      }
    }
  }
}

function collectNamedOrDefaultDeclaration(
  declaredName: string | undefined,
  kind: RepositorySymbolKind,
  node: ts.DeclarationStatement,
  sourceFile: ts.SourceFile,
  filePath: string,
  symbols: RepositorySymbolIndex[],
  declaredSymbols: string[],
  exportedSymbols: string[],
  exports: RepositoryExportIndex[]
): void {
  const exported = hasExportModifier(node);
  const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  const name = declaredName ?? (isDefault ? "default" : undefined);
  if (name === undefined) return;

  collectSymbol(
    name,
    kind,
    exported,
    node,
    sourceFile,
    filePath,
    symbols,
    declaredSymbols,
    exportedSymbols,
    exports
  );
}

function collectSymbol(
  name: string,
  kind: RepositorySymbolKind,
  exported: boolean,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  symbols: RepositorySymbolIndex[],
  declaredSymbols: string[],
  exportedSymbols: string[],
  exports: RepositoryExportIndex[]
): void {
  declaredSymbols.push(name);
  if (exported) {
    exportedSymbols.push(name);
    exports.push({ filePath, exportedSymbols: [name] });
  }
  symbols.push({
    name,
    kind,
    filePath,
    exported,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  });
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
  );
}

function importedSymbolsFromImport(statement: ts.ImportDeclaration): string[] {
  const importClause = statement.importClause;
  if (importClause === undefined) return [];
  const symbols: string[] = [];
  if (importClause.name) symbols.push(importClause.name.text);
  if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
    for (const element of importClause.namedBindings.elements) {
      symbols.push(element.propertyName?.text ?? element.name.text);
    }
  }
  if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
    symbols.push(importClause.namedBindings.name.text);
  }
  return uniqueValues(symbols).sort();
}

function exportedSymbolsFromExportDeclaration(statement: ts.ExportDeclaration): string[] {
  if (statement.exportClause === undefined) return [];
  if (ts.isNamespaceExport(statement.exportClause)) {
    return [statement.exportClause.name.text];
  }
  return uniqueValues(statement.exportClause.elements.map((element) => element.name.text)).sort();
}

function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function stringLiteralText(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) ? node.text : undefined;
}

function symbolKindForFunction(name: string, filePath: string): RepositorySymbolKind {
  return variableSymbolKind(name, filePath) === "component" ? "component" : "function";
}

function variableSymbolKind(name: string, filePath: string): RepositorySymbolKind {
  return (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) && /^[A-Z]/u.test(name)
    ? "component"
    : "const";
}

function classifyFileKind(filePath: string): RepositoryFileKind {
  const normalized = normalizePath(filePath);
  const baseName = path.posix.basename(normalized);
  if (
    baseName === "package.json" ||
    baseName === "tsconfig.json" ||
    baseName.includes("config") ||
    normalized.includes("eslint")
  ) {
    return "config";
  }
  if (
    normalized.endsWith("schema.ts") ||
    normalized.endsWith("schema.tsx") ||
    normalized.endsWith("schema.prisma") ||
    normalized.includes("/schema/")
  ) {
    return "schema";
  }
  if (normalized.includes("migrations/")) return "migration";
  if (
    normalized.includes("/tests/") ||
    normalized.startsWith("tests/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx")
  ) {
    return "test";
  }
  if ([".ts", ".tsx", ".js", ".jsx"].includes(path.posix.extname(normalized))) return "source";
  return "unknown";
}

function compareByPathThenName(
  leftPath: string,
  leftName: string,
  rightPath: string,
  rightName: string
): number {
  return leftPath.localeCompare(rightPath) || leftName.localeCompare(rightName);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
