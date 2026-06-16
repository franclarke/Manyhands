# Migración Gemini CLI → Claude Code + Codex — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover Gemini CLI de ManyHands; ejecución en Claude Code (default) + Codex, planning en un `ClaudeCodeRecursiveDecomposer` nuevo (CLI, sin API key).

**Architecture:** El seam de executor/decomposer ya es provider-agnostic. Se agrega un decomposer CLI espejo del de Gemini (envuelve `claude -p --output-format json --permission-mode plan` como `AnthropicLike`), se mueven los defaults del registry/policy a Claude Code, y se borra todo el camino de Gemini (profile, decomposer, readiness, UI, docs, tests).

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Next.js (apps/web), `@anthropic-ai/sdk` (solo baselines API), Claude Code CLI (`claude`), Codex CLI (`codex`).

**Spec:** `docs/superpowers/specs/2026-06-16-migracion-gemini-a-claude-codex-design.md`

**Convenciones de verificación:**
- Test estrecho: `pnpm test <archivo>` (Vitest filtra por path).
- Typecheck paquete: `pnpm -F @manyhands/decomposer typecheck`, `pnpm -F @manyhands/execution-core typecheck`.
- Web: `pnpm web:typecheck`.
- TDD estricto: ninguna línea de implementación antes de su test en rojo.

---

## Fase 1 — `ClaudeCodeRecursiveDecomposer` (planning, código nuevo)

### Task 1: Test del nuevo decomposer (rojo)

**Files:**
- Create: `tests/decomposer-claude-code-recursive.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ClaudeCodeRecursiveDecomposer, isDecomposerLlmError, type FeatureRequest } from "@manyhands/decomposer";

const FEATURE: FeatureRequest = {
  id: "local-feature",
  title: "Local feature",
  description: "Implement a local feature",
  targetStack: ["typescript"],
  constraints: [],
  acceptanceCriteria: ["feature works"]
};

describe("ClaudeCodeRecursiveDecomposer", () => {
  it("uses the claude result envelope as the recursive step JSON", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn({
        decision: "atomic",
        reasoning: "single function",
        allowedPaths: ["src/**"],
        forbiddenPaths: [],
        expectedFiles: ["src/index.ts"],
        acceptanceCriteria: ["feature works"]
      }, 0, ""),
      useShell: false
    });

    const result = await decomposer.decompose(FEATURE);
    expect(result.graph.nodes.root?.kind).toBe("root");
    expect(result.contracts[0]?.expectedOutput.changedFiles).toEqual(["src/index.ts"]);
  });

  it("plans in plan mode against the configured model", async () => {
    const calls: string[][] = [];
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "haiku",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn({
        decision: "atomic",
        reasoning: "single function",
        allowedPaths: ["src/**"],
        forbiddenPaths: [],
        expectedFiles: ["src/index.ts"],
        acceptanceCriteria: ["feature works"]
      }, 0, "", (args) => calls.push([...args])),
      useShell: false
    });

    await decomposer.decompose(FEATURE);
    const args = calls[0] ?? [];
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args).toContain("haiku");
  });

  it("surfaces claude process failures as decomposer LLM errors", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawn("not json", 7, "boom"),
      useShell: false
    });

    await expect(decomposer.decompose(FEATURE)).rejects.toSatisfy(isDecomposerLlmError);
  });

  it("surfaces is_error envelopes as decomposer LLM errors", async () => {
    const decomposer = new ClaudeCodeRecursiveDecomposer({
      model: "sonnet",
      userPrompt: "implement locally",
      cwd: process.cwd(),
      spawn: fakeClaudeSpawnRaw(
        JSON.stringify({ type: "result", is_error: true, result: "model refused" }),
        0,
        ""
      ),
      useShell: false
    });

    await expect(decomposer.decompose(FEATURE)).rejects.toSatisfy(isDecomposerLlmError);
  });
});

// Wraps the step JSON inside a claude `--output-format json` result envelope.
function fakeClaudeSpawn(
  stepValue: unknown,
  exitCode = 0,
  stderrValue = "",
  onArgs?: (args: readonly string[]) => void
) {
  const stdout =
    typeof stepValue === "string"
      ? stepValue
      : JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(stepValue) });
  return fakeClaudeSpawnRaw(stdout, exitCode, stderrValue, onArgs);
}

function fakeClaudeSpawnRaw(
  stdoutValue: string,
  exitCode = 0,
  stderrValue = "",
  onArgs?: (args: readonly string[]) => void
) {
  return (_command: string, args: readonly string[], _options: SpawnOptions): ChildProcess => {
    onArgs?.(args);
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setTimeout(() => {
      child.stdout.write(stdoutValue);
      if (stderrValue.length > 0) child.stderr.write(stderrValue);
      child.emit("close", exitCode);
    }, 0);
    return child as never;
  };
}
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm test tests/decomposer-claude-code-recursive.test.ts`
Expected: FAIL — `ClaudeCodeRecursiveDecomposer` no exportado por `@manyhands/decomposer`.

