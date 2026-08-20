import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { DeclaredCredential } from "./types.js";

export interface CredentialBrokerOptions {
  readonly rootDirectory: string;
}

export interface BrokeredCredentialContext {
  readonly homeDirectory: string;
  dispose(): Promise<void>;
}

/**
 * Removes the credential home for one identified attempt. Recovery calls this
 * after it has physically terminated a crashed worker and before it may start
 * a replacement attempt.
 */
export async function discardBrokeredCredentials(rootDirectory: string, attemptId: string): Promise<void> {
  if (!path.isAbsolute(rootDirectory)) throw new Error("Credential broker rootDirectory must be absolute.");
  if (!validIdentifier(attemptId)) throw new Error("Credential broker attemptId is invalid.");
  await rm(path.join(path.resolve(rootDirectory), digestSegment(attemptId)), { recursive: true, force: true });
}

/** Removes every brokered identity owned by one terminated supervised worker. */
export async function discardBrokeredCredentialScope(rootDirectory: string, scopeId: string): Promise<void> {
  if (!path.isAbsolute(rootDirectory)) throw new Error("Credential broker rootDirectory must be absolute.");
  if (!validIdentifier(scopeId)) throw new Error("Credential broker scopeId is invalid.");
  await rm(path.join(path.resolve(rootDirectory), digestSegment(scopeId)), { recursive: true, force: true });
}

/** Purges all residual brokered credential directories during daemon cold startup recovery. */
export async function purgeAllBrokeredCredentials(rootDirectory: string): Promise<void> {
  if (!path.isAbsolute(rootDirectory)) throw new Error("Credential broker rootDirectory must be absolute.");
  try {
    await rm(path.resolve(rootDirectory), { recursive: true, force: true });
  } catch {
    // Ignore if directory doesn't exist
  }
}

/**
 * Materializes declared provider authentication into an attempt-local home.
 * It deliberately copies files rather than forwarding HOME/USERPROFILE or
 * exposing a host configuration directory to the executor.
 */
export class CredentialBroker {
  private readonly rootDirectory: string;

  constructor(options: CredentialBrokerOptions) {
    if (!path.isAbsolute(options.rootDirectory)) {
      throw new Error("Credential broker rootDirectory must be absolute.");
    }
    this.rootDirectory = path.resolve(options.rootDirectory);
  }

  async create(
    attemptId: string,
    credentials: readonly DeclaredCredential[],
    credentialScopeId?: string
  ): Promise<BrokeredCredentialContext> {
    if (!validIdentifier(attemptId)) throw new Error("Credential broker attemptId is invalid.");
    if (credentialScopeId !== undefined && !validIdentifier(credentialScopeId)) {
      throw new Error("Credential broker scopeId is invalid.");
    }
    const attemptDirectory = credentialScopeId === undefined
      ? path.join(this.rootDirectory, digestSegment(attemptId))
      : path.join(this.rootDirectory, digestSegment(credentialScopeId), digestSegment(attemptId));
    const homeDirectory = path.join(attemptDirectory, "home");
    await mkdir(homeDirectory, { recursive: true });
    try {
      for (const credential of credentials) {
        if (credential.provider !== "codex" && credential.provider !== "claude") {
          throw new Error(`Unsupported credential provider ${String((credential as { provider?: unknown }).provider)}.`);
        }
        if (!path.isAbsolute(credential.sourcePath)) {
          throw new Error(`Credential source for ${credential.provider} must be absolute.`);
        }
        const target = credential.provider === "codex"
          ? path.join(homeDirectory, ".codex", "auth.json")
          : path.join(homeDirectory, ".claude", ".credentials.json");
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(credential.sourcePath, target);
      }
    } catch (error) {
      await rm(attemptDirectory, { recursive: true, force: true });
      throw error;
    }
    return {
      homeDirectory,
      dispose: async () => rm(attemptDirectory, { recursive: true, force: true })
    };
  }
}

function validIdentifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function digestSegment(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
