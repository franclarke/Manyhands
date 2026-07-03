import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema, uniqueValues } from "@manyhands/shared";
import ts from "typescript";
import { z } from "zod";

export const RepositoryFileKindSchema = z.union([
  z.literal("source"),
  z.literal("test"),
  z.literal("config"),
  z.literal("schema"),
  z.literal("migration"),
  z.literal("unknown")
]);

export type RepositoryFileKind = z.infer<typeof RepositoryFileKindSchema>;

export const RepositorySymbolKindSchema = z.union([
  z.literal("function"),
  z.literal("class"),
  z.literal("interface"),
  z.literal("type"),
  z.literal("const"),
  z.literal("component"),
  z.literal("unknown")
]);

export type RepositorySymbolKind = z.infer<typeof RepositorySymbolKindSchema>;

export const RepositoryFileIndexSchema = z.object({
  path: NonEmptyStringSchema,
  kind: RepositoryFileKindSchema,
  exportedSymbols: z.array(NonEmptyStringSchema).default([]),
  importedSymbols: z.array(NonEmptyStringSchema).default([]),
  declaredSymbols: z.array(NonEmptyStringSchema).default([])
});

export type RepositoryFileIndex = z.infer<typeof RepositoryFileIndexSchema>;

export const RepositorySymbolIndexSchema = z.object({
  name: NonEmptyStringSchema,
  kind: RepositorySymbolKindSchema,
  filePath: NonEmptyStringSchema,
  exported: z.boolean(),
  line: z.number().int().positive().optional()
});

export type RepositorySymbolIndex = z.infer<typeof RepositorySymbolIndexSchema>;

export const RepositoryImportIndexSchema = z.object({
  filePath: NonEmptyStringSchema,
  moduleSpecifier: NonEmptyStringSchema,
  importedSymbols: z.array(NonEmptyStringSchema).default([])
});

export type RepositoryImportIndex = z.infer<typeof RepositoryImportIndexSchema>;

export const RepositoryExportIndexSchema = z.object({
  filePath: NonEmptyStringSchema,
  moduleSpecifier: NonEmptyStringSchema.optional(),
  exportedSymbols: z.array(NonEmptyStringSchema).default([])
});

export type RepositoryExportIndex = z.infer<typeof RepositoryExportIndexSchema>;

export const RepositoryDiagnosticSchema = z.object({
  filePath: NonEmptyStringSchema.optional(),
  message: NonEmptyStringSchema,
  severity: z.union([z.literal("info"), z.literal("warning"), z.literal("error")])
});

export type RepositoryDiagnostic = z.infer<typeof RepositoryDiagnosticSchema>;

export const RepositoryIndexMetadataSchema = z.object({
  indexer: NonEmptyStringSchema,
  deterministic: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  symbolCount: z.number().int().nonnegative(),
  importCount: z.number().int().nonnegative(),
  exportCount: z.number().int().nonnegative()
});

export type RepositoryIndexMetadata = z.infer<typeof RepositoryIndexMetadataSchema>;

export const RepositoryIndexSchema = z.object({
  repositoryId: EntityIdSchema,
  rootPath: NonEmptyStringSchema,
  indexedAt: IsoTimestampSchema,
  files: z.array(RepositoryFileIndexSchema),
  symbols: z.array(RepositorySymbolIndexSchema),
  imports: z.array(RepositoryImportIndexSchema),
  exports: z.array(RepositoryExportIndexSchema),
  diagnostics: z.array(RepositoryDiagnosticSchema).default([]),
  metadata: RepositoryIndexMetadataSchema
});

export type RepositoryIndex = z.infer<typeof RepositoryIndexSchema>;

export const RepositoryIndexSummarySchema = z.object({
  repositoryId: EntityIdSchema,
  indexedAt: IsoTimestampSchema,
  fileCount: z.number().int().nonnegative(),
  sourceFileCount: z.number().int().nonnegative(),
  testFileCount: z.number().int().nonnegative(),
  configFileCount: z.number().int().nonnegative(),
  schemaFileCount: z.number().int().nonnegative(),
  migrationFileCount: z.number().int().nonnegative(),
  symbolCount: z.number().int().nonnegative(),
  importCount: z.number().int().nonnegative(),
  exportCount: z.number().int().nonnegative(),
  indexHash: NonEmptyStringSchema
});

export type RepositoryIndexSummary = z.infer<typeof RepositoryIndexSummarySchema>;