### Task 2: Implementar `ClaudeCodeRecursiveDecomposer` (verde)

**Files:**
- Create: `packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts`
- Reference (espejo): `packages/decomposer/src/llm/recursive/gemini-recursive-decomposer.ts`

- [ ] **Step 1: Crear el archivo**

```ts
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import type { Decomposer, DecompositionOptions, DecompositionResult, FeatureRequest } from "../../index";
import type { AnthropicLike } from "../anthropic-decomposer";
import { DecomposerLlmError } from "../errors";
import {
  RecursiveDecomposer,
  type RecursiveDecomposerOptions,
  type RecursiveStepCompletedEvent,
  type RecursiveStepListener,
  type RecursiveStepStartedEvent,
  type RecursiveStepStatusEvent
} from "./recursive-decomposer";
import { parseJsonObject } from "./json";
import { RECURSIVE_DECOMPOSER_PROMPT_VERSION, type Aggressiveness } from "./step-prompt";

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ClaudeCodeRecursiveDecomposerOptions {
  model: string;
  userPrompt: string;
  cwd: string;
  binaryPath?: string;
  timeoutMs?: number;
  workspaceHints?: string;
  aggressiveness?: Aggressiveness;
  depthBudget?: number;
  maxParallelSteps?: number;
  maxStepAttempts?: number;
  stepRetryBaseDelayMs?: number;
  stepRetryMaxDelayMs?: number;
  allowNonRootFallback?: boolean;
  promptTemplateVersion?: string;
  onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
  onStepStatus?: RecursiveStepListener<RecursiveStepStatusEvent>;
  spawn?: SpawnFn;
  useShell?: boolean;
  onCliOutput?: (data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Claude Code print mode (`-p`) with `--output-format json` runs one headless
 * turn and emits a `{ type:"result", result, is_error }` envelope on stdout.
 * `--permission-mode plan` keeps the model read-only while it grounds interface
 * decisions. The full planning prompt arrives over stdin (no arg-length limit);
 * this directive only triggers headless print mode.
 */
const STDIN_DIRECTIVE = "Follow the planning instructions provided on stdin.";

/**
 * Recursive decomposer backed by the local Claude Code CLI, not a hosted API.
 * The RecursiveDecomposer owns recursion, validation and retries; this adapter
 * supplies one step client backed by `claude` in read-only plan mode.
 */
export class ClaudeCodeRecursiveDecomposer implements Decomposer {
  private readonly inner: RecursiveDecomposer;
  public readonly model: string;
  public readonly promptTemplateVersion: string;

  constructor(options: ClaudeCodeRecursiveDecomposerOptions) {
    this.model = options.model;
    this.promptTemplateVersion =
      options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.claude-code`;

    const clientOptions: ClaudeCodeStepClientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.binaryPath !== undefined) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== undefined) clientOptions.timeoutMs = options.timeoutMs;
    if (options.spawn !== undefined) clientOptions.spawn = options.spawn;
    if (options.useShell !== undefined) clientOptions.useShell = options.useShell;
    if (options.onCliOutput !== undefined) clientOptions.onCliOutput = options.onCliOutput;
    const client = new ClaudeCodeStepClient(clientOptions);

    const recursiveOptions: RecursiveDecomposerOptions = {
      client,
      model: options.model,
      userPrompt: options.userPrompt,
      promptTemplateVersion: this.promptTemplateVersion
    };
    if (options.workspaceHints !== undefined) recursiveOptions.workspaceHints = options.workspaceHints;
    if (options.aggressiveness !== undefined) recursiveOptions.aggressiveness = options.aggressiveness;
    if (options.depthBudget !== undefined) recursiveOptions.depthBudget = options.depthBudget;
    if (options.maxParallelSteps !== undefined) recursiveOptions.maxParallelSteps = options.maxParallelSteps;
    if (options.maxStepAttempts !== undefined) recursiveOptions.maxStepAttempts = options.maxStepAttempts;
    if (options.stepRetryBaseDelayMs !== undefined) recursiveOptions.stepRetryBaseDelayMs = options.stepRetryBaseDelayMs;
    if (options.stepRetryMaxDelayMs !== undefined) recursiveOptions.stepRetryMaxDelayMs = options.stepRetryMaxDelayMs;
    if (options.allowNonRootFallback !== undefined) recursiveOptions.allowNonRootFallback = options.allowNonRootFallback;
    if (options.onStepStarted !== undefined) recursiveOptions.onStepStarted = options.onStepStarted;
    if (options.onStepCompleted !== undefined) recursiveOptions.onStepCompleted = options.onStepCompleted;
    if (options.onStepStatus !== undefined) recursiveOptions.onStepStatus = options.onStepStatus;
    this.inner = new RecursiveDecomposer(recursiveOptions);
  }

  decompose(input: FeatureRequest, options?: DecompositionOptions): Promise<DecompositionResult> {
    return this.inner.decompose(input, options);
  }

  executeStep(ctx: any, aggressiveness: any, accum: any) {
    return this.inner.executeStep(ctx, aggressiveness, accum);
  }

  reconstructGraph(feature: any, stepCache: any, questionAnswers?: any, repoSpec?: any) {
    return this.inner.reconstructGraph(feature, stepCache, questionAnswers, repoSpec);
  }
}

