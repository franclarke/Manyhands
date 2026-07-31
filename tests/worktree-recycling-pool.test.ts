import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  WorktreePool,
  type WorktreePoolGit
} from "../packages/execution-core/src/worktree/worktree-pool";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorktreePool", () => {
  it("reuses a pre-created worktree after reset --hard and clean -fd", async () => {
    const repoRoot = await createRepository();
    const firstCommit = await commitFile(repoRoot, "version.txt", "one\n", "first");
    const pool = new WorktreePool({ repoRoot, size: 1 });
    await pool.initialize(firstCommit);

    const firstLease = await pool.acquire({ baseCommit: firstCommit });
    await writeFile(path.join(firstLease.path, "version.txt"), "dirty\n", "utf8");
    await writeFile(path.join(firstLease.path, "untracked.txt"), "remove me\n", "utf8");
    await pool.release(firstLease);

    const secondCommit = await commitFile(repoRoot, "version.txt", "two\n", "second");
    const secondLease = await pool.acquire({ baseCommit: secondCommit });

    expect(secondLease.path).toBe(firstLease.path);
    expect(secondLease.recycled).toBe(true);
    expect(await readFile(path.join(secondLease.path, "version.txt"), "utf8")).toBe("two\n");
    expect(await git(secondLease.path, ["status", "--porcelain"])).toBe("");
    expect(await worktreeCount(repoRoot)).toBe(2);

    await pool.release(secondLease);
    await pool.dispose();
    expect(await worktreeCount(repoRoot)).toBe(1);
  });

  it("does not hand one slot to two concurrent consumers", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const pool = new WorktreePool({ repoRoot, size: 1 });
    await pool.initialize(commit);

    const first = await pool.acquire({ baseCommit: commit });
    let secondResolved = false;
    const secondPromise = pool.acquire({ baseCommit: commit }).then((lease) => {
      secondResolved = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondResolved).toBe(false);

    await pool.release(first);
    const second = await secondPromise;
    expect(second.path).toBe(first.path);
    await pool.release(second);
    await pool.dispose();
  });

  it("fences one physical slot across independent pool instances", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const poolRoot = path.join(repoRoot, ".manyhands", "shared-pool");
    const firstPool = new WorktreePool({ repoRoot, poolRoot, size: 1 });
    const secondPool = new WorktreePool({ repoRoot, poolRoot, size: 1 });
    await Promise.all([firstPool.initialize(commit), secondPool.initialize(commit)]);

    const first = await firstPool.acquire({ baseCommit: commit, operationId: "first" });
    let secondResolved = false;
    const secondPromise = secondPool.acquire({
      baseCommit: commit,
      operationId: "second"
    }).then((lease) => {
      secondResolved = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondResolved).toBe(false);

    await firstPool.release(first);
    const second = await secondPromise;
    expect(second.path).toBe(first.path);
    expect(second.generation).toBeGreaterThan(first.generation);

    await secondPool.release(second);
    await firstPool.dispose();
    await secondPool.dispose();
  });

  it("serializes Git topology changes across different pools of the same repository", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "manyhands-topology-fake-"));
    tempRoots.push(repoRoot);
    const commonDir = path.join(repoRoot, ".git");
    await mkdir(commonDir, { recursive: true });
    const commit = "b".repeat(40);
    const validPaths = new Set<string>();
    let activeAdds = 0;
    let maxConcurrentAdds = 0;
    const gitAdapter: WorktreePoolGit = {
      add: async ({ worktreePath }) => {
        activeAdds += 1;
        maxConcurrentAdds = Math.max(maxConcurrentAdds, activeAdds);
        await new Promise((resolve) => setTimeout(resolve, 30));
        validPaths.add(worktreePath);
        activeAdds -= 1;
      },
      resetAndClean: async () => undefined,
      remove: async ({ worktreePath }) => {
        validPaths.delete(worktreePath);
      },
      prune: async () => undefined,
      validate: async ({ worktreePath }) => validPaths.has(worktreePath),
      resolveCommonDir: async () => commonDir,
      updateRef: async () => undefined
    };
    const firstPool = new WorktreePool({
      repoRoot,
      poolRoot: path.join(repoRoot, "pool-a"),
      size: 1,
      git: gitAdapter
    });
    const secondPool = new WorktreePool({
      repoRoot,
      poolRoot: path.join(repoRoot, "pool-b"),
      size: 1,
      git: gitAdapter
    });

    await Promise.all([firstPool.initialize(commit), secondPool.initialize(commit)]);

    expect(maxConcurrentAdds).toBe(1);
    await firstPool.dispose();
    await secondPool.dispose();
  });

  it("rejects a late release after an expired lease is taken over", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const poolRoot = path.join(repoRoot, ".manyhands", "takeover-pool");
    const firstPool = new WorktreePool({
      repoRoot,
      poolRoot,
      size: 1,
      staleLeaseMs: 50,
      heartbeatMs: 1_000
    });
    const secondPool = new WorktreePool({
      repoRoot,
      poolRoot,
      size: 1,
      staleLeaseMs: 50,
      heartbeatMs: 1_000,
      ownerIsAlive: async () => false
    });
    const first = await firstPool.acquire({ baseCommit: commit, operationId: "stale-owner" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const successor = await secondPool.acquire({
      baseCommit: commit,
      operationId: "successor"
    });

    await expect(firstPool.release(first)).rejects.toThrow("is no longer current");
    expect(successor.generation).toBeGreaterThan(first.generation);
    await secondPool.release(successor);
    await secondPool.dispose();
  });

  it("does not reuse an expired slot while its previous owner process is alive", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const poolRoot = path.join(repoRoot, ".manyhands", "live-owner-pool");
    const firstPool = new WorktreePool({
      repoRoot,
      poolRoot,
      size: 1,
      staleLeaseMs: 40,
      heartbeatMs: 1_000
    });
    const secondPool = new WorktreePool({
      repoRoot,
      poolRoot,
      size: 1,
      staleLeaseMs: 40,
      heartbeatMs: 1_000
    });
    const first = await firstPool.acquire({ baseCommit: commit, operationId: "paused-owner" });
    await new Promise((resolve) => setTimeout(resolve, 70));
    const abort = new AbortController();
    const blocked = secondPool.acquire({
      baseCommit: commit,
      operationId: "unsafe-successor",
      signal: abort.signal
    });
    setTimeout(() => abort.abort(new Error("owner still alive")), 80);

    await expect(blocked).rejects.toThrow("owner still alive");

    await firstPool.release(first);
    const successor = await secondPool.acquire({
      baseCommit: commit,
      operationId: "safe-successor"
    });
    await secondPool.release(successor);
    await secondPool.dispose();
  });

  it("does not leak ignored output into the next lease", async () => {
    const repoRoot = await createRepository();
    await writeFile(path.join(repoRoot, ".gitignore"), "generated/\n", "utf8");
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    await git(repoRoot, ["add", ".gitignore"]);
    await git(repoRoot, ["commit", "--amend", "--no-edit"]);
    const amendedCommit = await git(repoRoot, ["rev-parse", "HEAD"]);
    const pool = new WorktreePool({ repoRoot, size: 1 });
    await pool.initialize(amendedCommit);

    const first = await pool.acquire({ baseCommit: amendedCommit, operationId: "ignored-writer" });
    await mkdir(path.join(first.path, "generated"), { recursive: true });
    const residue = path.join(first.path, "generated", "secret.txt");
    await writeFile(residue, "must not survive\n", "utf8");
    await pool.release(first);

    const second = await pool.acquire({ baseCommit: amendedCommit, operationId: "next-owner" });
    await expect(access(residue)).rejects.toMatchObject({ code: "ENOENT" });
    await pool.release(second);
    await pool.dispose();
    expect(commit).not.toBe(amendedCommit);
  });

  it("removes an aborted waiter without consuming the next slot", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const pool = new WorktreePool({ repoRoot, size: 1 });
    const first = await pool.acquire({ baseCommit: commit, operationId: "holder" });
    const controller = new AbortController();
    const aborted = pool.acquire({
      baseCommit: commit,
      operationId: "aborted",
      signal: controller.signal
    });
    controller.abort(new Error("request cancelled"));

    await expect(aborted).rejects.toThrow("request cancelled");
    await pool.release(first);
    const next = await pool.acquire({ baseCommit: commit, operationId: "next" });
    expect(next.path).toBe(first.path);
    await pool.release(next);
    await pool.dispose();
  });

  it("adopts valid slots after a pool instance restarts", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const poolRoot = path.join(repoRoot, ".manyhands", "restart-pool");
    const firstPool = new WorktreePool({ repoRoot, poolRoot, size: 1 });
    const first = await firstPool.acquire({ baseCommit: commit, operationId: "before-restart" });
    await firstPool.release(first);

    const restartedPool = new WorktreePool({ repoRoot, poolRoot, size: 1 });
    await restartedPool.initialize(commit);
    const second = await restartedPool.acquire({ baseCommit: commit, operationId: "after-restart" });

    expect(second.path).toBe(first.path);
    expect(second.recycled).toBe(true);
    await restartedPool.release(second);
    await restartedPool.dispose();
  });

  it("anchors a candidate ref before recycling its detached slot", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const pool = new WorktreePool({ repoRoot, size: 1 });
    const lease = await pool.acquire({ baseCommit: commit, operationId: "candidate-owner" });
    await writeFile(path.join(lease.path, "candidate.txt"), "candidate\n", "utf8");
    await git(lease.path, ["add", "candidate.txt"]);
    await git(lease.path, ["commit", "-m", "candidate"]);
    const candidateCommit = await git(lease.path, ["rev-parse", "HEAD"]);

    await pool.release(lease, {
      kind: "candidate",
      runId: "run-1",
      attemptId: "attempt-1",
      candidateCommit
    });
    const next = await pool.acquire({ baseCommit: commit, operationId: "next-owner" });

    expect(await git(repoRoot, [
      "rev-parse",
      "refs/manyhands/runs/run-1/attempts/attempt-1/candidate"
    ])).toBe(candidateCommit);
    expect(await git(next.path, ["rev-parse", "HEAD"])).toBe(commit);
    await pool.release(next);
    await pool.dispose();
  });

  it("never overwrites an attempt candidate ref with a different commit", async () => {
    const repoRoot = await createRepository();
    const commit = await commitFile(repoRoot, "README.md", "# fixture\n", "initial");
    const pool = new WorktreePool({ repoRoot, size: 2 });
    const first = await pool.acquire({ baseCommit: commit, operationId: "first-candidate" });
    const second = await pool.acquire({ baseCommit: commit, operationId: "conflicting-candidate" });
    await writeFile(path.join(first.path, "first.txt"), "first\n", "utf8");
    await git(first.path, ["add", "first.txt"]);
    await git(first.path, ["commit", "-m", "first candidate"]);
    const firstCandidate = await git(first.path, ["rev-parse", "HEAD"]);
    await writeFile(path.join(second.path, "second.txt"), "second\n", "utf8");
    await git(second.path, ["add", "second.txt"]);
    await git(second.path, ["commit", "-m", "second candidate"]);
    const secondCandidate = await git(second.path, ["rev-parse", "HEAD"]);

    await pool.release(first, {
      kind: "candidate",
      runId: "run-immutable",
      attemptId: "attempt-immutable",
      candidateCommit: firstCandidate
    });
    await expect(pool.release(second, {
      kind: "candidate",
      runId: "run-immutable",
      attemptId: "attempt-immutable",
      candidateCommit: secondCandidate
    })).rejects.toThrow("Could not anchor candidate");

    expect(await git(repoRoot, [
      "rev-parse",
      "refs/manyhands/runs/run-immutable/attempts/attempt-immutable/candidate"
    ])).toBe(firstCandidate);
    await pool.dispose();
  });

  it("recreates a quarantined slot after sanitation fails", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "manyhands-pool-fake-"));
    tempRoots.push(repoRoot);
    const commonDir = path.join(repoRoot, ".git");
    await mkdir(commonDir, { recursive: true });
    const commit = "a".repeat(40);
    let valid = false;
    let addCount = 0;
    let resetCount = 0;
    const gitAdapter: WorktreePoolGit = {
      add: async () => {
        addCount += 1;
        valid = true;
      },
      resetAndClean: async () => {
        resetCount += 1;
        if (resetCount === 1) throw new Error("simulated sanitation failure");
      },
      remove: async () => {
        valid = false;
      },
      prune: async () => undefined,
      validate: async () => valid,
      resolveCommonDir: async () => commonDir,
      updateRef: async () => undefined
    };
    const pool = new WorktreePool({
      repoRoot,
      poolRoot: path.join(repoRoot, "pool"),
      size: 1,
      git: gitAdapter
    });

    await expect(pool.acquire({ baseCommit: commit, operationId: "failing" }))
      .rejects.toThrow("simulated sanitation failure");
    const recovered = await pool.acquire({ baseCommit: commit, operationId: "recovered" });

    expect(addCount).toBe(2);
    expect(recovered.generation).toBeGreaterThan(1);
    await pool.release(recovered);
    await pool.dispose();
  });

  it("refuses to create a slot when an invalid orphan cannot be removed", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "manyhands-pool-orphan-"));
    tempRoots.push(repoRoot);
    const commonDir = path.join(repoRoot, ".git");
    const poolRoot = path.join(repoRoot, ".manyhands", "pool");
    await mkdir(path.join(poolRoot, "slot-000"), { recursive: true });

    const git: WorktreePoolGit = {
      add: async () => undefined,
      resetAndClean: async () => undefined,
      remove: async () => undefined,
      prune: async () => undefined,
      validate: async () => false,
      resolveCommonDir: async () => commonDir,
      updateRef: async () => undefined
    };
    const pool = new WorktreePool({
      repoRoot,
      poolRoot,
      size: 1,
      git,
      removePath: async () => {
        throw new Error("EPERM: stale process still owns the slot");
      }
    });

    await expect(pool.initialize("a".repeat(40))).rejects.toThrow(
      "worktree_pool_unavailable: could not remove invalid slot slot-000"
    );
  });

  /**
   * Dos intentos de hoja se perdieron con este error y no se pudo decir por qué:
   * el mensaje nombraba el slot y nada más, y el `cause` no viajaba al journal.
   * Sin la causa, la próxima vez tampoco se va a poder atribuir. Dos hipótesis
   * mecánicas ---archivo de sólo lectura y archivo con handle abierto--- se
   * probaron contra esta plataforma y ninguna reproduce el fallo, así que lo que
   * se corrige es la atribución y no un mecanismo que no está demostrado.
   */
  it("says why an invalid slot could not be removed, and where", async () => {
    const repoRoot = await createRepository();
    await commitFile(repoRoot, "seed.txt", "seed");
    const poolRoot = path.join(repoRoot, "pool");
    const commonDir = path.join(repoRoot, ".git");
    const git: WorktreePoolGit = {
      add: async () => undefined,
      resetAndClean: async () => undefined,
      remove: async () => undefined,
      prune: async () => undefined,
      validate: async () => false,
      resolveCommonDir: async () => commonDir,
      updateRef: async () => undefined
    };
    const failure = Object.assign(new Error("EBUSY: resource busy or locked"), {
      code: "EBUSY",
      path: path.join(poolRoot, "slot-000", "node_modules", ".bin")
    });
    const pool = new WorktreePool({
      repoRoot,
      poolRoot,
      size: 1,
      git,
      removePath: async () => { throw failure; }
    });

    await expect(pool.initialize("a".repeat(40))).rejects.toThrow(/EBUSY/u);
    await expect(pool.initialize("a".repeat(40))).rejects.toThrow(/node_modules/u);
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "manyhands-worktree-pool-"));
  tempRoots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tests@manyhands.local"]);
  await git(root, ["config", "user.name", "ManyHands Tests"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  return root;
}

async function commitFile(
  root: string,
  relativePath: string,
  content: string,
  message: string
): Promise<string> {
  await writeFile(path.join(root, relativePath), content, "utf8");
  await git(root, ["add", relativePath]);
  await git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function worktreeCount(repoRoot: string): Promise<number> {
  const output = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  return output.split(/\r?\n/u).filter((line) => line.startsWith("worktree ")).length;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  return stdout.trim();
}
