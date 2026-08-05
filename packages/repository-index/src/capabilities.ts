import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const RepositoryPackageManagerSchema = z.object({
  name: z.enum(["pnpm", "npm", "yarn", "bun"]),
  version: NonEmptyStringSchema.optional(),
  evidence: NonEmptyStringSchema
}).strict();

export const RepositoryLanguageCapabilitySchema = z.object({
  language: z.enum(["typescript", "javascript"]),
  coverage: z.literal("structural"),
  confidence: z.number().min(0).max(1),
  evidence: z.array(NonEmptyStringSchema).min(1)
}).strict();

export const RepositoryStackSignalSchema = z.object({
  name: NonEmptyStringSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(NonEmptyStringSchema).min(1)
}).strict();

export const RepositoryBaselineCommandSchema = z.object({
  kind: z.enum(["test", "typecheck", "lint", "build"]),
  command: NonEmptyStringSchema,
  args: z.array(z.string()),
  sourceScript: NonEmptyStringSchema
}).strict();

export const RepositoryCapabilitiesSchema = z.object({
  packageManager: RepositoryPackageManagerSchema.optional(),
  scripts: z.record(NonEmptyStringSchema),
  baselineCommands: z.array(RepositoryBaselineCommandSchema),
  languages: z.array(RepositoryLanguageCapabilitySchema),
  stack: z.array(RepositoryStackSignalSchema)
}).strict();

export type RepositoryCapabilities = z.infer<typeof RepositoryCapabilitiesSchema>;

export interface CapabilityDiagnostic {
  code: "package_manifest_unreadable";
  severity: "warning";
  message: string;
  filePath: "package.json";
}

interface RepositoryIndexForCapabilities {
  files: Array<{ path: string }>;
}

interface PackageManifest {
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

export async function discoverRepositoryCapabilities(
  rootPath: string,
  index?: RepositoryIndexForCapabilities
): Promise<{ capabilities: RepositoryCapabilities; diagnostics: CapabilityDiagnostic[] }> {
  const diagnostics: CapabilityDiagnostic[] = [];
  const manifest = await readManifest(rootPath, diagnostics);
  const packageManager = await detectPackageManager(rootPath, manifest?.packageManager);
  const scripts = stringRecord(manifest?.scripts);
  const dependencies = {
    ...stringRecord(manifest?.dependencies),
    ...stringRecord(manifest?.devDependencies)
  };

  return {
    capabilities: RepositoryCapabilitiesSchema.parse({
      ...(packageManager !== undefined ? { packageManager } : {}),
      scripts,
      baselineCommands: baselineCommands(scripts, packageManager?.name),
      languages: languageCapabilities(index),
      stack: stackSignals(dependencies)
    }),
    diagnostics
  };
}

async function readManifest(
  rootPath: string,
  diagnostics: CapabilityDiagnostic[]
): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(path.join(rootPath, "package.json"), "utf8")) as PackageManifest;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return undefined;
    diagnostics.push({
      code: "package_manifest_unreadable",
      severity: "warning",
      filePath: "package.json",
      message: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

async function detectPackageManager(
  rootPath: string,
  packageManagerField: unknown
): Promise<RepositoryCapabilities["packageManager"]> {
  if (typeof packageManagerField === "string") {
    const match = /^(pnpm|npm|yarn|bun)(?:@(.+))?$/u.exec(packageManagerField.trim());
    if (match?.[1] !== undefined) {
      return {
        name: match[1] as "pnpm" | "npm" | "yarn" | "bun",
        ...(match[2] !== undefined ? { version: match[2] } : {}),
        evidence: "package.json#packageManager"
      };
    }
  }

  for (const [name, lockfile] of [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lockb"],
    ["npm", "package-lock.json"]
  ] as const) {
    if (await exists(path.join(rootPath, lockfile))) return { name, evidence: lockfile };
  }
  return undefined;
}

function baselineCommands(
  scripts: Record<string, string>,
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | undefined
): RepositoryCapabilities["baselineCommands"] {
  if (packageManager === undefined) return [];
  return (["test", "typecheck", "lint", "build"] as const)
    .filter((kind) => scripts[kind] !== undefined)
    .map((kind) => ({
      kind,
      command: packageManager,
      args: packageManager === "npm" && kind !== "test" ? ["run", kind] : [kind],
      sourceScript: kind
    }));
}

function languageCapabilities(
  index: RepositoryIndexForCapabilities | undefined
): RepositoryCapabilities["languages"] {
  if (index === undefined) return [];
  const typescriptFiles = index.files.filter((file) => /\.[cm]?tsx?$/u.test(file.path)).map((file) => file.path);
  const javascriptFiles = index.files.filter((file) => /\.[cm]?jsx?$/u.test(file.path)).map((file) => file.path);
  return [
    ...(typescriptFiles.length > 0
      ? [{ language: "typescript" as const, coverage: "structural" as const, confidence: 1, evidence: typescriptFiles }]
      : []),
    ...(javascriptFiles.length > 0
      ? [{ language: "javascript" as const, coverage: "structural" as const, confidence: 0.95, evidence: javascriptFiles }]
      : [])
  ];
}

function stackSignals(dependencies: Record<string, string>): RepositoryCapabilities["stack"] {
  const known = ["typescript", "react", "next", "vite", "vitest", "jest", "express", "fastify"];
  return known
    .filter((name) => dependencies[name] !== undefined)
    .map((name) => ({ name, confidence: 1, evidence: [`package.json dependency ${name}@${dependencies[name]}`] }));
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