interface ClaudeCodeStepClientOptions {
  model: string;
  cwd: string;
  binaryPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  useShell?: boolean;
  onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;
}

class ClaudeCodeStepClient implements AnthropicLike {
  readonly messages: AnthropicLike["messages"];
  private readonly model: string;
  private readonly cwd: string;
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private readonly useShell: boolean;
  private readonly onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;

  constructor(options: ClaudeCodeStepClientOptions) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.binaryPath = options.binaryPath ?? process.env.MANYHANDS_CLAUDE_BIN ?? "claude";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = options.spawn ?? spawn;
    this.useShell = options.useShell ?? process.platform === "win32";
    this.onCliOutput = options.onCliOutput;
    this.messages = {
      create: async (args: any) => {
        const systemPrompt = [
          "CRITICAL: Do NOT call any tools. Do not search for files, do not read files, do not run grep, and do not execute any commands. All required context is fully provided in the prompt text.",
          "Analyze the input text locally and return strictly the JSON matching the schema.",
          args.system
        ].join("\n\n");
        const prompt = [
          "## System",
          systemPrompt,
          "",
          "## User",
          args.messages.map((message: any) => message.content).join("\n\n")
        ].join("\n");
        const text = await this.runClaude(prompt, args.nodeId);
        return { content: [{ type: "text", text }] };
      }
    };
  }

  private async runClaude(prompt: string, nodeId?: string): Promise<string> {
    const args = [
      "-p",
      STDIN_DIRECTIVE,
      "--model",
      this.model,
      "--output-format",
      "json",
      "--permission-mode",
      "plan"
    ];

    const outcome = await spawnClaude({
      binaryPath: this.binaryPath,
      args,
      cwd: this.cwd,
      prompt,
      timeoutMs: this.timeoutMs,
      spawnFn: this.spawnFn,
      useShell: this.useShell,
      onChunk: (chunk, stream) => {
        if (this.onCliOutput !== undefined && nodeId !== undefined) {
          this.onCliOutput({ nodeId, chunk, stream });
        }
      }
    });

    if (outcome.timedOut) {
      const message = `Claude Code recursive planning timed out after ${this.timeoutMs}ms`;
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_timeout",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }
    if (outcome.exitCode !== 0) {
      const message = `Claude Code recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`;
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_request",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    const cliJson = parseJsonObject(outcome.stdout, { prefer: isClaudeResultEnvelope });
    if ("ok" in cliJson) {
      const message = `${cliJson.message} in Claude Code stdout for node "${nodeId ?? "?"}"`;
      throw new DecomposerLlmError(`${message}. Raw output was:\n${outcome.stdout}`, undefined, "parse", {
        kind: cliJson.kind,
        stage: "parse",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    const parsedCli = cliJson.value;
    if (isRecord(parsedCli) && parsedCli.type === "result" && typeof parsedCli.result === "string") {
      if (parsedCli.is_error === true) {
        const message = `Claude Code reported an error result for node "${nodeId ?? "?"}": ${parsedCli.result}`;
        throw new DecomposerLlmError(message, undefined, "request", {
          kind: "provider_request",
          stage: "request",
          recoverable: true,
          ...(nodeId !== undefined ? { nodeId } : {}),
          message
        });
      }
      return parsedCli.result;
    }

    const message = `Claude Code JSON output for node "${nodeId ?? "?"}" did not contain a result field`;
    throw new DecomposerLlmError(`${message}. Raw output was:\n${outcome.stdout}`, undefined, "parse", {
      kind: "schema_invalid",
      stage: "parse",
      recoverable: true,
      ...(nodeId !== undefined ? { nodeId } : {}),
      message
    });
  }
}

function isClaudeResultEnvelope(value: unknown): boolean {
  return isRecord(value) && value.type === "result" && typeof value.result === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SpawnClaudeInput {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  useShell: boolean;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}

interface SpawnClaudeOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnClaude(input: SpawnClaudeInput): Promise<SpawnClaudeOutcome> {
  return new Promise((resolve) => {
    const child = input.spawnFn(input.binaryPath, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: input.useShell
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: SpawnClaudeOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: TIMEOUT_EXIT_CODE, stdout, stderr, timedOut: true });
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      input.onChunk?.(text, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      input.onChunk?.(text, "stderr");
    });
    child.on("error", (error: Error) => {
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        timedOut: false
      });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, stdout, stderr, timedOut: false });
    });

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.prompt);
  });
}
```

> **Nota de verificación al ejecutar:** confirmar la firma exacta de `parseJsonObject` en `./json.ts` (gemini la usa como `parseJsonObject(stdout, { prefer })` devolviendo `{ ok, message, kind } | { value, raw }`). Si difiere, ajustar el manejo del resultado para igualar el patrón del archivo de Gemini.

### Task 3: Exportar el nuevo decomposer y quitar el de Gemini del barrel

**Files:**
- Modify: `packages/decomposer/src/index.ts:1541-1542`

- [ ] **Step 1: Reemplazar el export**

Reemplazar:
```ts
export { GeminiRecursiveDecomposer } from "./llm/recursive/gemini-recursive-decomposer";
export type { GeminiRecursiveDecomposerOptions } from "./llm/recursive/gemini-recursive-decomposer";
```
por:
```ts
export { ClaudeCodeRecursiveDecomposer } from "./llm/recursive/claude-code-recursive-decomposer";
export type { ClaudeCodeRecursiveDecomposerOptions } from "./llm/recursive/claude-code-recursive-decomposer";
```

- [ ] **Step 2: Verificar barrel `@manyhands/core`**

Run: `git grep -n "GeminiRecursiveDecomposer" packages/core`
Si aparece un re-export explícito, renombrarlo a `ClaudeCodeRecursiveDecomposer`. Si `packages/core` hace `export * from "@manyhands/decomposer"`, no hay cambio.

- [ ] **Step 3: Test verde + typecheck**

Run: `pnpm test tests/decomposer-claude-code-recursive.test.ts`
Expected: PASS (4 tests).
Run: `pnpm -F @manyhands/decomposer typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts packages/decomposer/src/index.ts tests/decomposer-claude-code-recursive.test.ts
git commit -m "feat(decomposer): ClaudeCodeRecursiveDecomposer (CLI plan mode)"
```

---

## Fase 2 — Política de decomposer (default a Claude Code)

### Task 4: Actualizar el test de `pickDecomposer` (rojo)

**Files:**
- Modify: `tests/decomposer-policy.test.ts:16-26`

- [ ] **Step 1: Reescribir el caso default**

Reemplazar el `it("selects Gemini recursive by default without API keys", …)` por:
```ts
  it("selects Claude Code recursive by default without API keys", () => {
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "sonnet",
      workspace: { id: "ws", slug: "ws", name: "WS", repoPath: "C:/repo", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    });
    expect(selection.provider).toBe("claude-code");
    expect(selection.model).toBe("sonnet");
    expect(selection.promptTemplateVersion).toContain("recursive-decomposer");
  });
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test tests/decomposer-policy.test.ts`
Expected: FAIL — `provider` sigue siendo `"gemini"`.

### Task 5: Cambiar la rama default de `pickDecomposer` (verde)

**Files:**
- Modify: `apps/web/src/lib/decomposer-policy.ts` (import línea 1-13, type `provider` línea 23, rama default líneas 109-128)

- [ ] **Step 1: Cambiar el import**

En el `import { … } from "@manyhands/core"`: reemplazar `GeminiRecursiveDecomposer` por `ClaudeCodeRecursiveDecomposer`.

- [ ] **Step 2: Ampliar el union de provider**

Línea ~26: `provider: "anthropic" | "gemini" | "deterministic";` → `provider: "anthropic" | "claude-code" | "deterministic";`

- [ ] **Step 3: Reemplazar la construcción default (líneas 109-128)**

```ts
  const model = input.model;
  const recursive = new ClaudeCodeRecursiveDecomposer({
    cwd: input.workspace?.repoPath ?? process.cwd(),
    model,
    userPrompt: input.userPrompt,
    ...(stepTimeoutMs !== undefined ? { timeoutMs: stepTimeoutMs } : {}),
    ...(maxParallelSteps !== undefined ? { maxParallelSteps } : {}),
    ...(maxStepAttempts !== undefined ? { maxStepAttempts } : {}),
    ...(input.onStepStarted !== undefined ? { onStepStarted: input.onStepStarted } : {}),
    ...(input.onStepCompleted !== undefined ? { onStepCompleted: input.onStepCompleted } : {}),
    ...(input.onStepStatus !== undefined ? { onStepStatus: input.onStepStatus } : {}),
    ...(workspaceHints !== undefined ? { workspaceHints } : {}),
    ...(input.onCliOutput !== undefined ? { onCliOutput: input.onCliOutput } : {})
  });
  return {
    decomposer: recursive,
    provider: "claude-code",
    model,
    promptTemplateVersion: recursive.promptTemplateVersion
  };
