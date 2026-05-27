import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError
} from "@/lib/server/workspaces/errors";
import {
  JsonWorkspaceRepository,
  type WorkspaceRepository
} from "@/lib/server/workspaces/repository";

let tempDir: string;
let filePath: string;
let repo: WorkspaceRepository;

function makeRepository(): WorkspaceRepository {
  let counter = 0;
  const clock = () => `2026-05-25T00:00:${String(counter).padStart(2, "0")}.000Z`;
  let idCounter = 0;
  return new JsonWorkspaceRepository({
    filePath,
    idFactory: () => {
      idCounter += 1;
      return `id-${idCounter}`;
    },
    clock: () => {
      counter += 1;
      return clock();
    }
  });
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspaces-"));
  filePath = path.join(tempDir, "workspaces.json");
  repo = makeRepository();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("JsonWorkspaceRepository", () => {
  it("seeds ManyHands and Aprobado on first list when file is missing", async () => {
    const workspaces = await repo.list();
    expect(workspaces.map((w) => w.name).sort()).toEqual(["Aprobado", "ManyHands"]);
    const onDisk = JSON.parse(await readFile(filePath, "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.workspaces).toHaveLength(2);
  });

  it("creates and retrieves a workspace", async () => {
    await repo.list();
    const created = await repo.create({ name: "Demo", description: "desc" });
    expect(created.name).toBe("Demo");
    expect(created.slug).toBe("demo");
    expect(created.description).toBe("desc");
    const fetched = await repo.get(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("dedupes slug on duplicate name", async () => {
    await repo.list();
    const a = await repo.create({ name: "Aprobado" });
    expect(a.slug).toBe("aprobado-2");
  });

  it("updates fields and bumps updatedAt", async () => {
    await repo.list();
    const created = await repo.create({ name: "Demo" });
    const updated = await repo.update(created.id, { name: "Demo 2", description: "new" });
    expect(updated.name).toBe("Demo 2");
    expect(updated.description).toBe("new");
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.slug).toBe(created.slug); // slug immutable
  });

  it("get throws WorkspaceNotFoundError for missing id", async () => {
    await repo.list();
    await expect(repo.get("missing")).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("update throws WorkspaceValidationError for invalid payload", async () => {
    await repo.list();
    const created = await repo.create({ name: "Demo" });
    await expect(repo.update(created.id, { name: "" })).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("delete removes an entry", async () => {
    await repo.list();
    const created = await repo.create({ name: "Demo" });
    await repo.delete(created.id);
    await expect(repo.get(created.id)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("delete refuses to remove the last workspace", async () => {
    await repo.list();
    const all = await repo.list();
    for (let i = 0; i < all.length - 1; i += 1) {
      const target = all[i];
      if (target) await repo.delete(target.id);
    }
    const remaining = await repo.list();
    expect(remaining).toHaveLength(1);
    const last = remaining[0]!;
    await expect(repo.delete(last.id)).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("create payload rejects empty name", async () => {
    await repo.list();
    await expect(repo.create({ name: "" })).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("serializes parallel writes producing unique slugs", async () => {
    await repo.list();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_v, idx) => repo.create({ name: `Demo ${idx}` }))
    );
    const slugs = new Set(results.map((w) => w.slug));
    expect(slugs.size).toBe(results.length);
  });

  it("rejects a corrupted file with WorkspaceValidationError", async () => {
    await import("node:fs/promises").then((fs) => fs.writeFile(filePath, "{ not json", "utf8"));
    await expect(repo.list()).rejects.toBeInstanceOf(WorkspaceValidationError);
  });
});
