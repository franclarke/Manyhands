import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireDurableLock } from "@manyhands/run-store";

describe("Lock Ownership Fencing (MH-REM-002)", () => {
  it("acquires lock with unique token and releases cleanly when owned", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mh-lock-test-"));
    const lockPath = path.join(tempDir, "test.events.lock");

    try {
      const release = await acquireDurableLock(lockPath);

      expect(existsSync(lockPath)).toBe(true);
      const ownerPath = path.join(lockPath, "owner.json");
      expect(existsSync(ownerPath)).toBe(true);

      const ownerData = JSON.parse(readFileSync(ownerPath, "utf8")) as {
        pid: number;
        acquiredAt: string;
        token: string;
      };

      expect(ownerData.pid).toBe(process.pid);
      expect(typeof ownerData.acquiredAt).toBe("string");
      expect(typeof ownerData.token).toBe("string");
      expect(ownerData.token.length).toBeGreaterThan(10);

      await release();

      expect(existsSync(lockPath)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prevents deletion of lock directory when lock has been stolen by another process", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mh-lock-test-"));
    const lockPath = path.join(tempDir, "test.events.lock");

    try {
      const releaseA = await acquireDurableLock(lockPath);
      const ownerPath = path.join(lockPath, "owner.json");

      const ownerA = JSON.parse(readFileSync(ownerPath, "utf8")) as { token: string };
      const tokenA = ownerA.token;

      // Process B steals lock by overwriting owner.json with new token
      const tokenB = "stolen-token-process-b-12345";
      await writeFile(
        ownerPath,
        JSON.stringify({ pid: 99999, acquiredAt: new Date().toISOString(), token: tokenB }),
        "utf8"
      );

      // Process A attempts release
      await releaseA();

      // Fencing check ensures Process A's release does NOT delete Process B's lock directory
      expect(existsSync(lockPath)).toBe(true);
      const currentOwner = JSON.parse(readFileSync(ownerPath, "utf8")) as { token: string };
      expect(currentOwner.token).toBe(tokenB);
      expect(currentOwner.token).not.toBe(tokenA);

      // Clean up manually
      await rm(lockPath, { recursive: true, force: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles missing lock directory gracefully during release without throwing", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mh-lock-test-"));
    const lockPath = path.join(tempDir, "test.events.lock");

    try {
      const release = await acquireDurableLock(lockPath);

      // Lock directory is deleted externally before release() is invoked
      await rm(lockPath, { recursive: true, force: true });
      expect(existsSync(lockPath)).toBe(false);

      // Calling release() must not throw
      await expect(release()).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