```

- [ ] **Step 4: Actualizar el comentario** (líneas ~62-64) para que diga "el step model es el CLI de Claude Code" en vez de Gemini.

- [ ] **Step 5: Verde + typecheck + commit**

Run: `pnpm test tests/decomposer-policy.test.ts` → PASS
Run: `pnpm web:typecheck` → sin errores
```bash
git add apps/web/src/lib/decomposer-policy.ts tests/decomposer-policy.test.ts
git commit -m "feat(planning): default decomposer to Claude Code CLI"
```

---

## Fase 3 — Registry de executors (default + remoción de Gemini)

### Task 6: Actualizar el test del registry (rojo)

**Files:**
- Modify: `tests/execution-core-executor-registry.test.ts`

- [ ] **Step 1: Reescribir las aserciones que asumen Gemini**

- `normalizeExecutorSelection("gemini-2.5-flash")` y `resolveLegacyModelSelection("legacy-model")` → ahora el fallback legacy es Claude Code:
```ts
  it("maps bare model strings to the Claude Code default executor", () => {
    expect(normalizeExecutorSelection("some-model")).toEqual({
      executorId: "claude-code-cli",
      model: "some-model"
    });
    expect(resolveLegacyModelSelection("legacy-model")).toEqual({
      executorId: "claude-code-cli",
      model: "legacy-model"
    });
  });
