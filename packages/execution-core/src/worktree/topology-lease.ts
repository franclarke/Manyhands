import { createHash } from "node:crypto";
import { tmpdir as osTmpdir } from "node:os";
import path from "node:path";

import {
  tryAcquireFilesystemFencedLease,
  type FilesystemFencedLease,
  type FilesystemFencedLeaseOptions
} from "./fenced-lease.js";

const TOPOLOGY_POLL_MS = 15;

export function worktreeTopologyLeasePath(
  repoRoot: string,
  tmpdir: () => string = osTmpdir
): string {
  const repositoryKey = createHash("sha256")
    .update(path.resolve(repoRoot).toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return path.join(tmpdir(), "manyhands-worktree-topology", repositoryKey, "lease");
}

export async function acquireWorktreeTopologyLease(
  repoRoot: string,
  ownerId: string,
  options: FilesystemFencedLeaseOptions & { tmpdir?: () => string } = {}
): Promise<FilesystemFencedLease> {
  const lockDir = worktreeTopologyLeasePath(repoRoot, options.tmpdir);
  for (;;) {
    const lease = await tryAcquireFilesystemFencedLease(lockDir, ownerId, options);
    if (lease !== undefined) return lease;
    await new Promise((resolve) => setTimeout(resolve, TOPOLOGY_POLL_MS));
  }
}
