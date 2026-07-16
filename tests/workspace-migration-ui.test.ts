import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const commandCenterPath = new URL(
  "../apps/web/src/app/(command-center)/_components/command-center-shell.client.tsx",
  import.meta.url
);

describe("workspace migration conflict UI", () => {
  it("keeps an unresolved conflict visible and offers both durable resolution choices", async () => {
    const source = await readFile(commandCenterPath, "utf8");
    expect(source).toContain("Configuración duplicada de workspace");
    expect(source).toContain("migration-conflicts/${encodeURIComponent(");
    expect(source).toContain('handleMigrationConflictResolution(pendingMigrationConflict, "canonical")');
    expect(source).toContain('handleMigrationConflictResolution(pendingMigrationConflict, "duplicate")');
    expect(source).toContain("entry.resolution === undefined");
    expect(source).toContain('aria-label="Comparación de configuraciones duplicadas"');
    expect(source).toContain("migrationConflictValue(snapshot, field)");
    expect(source).toContain("pendingMigrationConflict.canonicalSnapshot");
    expect(source).toContain("pendingMigrationConflict.duplicateSnapshot");
    expect(source).toContain("sm:grid-cols-2");
    expect(source).toContain("break-words");
    expect(source).toContain("Conservar configuración actual:");
    expect(source).toContain("Usar configuración duplicada:");
  });
});