```
- Lista de descriptors:
```ts
    expect(EXECUTOR_DESCRIPTORS.map((descriptor) => descriptor.id)).toEqual([
      "claude-code-cli",
      "codex-cli",
      "opencode-cli"
    ]);
```
- En "constructs enabled adapters…": quitar la línea de `gemini-cli` (deps y `factory.create`).
- En "reports structured usage…": quitar la línea de `gemini-cli`.

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test tests/execution-core-executor-registry.test.ts`
Expected: FAIL.

### Task 7: Quitar Gemini del registry y mover el default (verde)

**Files:**
- Modify: `packages/execution-core/src/executor/registry.ts`

- [ ] **Step 1: Editar `registry.ts`**

- Quitar `export const GEMINI_EXECUTOR_ID = "gemini-cli";`.
- Quitar `GEMINI_EXECUTOR_ID` de `EXECUTOR_IDS` (queda `[CLAUDE_CODE_EXECUTOR_ID, CODEX_EXECUTOR_ID, OPENCODE_EXECUTOR_ID]`).
- Quitar `GEMINI_CAPABILITIES` y el descriptor `gemini-cli` completo de `EXECUTOR_DESCRIPTORS`.
- `DEFAULT_EXECUTOR_SELECTION`:
```ts
export const DEFAULT_EXECUTOR_SELECTION: ExecutorSelection = {
  executorId: CLAUDE_CODE_EXECUTOR_ID,
  model: "sonnet"
};
```
- `normalizeExecutorSelection`: cambiar el branch de string suelto a `{ executorId: CLAUDE_CODE_EXECUTOR_ID, model: value }`.

