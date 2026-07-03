/**
 * Terminal sessions must survive across Next route bundles.
 *
 * Next compiles each route handler as its own bundle, so module-level state is
 * instantiated once PER BUNDLE (see global-singleton.ts). The POST /terminals
 * route creates the session in one bundle and GET /terminals/[id]/stream looks
 * it up from another — with a module-level Map the stream route always 404s
 * ("Abrir terminal" opens a session whose output never arrives). The registry
 * has to live on `globalThis`, like every other cross-route store in
 * `lib/server/runs`. We simulate the two bundles with `vi.resetModules()`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunRecord } from "@/lib/server/runs/schema";

type TerminalSessionsModule = typeof import("@/lib/server/runs/terminal-sessions");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-terminal-registry-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-terminal-test",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Terminal registry",
    title: "Terminal registry",
    version: 0,
    status: "running",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    patches: [],
    repoSpec: { kind: "localPath", path: tempDir }
  };
}

it("a session created in one bundle is visible from a freshly-loaded bundle", async () => {
  const bundleA: TerminalSessionsModule = await import("@/lib/server/runs/terminal-sessions");
  const info = await bundleA.createTerminalSession({
    run: makeRun("run-terminal-registry"),
    context: "base"
  });

  try {
    vi.resetModules();
    const bundleB: TerminalSessionsModule = await import("@/lib/server/runs/terminal-sessions");
    expect(bundleB.getTerminalSession(info.id)).not.toBeNull();
  } finally {
    vi.resetModules();
    const cleanup: TerminalSessionsModule = await import("@/lib/server/runs/terminal-sessions");
    cleanup.closeTerminalSession(info.id);
    // The first bundle may still hold the process handle if the registry is
    // fragmented; close through it too so the test never leaks a shell.
    bundleA.closeTerminalSession(info.id);
  }
});
