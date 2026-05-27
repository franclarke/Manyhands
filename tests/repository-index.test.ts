import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RepositoryIndexSchema,
  buildRepositoryIndex,
  summarizeRepositoryIndex
} from "@manyhands/repository-index";

const repositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

describe("RepositoryIndex", () => {
  it("builds a valid repository index for aprobado-lite", async () => {
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });

    expect(RepositoryIndexSchema.safeParse(index).success).toBe(true);
    expect(index.repositoryId).toBe("aprobado-lite");
    expect(index.metadata.deterministic).toBe(true);
  });

  it("classifies source, test, config and schema files", async () => {
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const kindsByPath = new Map(index.files.map((file) => [file.path, file.kind]));

    expect(kindsByPath.get("src/auth/magic-link/token-store.ts")).toBe("source");
    expect(kindsByPath.get("tests/auth/passwordless-login.test.ts")).toBe("test");
    expect(kindsByPath.get("package.json")).toBe("config");
    expect(kindsByPath.get("tsconfig.json")).toBe("config");
    expect(kindsByPath.get("src/lib/db/schema.ts")).toBe("schema");
  });

  it("detects imports and exports", async () => {
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });

    expect(index.imports.some((item) => item.importedSymbols.includes("MagicLinkTokenStore"))).toBe(true);
    expect(index.exports.some((item) => item.exportedSymbols.includes("requestMagicLink"))).toBe(true);
    expect(index.exports.some((item) => item.exportedSymbols.includes("MagicLinkRequestForm"))).toBe(true);
  });

  it("detects declared symbols", async () => {
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const symbols = new Map(index.symbols.map((symbol) => [symbol.name, symbol]));

    expect(symbols.get("MagicLinkToken")?.kind).toBe("type");
    expect(symbols.get("MagicLinkTokenStore")?.kind).toBe("interface");
    expect(symbols.get("requestMagicLink")?.kind).toBe("function");
    expect(symbols.get("MagicLinkRequestForm")?.kind).toBe("component");
  });

  it("summarizes the index with a deterministic hash", async () => {
    const first = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const second = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });

    expect(summarizeRepositoryIndex(first).indexHash).toBe(summarizeRepositoryIndex(second).indexHash);
    expect(summarizeRepositoryIndex(first)).toEqual(
      expect.objectContaining({
        fileCount: first.files.length,
        symbolCount: first.symbols.length,
        importCount: first.imports.length,
        exportCount: first.exports.length
      })
    );
  });
});