export interface RepositoryIndexerInput {
  rootPath: string;
  repositoryId?: string;
  indexedAt?: string;
}

export interface RepositoryIndexer {
  index(input: RepositoryIndexerInput): Promise<RepositoryIndex>;
}

interface ParsedFile {
  file: RepositoryFileIndex;
  symbols: RepositorySymbolIndex[];
  imports: RepositoryImportIndex[];
  exports: RepositoryExportIndex[];
  diagnostics: RepositoryDiagnostic[];
}

const INDEXER_NAME = "typescript-repository-indexer-v0";
const DEFAULT_INDEXED_AT = "1970-01-01T00:00:00.000Z";
const INDEXABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".manyhands",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);

export class TypeScriptRepositoryIndexer implements RepositoryIndexer {
  async index(input: RepositoryIndexerInput): Promise<RepositoryIndex> {
    const rootPath = path.resolve(input.rootPath);
    const repositoryId = input.repositoryId ?? path.basename(rootPath).replace(/[^A-Za-z0-9._:-]/gu, "-");
    const indexedAt = input.indexedAt ?? DEFAULT_INDEXED_AT;
    const filePaths = await listIndexableFiles(rootPath);
    const parsedFiles = await Promise.all(filePaths.map((filePath) => parseFile(rootPath, filePath)));
    const files = parsedFiles.map((item) => item.file).sort((left, right) => left.path.localeCompare(right.path));
    const symbols = parsedFiles
      .flatMap((item) => item.symbols)
      .sort((left, right) => compareByPathThenName(left.filePath, left.name, right.filePath, right.name));
    const imports = parsedFiles
      .flatMap((item) => item.imports)
      .sort((left, right) => compareByPathThenName(left.filePath, left.moduleSpecifier, right.filePath, right.moduleSpecifier));
    const exports = parsedFiles
      .flatMap((item) => item.exports)
      .sort((left, right) => compareByPathThenName(left.filePath, left.moduleSpecifier ?? "", right.filePath, right.moduleSpecifier ?? ""));
    const diagnostics = parsedFiles
      .flatMap((item) => item.diagnostics)
      .sort((left, right) => (left.filePath ?? "").localeCompare(right.filePath ?? "") || left.message.localeCompare(right.message));

    return RepositoryIndexSchema.parse({
      repositoryId,
      rootPath,
      indexedAt,
      files,
      symbols,
      imports,
      exports,
      diagnostics,
      metadata: {
        indexer: INDEXER_NAME,
        deterministic: true,
        fileCount: files.length,
        symbolCount: symbols.length,
        importCount: imports.length,
        exportCount: exports.length
      }
    });
  }
}

export async function buildRepositoryIndex(input: RepositoryIndexerInput): Promise<RepositoryIndex> {
  return new TypeScriptRepositoryIndexer().index(input);
}

export function summarizeRepositoryIndex(index: RepositoryIndex): RepositoryIndexSummary {
  return RepositoryIndexSummarySchema.parse({
    repositoryId: index.repositoryId,
    indexedAt: index.indexedAt,
    fileCount: index.files.length,
    sourceFileCount: index.files.filter((file) => file.kind === "source").length,
    testFileCount: index.files.filter((file) => file.kind === "test").length,
    configFileCount: index.files.filter((file) => file.kind === "config").length,
    schemaFileCount: index.files.filter((file) => file.kind === "schema").length,
    migrationFileCount: index.files.filter((file) => file.kind === "migration").length,
    symbolCount: index.symbols.length,
    importCount: index.imports.length,
    exportCount: index.exports.length,
    indexHash: computeRepositoryIndexHash(index)
  });
}

export function computeRepositoryIndexHash(index: RepositoryIndex): string {
  return computeStableHash({
    repositoryId: index.repositoryId,
    files: index.files,
    symbols: index.symbols,
    imports: index.imports,
    exports: index.exports,
    diagnostics: index.diagnostics,
    metadata: {
      ...index.metadata,
      fileCount: index.files.length,
      symbolCount: index.symbols.length,
      importCount: index.imports.length,
      exportCount: index.exports.length
    }
  });
}

function computeStableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function normalizeRepositoryPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

async function listIndexableFiles(rootPath: string): Promise<string[]> {
  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(path.join(directory, entry.name));
        }

        continue;
      }

      if (entry.isFile() && INDEXABLE_EXTENSIONS.has(path.extname(entry.name))) {
        result.push(path.join(directory, entry.name));
      }
    }
  }

  await visit(rootPath);
  return result.sort();
}