- [ ] **Step 2: Quitar `GEMINI_PROFILE` del factory**

`packages/execution-core/src/executor/factory.ts`: quitar el import de `./profiles/gemini` y sacar `GEMINI_PROFILE` del array `CLI_PROFILES` (queda `[CLAUDE_CODE_PROFILE, CODEX_PROFILE]`).

- [ ] **Step 3: Borrar el profile y su test**

```bash
git rm packages/execution-core/src/executor/profiles/gemini.ts tests/execution-core-gemini-cli.test.ts
```

- [ ] **Step 4: Limpiar exports de execution-core**

Run: `git grep -n "gemini" packages/execution-core/src`
Quitar de `packages/execution-core/src/index.ts` / `executor/index.ts` cualquier `export … GEMINI_EXECUTOR_ID` o `GEMINI_PROFILE`.

- [ ] **Step 5: Verde + typecheck + commit**

Run: `pnpm test tests/execution-core-executor-registry.test.ts` → PASS
Run: `pnpm -F @manyhands/execution-core typecheck` → sin errores
```bash
git add -A packages/execution-core tests/execution-core-executor-registry.test.ts
git commit -m "feat(executors): remove Gemini CLI, default to Claude Code"
```

---

## Fase 4 — Readiness / preflight

### Task 8: Repuntar readiness de Gemini a Claude Code

**Files:**
- Modify: `apps/web/src/lib/server/providers/readiness.ts`

- [ ] **Step 1: Test (rojo)** — buscar test existente

Run: `git grep -ln "inspectGeminiReadiness\|inspectProvidersReadiness" tests`
Si hay test que afirme readiness de Gemini, actualizarlo para Claude Code primero (rojo). Si no, agregar al final de `tests/preflight.test.ts` (o crear `tests/providers-readiness.test.ts`) un caso:
```ts
it("inspects Claude Code as the primary provider", async () => {
  const providers = await inspectProvidersReadiness(null, {
    checkCli: async () => ({ ok: true, version: "claude 1.0.0" }),
    hasCredentials: () => true
  });
  expect(providers.map((p) => p.executorId)).not.toContain("gemini-cli");
  expect(providers[0]?.executorId).toBe("claude-code-cli");
});
```

- [ ] **Step 2: Editar `readiness.ts` (verde)**

