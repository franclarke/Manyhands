import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  CanonicalDigestSchema,
  EffectInputSpecSchema,
  buildEffectInput,
  canonicalJson,
  type DigestHasher,
  type EffectInput
} from "@manyhands/contracts";
import { durableWritesEnabled } from "./durable-file.js";

const EFFECT_INPUT_FILE_SUFFIX = ".effect-input.json";

export class EffectInputCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EffectInputCorruptionError";
  }
}

export interface EffectInputPublishContext {
  effectInput: Readonly<EffectInput>;
  temporaryPath: string;
  targetPath: string;
}

export interface FileEffectInputStoreOptions {
  directory?: string;
  hasher: DigestHasher;
  fsync?: boolean;
  removeTemporaryFile?: (filePath: string) => Promise<void>;
  beforePublish?: (context: EffectInputPublishContext) => void | Promise<void>;
}

/**
 * Immutable, content-addressed storage for the exact inputs of physical effects.
 *
 * Files contain only canonical EffectInputSpec bytes. The address is computed
 * externally from those bytes, while a second SHA-256 maps arbitrary digest
 * strings to Windows-safe filenames. Publication uses an exclusive hard link,
 * so a concurrent writer can observe a winner but can never replace it.
 */
export class FileEffectInputStore {
  private readonly directory: string;
  private readonly hasher: DigestHasher;
  private readonly shouldFsync: boolean;
  private readonly removeTemporaryFile: (filePath: string) => Promise<void>;
  private readonly beforePublish?: FileEffectInputStoreOptions["beforePublish"];

  constructor(options: FileEffectInputStoreOptions) {
    this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2/effect-inputs");
    this.hasher = options.hasher;
    this.shouldFsync = options.fsync ?? durableWritesEnabled();
    this.removeTemporaryFile = options.removeTemporaryFile
      ?? (async (filePath) => rm(filePath, { force: true }));
    this.beforePublish = options.beforePublish;
  }

  async put(input: unknown): Promise<EffectInput> {
    const candidate = this.parseAndBuild(input, "effect input being published");
    const targetPath = this.inputPath(candidate.inputDigest);
    const existing = await this.readPathIfPresent(targetPath, candidate.inputDigest);
    if (existing !== undefined) return assertIdentical(existing, candidate);

    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${targetPath}.tmp.${process.pid}.${randomUUID()}`;
    let temporaryCreated = false;

    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(`${canonicalJson(candidate.spec)}\n`, "utf8");
        if (this.shouldFsync) await handle.sync();
      } finally {
        await handle.close();
      }

      await this.beforePublish?.({ effectInput: candidate, temporaryPath, targetPath });

      try {
        await link(temporaryPath, targetPath);
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        const winner = await this.readPathIfPresent(targetPath, candidate.inputDigest);
        if (winner === undefined) {
          throw new EffectInputCorruptionError(
            `Effect input ${candidate.inputDigest} won publication but cannot be read.`
          );
        }
        return assertIdentical(winner, candidate);
      }

      if (this.shouldFsync) await syncDirectory(this.directory);
      return candidate;
    } finally {
      if (temporaryCreated) {
        await removeTemporaryBestEffort(temporaryPath, this.removeTemporaryFile);
      }
    }
  }

  async get(inputDigest: string): Promise<EffectInput | undefined> {
    const expectedDigest = CanonicalDigestSchema.parse(inputDigest);
    return this.readPathIfPresent(this.inputPath(expectedDigest), expectedDigest);
  }

  private inputPath(inputDigest: string): string {
    return path.join(this.directory, inputFileName(inputDigest));
  }

  private async readPathIfPresent(
    filePath: string,
    expectedDigest: string
  ): Promise<EffectInput | undefined> {
    try {
      const effectInput = await this.readPath(filePath);
      if (effectInput.inputDigest !== expectedDigest) {
        throw new EffectInputCorruptionError(
          `Effect input file for ${expectedDigest} contains content addressed as ${effectInput.inputDigest}.`
        );
      }
      if (path.basename(filePath) !== inputFileName(effectInput.inputDigest)) {
        throw new EffectInputCorruptionError(
          `Effect input ${effectInput.inputDigest} is stored under a filename that does not match its identity.`
        );
      }
      return effectInput;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async readPath(filePath: string): Promise<EffectInput> {
    let contents: string;
    let parsedJson: unknown;
    try {
      contents = await readFile(filePath, "utf8");
      parsedJson = JSON.parse(contents);
    } catch (error) {
      if (isNotFound(error)) throw error;
      throw new EffectInputCorruptionError(
        `Effect input ${filePath} is not complete JSON.`
      );
    }
    const effectInput = this.parseAndBuild(parsedJson, `persisted effect input ${filePath}`);
    if (contents !== `${canonicalJson(effectInput.spec)}\n`) {
      throw new EffectInputCorruptionError(
        `Persisted effect input ${filePath} does not contain its canonical bytes.`
      );
    }
    return effectInput;
  }

  private parseAndBuild(input: unknown, label: string): EffectInput {
    const parsed = EffectInputSpecSchema.safeParse(input);
    if (!parsed.success) {
      throw new EffectInputCorruptionError(
        `${label} is schema-invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`
      );
    }

    try {
      return buildEffectInput(parsed.data, this.hasher);
    } catch (error) {
      throw new EffectInputCorruptionError(
        `${label} could not produce a valid canonical digest: ${errorMessage(error)}`
      );
    }
  }
}

function inputFileName(inputDigest: string): string {
  return `${createHash("sha256").update(inputDigest, "utf8").digest("hex")}${EFFECT_INPUT_FILE_SUFFIX}`;
}

function assertIdentical(existing: EffectInput, candidate: EffectInput): EffectInput {
  if (canonicalJson(existing.spec) === canonicalJson(candidate.spec)) return existing;
  throw new EffectInputCorruptionError(
    `Effect input ${candidate.inputDigest} is immutable and already identifies different content.`
  );
}

async function removeTemporaryBestEffort(
  temporaryPath: string,
  removeFile: (filePath: string) => Promise<void>
): Promise<void> {
  try {
    await removeFile(temporaryPath);
  } catch {
    // Unpublished *.tmp.* files are never observed as effect inputs. Cleanup
    // failure must not revoke a published input or mask its primary error.
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32" || !isDirectorySyncUnsupported(error)) throw error;
  } finally {
    await handle?.close();
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isDirectorySyncUnsupported(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ["EACCES", "EBADF", "EINVAL", "EPERM"].includes(String(error.code));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