async function parseFile(rootPath: string, absolutePath: string): Promise<ParsedFile> {
  const relativePath = normalizeRepositoryPath(path.relative(rootPath, absolutePath));
  const extension = path.extname(relativePath);
  const kind = classifyFileKind(relativePath);

  if (extension === ".json") {
    return {
      file: {
        path: relativePath,
        kind,
        exportedSymbols: [],
        importedSymbols: [],
        declaredSymbols: []
      },
      symbols: [],
      imports: [],
      exports: [],
      diagnostics: []
    };
  }

  const sourceText = await readFile(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    relativePath,
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

      if (moduleSpecifier) {
        imports.push({
          filePath: relativePath,
          moduleSpecifier,
          importedSymbols: imported
        });
      }

      importedSymbols.push(...imported);
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const exported = exportedSymbolsFromExportDeclaration(statement);
      const moduleSpecifier = statement.moduleSpecifier ? stringLiteralText(statement.moduleSpecifier) : undefined;
      const exportEntry: RepositoryExportIndex = {
        filePath: relativePath,
        exportedSymbols: exported
      };

      if (moduleSpecifier !== undefined) {
        exportEntry.moduleSpecifier = moduleSpecifier;
      }

      exports.push(exportEntry);
      exportedSymbols.push(...exported);
      continue;
    }

    collectDeclaration(statement, sourceFile, relativePath, symbols, declaredSymbols, exportedSymbols, exports);
  }

  const file = RepositoryFileIndexSchema.parse({
    path: relativePath,
    kind,
    exportedSymbols: uniqueValues(exportedSymbols).sort(),
    importedSymbols: uniqueValues(importedSymbols).sort(),
    declaredSymbols: uniqueValues(declaredSymbols).sort()
  });

  return {
    file,
    symbols: symbols.sort((left, right) => compareByPathThenName(left.filePath, left.name, right.filePath, right.name)),
    imports,
    exports,
    diagnostics: []
  };
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
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    collectSymbol(statement.name.text, symbolKindForDeclaration(statement, filePath), hasExportModifier(statement), statement, sourceFile, filePath, symbols, declaredSymbols, exportedSymbols, exports);
    return;
  }

  if (ts.isClassDeclaration(statement) && statement.name) {
    collectSymbol(statement.name.text, "class", hasExportModifier(statement), statement, sourceFile, filePath, symbols, declaredSymbols, exportedSymbols, exports);
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

  if (ts.isVariableStatement(statement)) {
    const exported = hasExportModifier(statement);

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        collectSymbol(
          declaration.name.text,
          variableSymbolKind(declaration.name.text, filePath),
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
    exports.push({
      filePath,
      exportedSymbols: [name]
    });
  }

  symbols.push(RepositorySymbolIndexSchema.parse({
    name,
    kind,
    filePath,
    exported,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  }));
}

function importedSymbolsFromImport(statement: ts.ImportDeclaration): string[] {
  const importClause = statement.importClause;
  const symbols: string[] = [];

  if (!importClause) {
    return symbols;
  }

  if (importClause.name) {
    symbols.push(importClause.name.text);
  }

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
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
    return [];
  }

  return uniqueValues(
    statement.exportClause.elements.map((element) => element.propertyName?.text ?? element.name.text)
  ).sort();
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function stringLiteralText(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) ? node.text : undefined;
}

function symbolKindForDeclaration(node: ts.FunctionDeclaration, filePath: string): RepositorySymbolKind {
  if (node.name && variableSymbolKind(node.name.text, filePath) === "component") {
    return "component";
  }

  return "function";
}

function variableSymbolKind(name: string, filePath: string): RepositorySymbolKind {
  if ((filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) && /^[A-Z]/u.test(name)) {
    return "component";
  }

  return "const";
}

function classifyFileKind(filePath: string): RepositoryFileKind {
  const normalized = normalizeRepositoryPath(filePath);
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

  if (normalized.includes("migrations/")) {
    return "migration";
  }

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

  if ([".ts", ".tsx", ".js", ".jsx"].includes(path.posix.extname(normalized))) {
    return "source";
  }

  return "unknown";
}

function compareByPathThenName(leftPath: string, leftName: string, rightPath: string, rightName: string): number {
  return leftPath.localeCompare(rightPath) || leftName.localeCompare(rightName);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)])
    );
  }

  return value;
}