- Import: quitar `GEMINI_EXECUTOR_ID` de `@manyhands/execution-core`.
- Borrar `inspectGeminiReadiness` **o** renombrarla a `inspectPrimaryProviderReadiness` repuntando a `CLAUDE_CODE_EXECUTOR_ID` (revisar consumidores con `git grep -n inspectGeminiReadiness`).
- `defaultHasCredentials`: borrar el branch `GEMINI_EXECUTOR_ID` (queda Claude Code + el default `false`); agregar Codex si corresponde (Codex usa `~/.codex/auth.json` / `OPENAI_API_KEY` — verificar y, si no hay señal clara, dejar el default `false`).
- `authMessageFor`: borrar el branch de Gemini.

- [ ] **Step 3: Actualizar `preflight.ts`**

Run: `git grep -n "gemini\|GEMINI" apps/web/src/lib/server/runs/preflight.ts`
Reemplazar referencias al binario/descriptor de Gemini por Claude Code; si preflight elige executor por default, debe resolver a `DEFAULT_EXECUTOR_SELECTION`.

- [ ] **Step 4: Verde + typecheck + commit**

Run: `pnpm web:typecheck` y los tests tocados → PASS
```bash
git add apps/web/src/lib/server/providers/readiness.ts apps/web/src/lib/server/runs/preflight.ts tests/
git commit -m "feat(readiness): inspect Claude Code/Codex instead of Gemini"
```

---

## Fase 5 — UI: listas de modelos y pricing

### Task 9: Quitar modelos Gemini de la UI y default a Claude

**Files (descubrir con grep):**
- `apps/web/src/lib/models.ts`, `apps/web/src/lib/model-pricing.ts`, `apps/web/src/lib/live-graph.ts`, `apps/web/src/lib/decomposer-policy.ts` (ya hecho), y cualquier selector.

- [ ] **Step 1: Mapear referencias**

Run: `git grep -nE "gemini-2\.5|gemini-cli|Gemini" apps/web/src/lib apps/web/src/components apps/web/src/app`

- [ ] **Step 2: Test (rojo) sobre el registro de modelos UI**

Abrir `tests/model-registry.test.ts`; actualizar las aserciones que esperan modelos/IDs Gemini para esperar Claude Code (`sonnet`/`haiku`/`opus`) y Codex (`gpt-5-codex`/`gpt-5`) y que el default sea Claude Code. Correr para ver rojo:
Run: `pnpm test tests/model-registry.test.ts` → FAIL

- [ ] **Step 3: Editar las fuentes (verde)**

En cada archivo del Step 1: remover entradas/labels/pricing de `gemini-2.5-pro` / `gemini-2.5-flash` y cualquier `defaultModel` que apunte a Gemini → Claude Code `sonnet`. Mantener el shape de los objetos existentes (no inventar campos nuevos).

- [ ] **Step 4: Verde + typecheck + commit**

Run: `pnpm test tests/model-registry.test.ts` → PASS
Run: `pnpm web:typecheck` → sin errores
```bash
git add -A apps/web/src tests/model-registry.test.ts
git commit -m "feat(ui): drop Gemini models, default to Claude Code"
```

---

## Fase 6 — Borrar el decomposer de Gemini y refs residuales

### Task 10: Eliminar `gemini-recursive-decomposer.ts` y `MANYHANDS_GEMINI_BIN`

**Files:**
- Delete: `packages/decomposer/src/llm/recursive/gemini-recursive-decomposer.ts`, `tests/decomposer-gemini-recursive.test.ts`

- [ ] **Step 1: Borrar archivos**

```bash
git rm packages/decomposer/src/llm/recursive/gemini-recursive-decomposer.ts tests/decomposer-gemini-recursive.test.ts
```

- [ ] **Step 2: Barrer referencias residuales**

Run: `git grep -nE "MANYHANDS_GEMINI_BIN|GeminiRecursiveDecomposer|gemini-recursive|GeminiCliExecutor"`
Resolver cada hit en código (no-docs): borrar o repuntar a Claude Code. Quedan permitidos solo los hits en `docs/` (se tratan en Fase 7) y en este plan/spec.

- [ ] **Step 3: Suite completa (verde)**

Run: `pnpm test`
Expected: PASS (toda la suite).
Run: `pnpm -F @manyhands/decomposer typecheck && pnpm -F @manyhands/execution-core typecheck && pnpm web:typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove Gemini decomposer and residual references"
```

---

## Fase 7 — Docs + ADR

