import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);

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

  it("serializes writes from independent OS processes without a lost update", async () => {
    const childBundle = path.join(tempDir, "workspace-store-child.cjs");
    const esbuildCli = await findEsbuildCli();
    await execFileAsync(process.execPath, [
      esbuildCli,
      path.resolve("tests/helpers/workspace-store-child.ts"),
      `--outfile=${childBundle}`,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--log-level=silent",
      `--tsconfig=${path.resolve("tsconfig.json")}`
    ]);
    const gatePath = path.join(tempDir, "start-gate");
    const children = [
      spawn(process.execPath, [childBundle, filePath, "process-left", "Left", gatePath], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
      }),
      spawn(process.execPath, [childBundle, filePath, "process-right", "Right", gatePath], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
      })
    ];
    await Promise.all([
      waitForPath(`${gatePath}.process-left.ready`),
      waitForPath(`${gatePath}.process-right.ready`)
    ]);
    await writeFile(gatePath, "go", "utf8");
    await Promise.all(children.map(waitForChild));

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      workspaces: Array<{ id: string }>;
    };
    expect(persisted.workspaces.map((workspace) => workspace.id).sort()).toEqual([
      "process-left",
      "process-right"
    ]);
  }, 30_000);

  it("takes over an abandoned filesystem lock", async () => {
    const lockDir = `${filePath}.lock`;
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ token: "dead-owner", pid: 2_147_483_647, acquiredAt: "2020-01-01T00:00:00.000Z" }),
      "utf8"
    );
    const recovering = new JsonWorkspaceRepository({
      filePath,
      lockOptions: { staleMs: 0, acquireTimeoutMs: 2_000, retryMs: 1 }
    });

    await expect(recovering.list()).resolves.toHaveLength(2);
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads a legacy path-keyed repository identity without a filesystem object id", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: "legacy-id",
            slug: "legacy",
            name: "Legacy",
            repoPath: path.join(tempDir, "missing-repo"),
            repositoryIdentity: {
              version: 1,
              key: "a".repeat(64),
              repoRealPath: path.join(tempDir, "missing-repo"),
              gitCommonDir: path.join(tempDir, "missing-repo", ".git")
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    );
    const legacy = new JsonWorkspaceRepository({ filePath, seeds: [] });

    await expect(legacy.get("legacy-id")).resolves.toMatchObject({
      id: "legacy-id",
      repositoryIdentity: { key: "a".repeat(64) }
    });
  });

  it("rejects a corrupted file with WorkspaceValidationError", async () => {
    await import("node:fs/promises").then((fs) => fs.writeFile(filePath, "{ not json", "utf8"));
    await expect(repo.list()).rejects.toBeInstanceOf(WorkspaceValidationError);
  });
});

async function waitForPath(target: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await access(target);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${target}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Workspace child exited ${code ?? signal}: ${stderr}`));
    });
  });
}

async function findEsbuildCli(): Promise<string> {
  const store = path.resolve("node_modules/.pnpm");
  const packageDirectory = (await readdir(store)).find((entry) => entry.startsWith("esbuild@"));
  if (packageDirectory === undefined) throw new Error(`esbuild package is missing under ${store}`);
  return path.join(store, packageDirectory, "node_modules", "esbuild", "bin", "esbuild");
}
