import { describe, expect, it } from "vitest";
import { RunActorRegistry } from "../packages/run-engine/src/run-actor-registry.js";

describe("RunActorRegistry", () => {
  it("deduplicates concurrent actor creation and retains the recovered actor", async () => {
    const firstAssertion = deferred<void>();
    const calls = {
      assertions: 0,
      claims: 0,
      creations: 0,
      recoveries: 0
    };
    const actor = {
      async recoverPendingEffects(): Promise<void> {
        calls.recoveries += 1;
      }
    };
    const registry = new RunActorRegistry({
      async assertInstallationAuthority() {
        calls.assertions += 1;
        if (calls.assertions === 1) await firstAssertion.promise;
      },
      async claimRunAuthority(runId: string) {
        calls.claims += 1;
        return `authority:${runId}`;
      },
      async createActor() {
        calls.creations += 1;
        return actor;
      }
    });

    const first = registry.getOrCreate("run:1");
    const concurrent = registry.getOrCreate("run:1");
    expect(calls.claims).toBe(0);

    firstAssertion.resolve(undefined);
    const [created, duplicate] = await Promise.all([first, concurrent]);
    const later = await registry.getOrCreate("run:1");

    expect(created).toBe(actor);
    expect(duplicate).toBe(actor);
    expect(later).toBe(actor);
    expect(calls).toEqual({
      assertions: 2,
      claims: 1,
      creations: 1,
      recoveries: 1
    });
  });

  it("fences actor creation and completes recovery before exposing the actor", async () => {
    const recovery = deferred<void>();
    const operations: string[] = [];
    const actor = {
      async recoverPendingEffects(): Promise<void> {
        operations.push("recover");
        await recovery.promise;
      }
    };
    const registry = new RunActorRegistry({
      async assertInstallationAuthority() {
        operations.push("assert-installation");
      },
      async claimRunAuthority(runId: string) {
        operations.push(`claim:${runId}`);
        return { daemonEpoch: "epoch:7" };
      },
      async createActor(runId: string, authority: { daemonEpoch: string }) {
        operations.push(`create:${runId}:${authority.daemonEpoch}`);
        return actor;
      }
    });

    let exposed = false;
    const pending = registry.getOrCreate("run:7").then((created) => {
      exposed = true;
      return created;
    });
    await waitUntil(() => operations.includes("recover"));

    expect(exposed).toBe(false);
    expect(operations).toEqual([
      "assert-installation",
      "claim:run:7",
      "create:run:7:epoch:7",
      "assert-installation",
      "recover"
    ]);

    recovery.resolve(undefined);
    await expect(pending).resolves.toBe(actor);
  });

  it("evicts only a failed initialization so that the run can be retried", async () => {
    let attempts = 0;
    const recoveredActor = {
      async recoverPendingEffects(): Promise<void> {}
    };
    const registry = new RunActorRegistry({
      async assertInstallationAuthority() {},
      async claimRunAuthority(runId: string) {
        return `authority:${runId}`;
      },
      async createActor() {
        attempts += 1;
        if (attempts === 1) {
          return {
            async recoverPendingEffects(): Promise<void> {
              throw new Error("recovery failed");
            }
          };
        }
        return recoveredActor;
      }
    });

    await expect(registry.getOrCreate("run:retry")).rejects.toThrow("recovery failed");
    const retried = await registry.getOrCreate("run:retry");
    const retained = await registry.getOrCreate("run:retry");

    expect(retried).toBe(recoveredActor);
    expect(retained).toBe(recoveredActor);
    expect(attempts).toBe(2);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}