### Task 11: ADR de reemplazo y actualización de docs

**Files:**
- Create: `docs/adr/0031-claude-code-and-codex-executors.md`
- Modify: `docs/system/06-gemini-executor.md` (renombrar a `06-agent-executors.md`), `docs/DECISIONS.md`, `docs/development/architecture.md`, `README.md`, `apps/web/README.md`, `packages/execution-core/README.md`, `packages/decomposer/README.md`, `CLAUDE.md`, `AGENTS.md`.

- [ ] **Step 1: Escribir el ADR**

`docs/adr/0031-claude-code-and-codex-executors.md`: Status Accepted; "Supersedes ADR-0029 (Gemini CLI executor)". Contexto: deprecación de gemini-cli (2026-06-18) y la inviabilidad de Antigravity CLU por el bug headless de stdout (Issue #76). Decisión: Claude Code (default, `claude -p --output-format json`) + Codex (`codex exec`) como executors; `ClaudeCodeRecursiveDecomposer` (plan mode) como decomposer default. Consecuencias y tabla de migración Gemini→Claude/Codex.

- [ ] **Step 2: Marcar ADR-0029 como superseded**

Editar el header de `docs/adr/0029-gemini-cli-executor.md`: `Status: Superseded by ADR-0031`.

- [ ] **Step 3: Actualizar docs vivas**

Run: `git grep -nE "Gemini CLI|gemini-cli|GeminiRecursiveDecomposer|gemini -p" docs README.md apps/web/README.md packages CLAUDE.md AGENTS.md`
Reescribir cada referencia operativa a Claude Code/Codex. En `docs/DECISIONS.md`, actualizar la decisión que fija Gemini como executor (D4) a Claude Code + Codex, dejando la historia de Gemini como superseded.

- [ ] **Step 4: Revisión de links/términos + commit**

Run: `git grep -nE "Gemini|gemini" docs CLAUDE.md AGENTS.md README.md` y confirmar que solo quedan menciones históricas (ADR-0029, este spec/plan).
```bash
git add -A docs README.md apps/web/README.md packages CLAUDE.md AGENTS.md
git commit -m "docs: replace Gemini executor docs with Claude Code + Codex (ADR-0031)"
```

---

## Fase 8 — Verificación final

### Task 12: Build + suite completa + smoke real

- [ ] **Step 1: Verificación amplia**

Run: `pnpm test` → PASS
Run: `pnpm -F @manyhands/execution-core typecheck && pnpm -F @manyhands/decomposer typecheck && pnpm web:typecheck` → sin errores
Run: `pnpm build` → OK

- [ ] **Step 2: Grep de regresión**

Run: `git grep -nE "gemini-cli|GEMINI_EXECUTOR_ID|GeminiRecursiveDecomposer|MANYHANDS_GEMINI_BIN"`
Expected: cero hits en código; solo docs históricas (ADR-0029) y este plan/spec.

- [ ] **Step 3: Smoke real del decomposer (manual)**

Con `claude` autenticado, correr un decompose real (vía la API de runs o un script mínimo que instancie `ClaudeCodeRecursiveDecomposer` con `cwd` de un repo y `spawn` real) y confirmar que `claude -p --output-format json --permission-mode plan` devuelve el JSON del step en `.result` y el grafo se reconstruye. Documentar el resultado.

- [ ] **Step 4: Commit final (si quedó algo)**

```bash
git add -A && git commit -m "chore: finalize Gemini→Claude Code/Codex migration"
```

---

## Self-review (cobertura del spec)

- Componente nuevo `ClaudeCodeRecursiveDecomposer` → Fase 1. ✅
- Default exec Claude Code/sonnet + legacy fallback → Fase 3. ✅
- Planning default Claude Code, baselines API intactos → Fase 2. ✅
- Remoción profile/decomposer/env/tests Gemini → Fases 3, 6. ✅
- Readiness/preflight → Fase 4. ✅
- Pricing/UI → Fase 5. ✅
- Docs/ADR → Fase 7. ✅
- Verificación (`pnpm test`/typechecks/build) + smoke → Fase 8. ✅
- Codex execution-only (sin decomposer) → respetado (no se crea decomposer de Codex). ✅
