# LLM-Generated Run Title & Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el título y la descripción de un run sean generados por Gemini (limpios) en vez de ser el prompt crudo cortado.

**Architecture:** Un módulo aislado `run-titler.ts` invoca Gemini CLI (read-only) para convertir el prompt en `{ title, summary }`. Corre como primer paso del planning pipeline (async, con fallback cosmético), persiste los campos en el RunRecord y emite un evento SSE `title.updated` que dispara un refresh de la UI server-rendered.

**Tech Stack:** TypeScript, Next.js, Zod, Gemini CLI, Vitest.

---

### Task 1: Módulo `run-titler.ts` + tests unitarios

**Files:**
- Create: `apps/web/src/lib/server/runs/run-titler.ts`
- Create: `tests/run-titler.test.ts`

- [ ] **Step 1: Escribir el test failing**

Crear `tests/run-titler.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { generateRunTitle, RunTitlerError } from "@/lib/server/runs/run-titler";

/**
 * Fake child process matching the subset of the node:child_process API that
 * the titler's spawn uses: stdout/stderr `.on("data")`, `.on("error"|"close")`,
 * stdin `.on("error")` + `.end()`, and `.kill()`.
 */
function makeFakeSpawn(opts: { stdout?: string; stderr?: string; exitCode?: number; emitError?: Error }) {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter & { end: (data?: string) => void };
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const stdin = new EventEmitter() as EventEmitter & { end: (data?: string) => void };
    stdin.end = () => undefined;
    child.stdin = stdin;
    child.kill = () => undefined;
    // Emit asynchronously so listeners are attached first.
    setImmediate(() => {
      if (opts.emitError !== undefined) {
        child.emit("error", opts.emitError);
        return;
      }
      if (opts.stdout !== undefined) child.stdout.emit("data", Buffer.from(opts.stdout, "utf8"));
      if (opts.stderr !== undefined) child.stderr.emit("data", Buffer.from(opts.stderr, "utf8"));
      child.emit("close", opts.exitCode ?? 0);
    });
    return child as never;
  };
}

describe("generateRunTitle", () => {
  it("parses a clean title and summary from direct JSON output", async () => {
    const spawn = makeFakeSpawn({
      stdout: JSON.stringify({ title: "Habit counter mini-app", summary: "Una mini-app que crea, lista y resetea hábitos, persistidos en localStorage." })
    });
    const result = await generateRunTitle({ userPrompt: "Construí una mini-app...", model: "gemini-2.5-pro", spawn });
    expect(result.title).toBe("Habit counter mini-app");
    expect(result.summary).toContain("hábitos");
  });

  it("unwraps the Gemini CLI `response` envelope", async () => {
    const inner = JSON.stringify({ title: "Task API DELETE", summary: "Implementa DELETE /tasks/:id con persistencia y tests." });
    const spawn = makeFakeSpawn({ stdout: JSON.stringify({ response: inner }) });
    const result = await generateRunTitle({ userPrompt: "Implement DELETE", model: "m", spawn });
    expect(result.title).toBe("Task API DELETE");
  });

  it("throws RunTitlerError on non-zero exit", async () => {
    const spawn = makeFakeSpawn({ stdout: "", stderr: "boom", exitCode: 1 });
    await expect(generateRunTitle({ userPrompt: "x", model: "m", spawn })).rejects.toBeInstanceOf(RunTitlerError);
  });

  it("throws RunTitlerError when no parseable JSON is produced", async () => {
    const spawn = makeFakeSpawn({ stdout: "I could not produce JSON." });
    await expect(generateRunTitle({ userPrompt: "x", model: "m", spawn })).rejects.toBeInstanceOf(RunTitlerError);
  });

  it("throws RunTitlerError on spawn error", async () => {
    const spawn = makeFakeSpawn({ emitError: new Error("ENOENT") });
    await expect(generateRunTitle({ userPrompt: "x", model: "m", spawn })).rejects.toBeInstanceOf(RunTitlerError);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run tests/run-titler.test.ts`
Expected: FAIL con "Cannot find module '@/lib/server/runs/run-titler'".

- [ ] **Step 3: Implementar el módulo**

Crear `apps/web/src/lib/server/runs/run-titler.ts`:

```ts
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { z } from "zod";

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const DEFAULT_TIMEOUT_MS = 30_000;
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Short directive passed via `-p`. Gemini CLI only enters non-interactive mode
 * when `--prompt` has a non-empty value; the real instructions go over stdin.
 */
const STDIN_DIRECTIVE = "Follow-titling-instructions-on-stdin";

export const RunTitleSchema = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(400)
});

export type RunTitle = z.infer<typeof RunTitleSchema>;

export class RunTitlerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RunTitlerError";
  }
}

export interface GenerateRunTitleInput {
  userPrompt: string;
  model: string;
  cwd?: string;
  binaryPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  useShell?: boolean;
}

/**
 * Turns a raw user prompt into a clean `{ title, summary }` using Gemini CLI in
 * read-only planning mode. Pure presentation concern — never touches the repo
 * and never participates in graph generation. Callers treat failures as
 * non-fatal (cosmetic fallback to the raw prompt).
 */
export async function generateRunTitle(input: GenerateRunTitleInput): Promise<RunTitle> {
  const binaryPath = input.binaryPath ?? process.env.MANYHANDS_GEMINI_BIN ?? "gemini";
  const spawnFn = input.spawn ?? nodeSpawn;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useShell = input.useShell ?? process.platform === "win32";
  const cwd = input.cwd ?? process.cwd();

  const prompt = buildTitlerPrompt(input.userPrompt);
  const args = ["--model", input.model, "--approval-mode", "plan", "--skip-trust", "-o", "json", "-p", STDIN_DIRECTIVE];

  const outcome = await runProcess({ binaryPath, args, cwd, prompt, timeoutMs, spawnFn, useShell });

  if (outcome.timedOut) {
    throw new RunTitlerError(`Run titler timed out after ${timeoutMs}ms`);
  }
  if (outcome.exitCode !== 0) {
    throw new RunTitlerError(`Run titler failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`);
  }

  const candidate = extractTitleSummary(outcome.stdout);
  if (candidate === null) {
    throw new RunTitlerError(`Run titler produced no parseable JSON. Raw output:\n${outcome.stdout}`);
  }
  const parsed = RunTitleSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RunTitlerError(`Run titler output did not match schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

function buildTitlerPrompt(userPrompt: string): string {
  return [
    "## System",
    "You write a short title and a clean one-paragraph summary for a software task.",
    "CRITICAL: Do NOT call any tools. Do not read files, do not run commands. Analyze only the text below.",
    "Respond with STRICTLY a JSON object and nothing else: {\"title\": string, \"summary\": string}.",
    "Rules:",
    "- title: at most 8 words, no quotes, no markdown, no trailing punctuation.",
    "- summary: 1-2 sentences describing what the task builds, in natural prose.",
    "- Write both in the SAME LANGUAGE as the task description below.",
    "",
    "## Task description",
    userPrompt
  ].join("\n");
}

interface ProcessOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(input: {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  useShell: boolean;
}): Promise<ProcessOutcome> {
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

    const finish = (outcome: ProcessOutcome): void => {
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
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      finish({ exitCode: SPAWN_FAILURE_EXIT_CODE, stdout, stderr: stderr + (stderr ? "\n" : "") + error.message, timedOut: false });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, stdout, stderr, timedOut: false });
    });

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.prompt);
  });
}

/** First balanced `{...}` object in a string, or null. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extracts the `{ title, summary }` object from Gemini CLI stdout, tolerating
 * the `-o json` envelope (`{"response":"<inner json string>"}`) and direct
 * JSON.
 */
function extractTitleSummary(stdout: string): unknown {
  const outer = firstJsonObject(stdout);
  if (outer === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outer);
  } catch {
    return null;
  }
  if (parsed !== null && typeof parsed === "object" && "title" in parsed) {
    return parsed;
  }
  if (parsed !== null && typeof parsed === "object" && "response" in parsed && typeof (parsed as { response: unknown }).response === "string") {
    const inner = firstJsonObject((parsed as { response: string }).response);
    if (inner === null) return null;
    try {
      return JSON.parse(inner);
    } catch {
      return null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run tests/run-titler.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/runs/run-titler.ts tests/run-titler.test.ts
git commit -m "feat(web): add run-titler — Gemini-generated title and summary"
```

---

### Task 2: Campo `summary` en el schema del RunRecord

**Files:**
- Modify: `apps/web/src/lib/server/runs/schema.ts`
- Modify: `tests/run-record-schema.test.ts`

- [ ] **Step 1: Escribir el test failing**

En `tests/run-record-schema.test.ts`, agregar dentro del `describe("run-record schema", ...)` (después del test `"rejects unknown status"`):

```ts
  it("accepts an optional LLM-generated summary", () => {
    const parsed = RunRecordSchema.safeParse({ ...baseRun, summary: "Una mini-app de hábitos con persistencia local." });
    expect(parsed.success).toBe(true);
  });

  it("rejects a summary over 400 chars", () => {
    const parsed = RunRecordSchema.safeParse({ ...baseRun, summary: "x".repeat(401) });
    expect(parsed.success).toBe(false);
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run tests/run-record-schema.test.ts`
Expected: FAIL — el segundo test falla porque sin la constraint el summary de 401 chars se acepta.

- [ ] **Step 3: Implementar el campo**

En `apps/web/src/lib/server/runs/schema.ts`, dentro de `RunRecordSchema`, agregar el campo justo después de `title`:

```ts
  title: z.string().min(1).max(160),
  /** LLM-generated one-paragraph description. Falls back to userPrompt in the UI. */
  summary: z.string().max(400).optional(),
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run tests/run-record-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/runs/schema.ts tests/run-record-schema.test.ts
git commit -m "feat(web): add optional summary field to RunRecord schema"
```

---

### Task 3: Propagar `summary` en api-types y presenter

**Files:**
- Modify: `apps/web/src/lib/api-types.ts`
- Modify: `apps/web/src/lib/server/runs/presenter.ts`

- [ ] **Step 1: Agregar el campo a los tipos de API**

En `apps/web/src/lib/api-types.ts`:

En `RunPreview`, después de `userPrompt: string;`:

```ts
  userPrompt: string;
  summary?: string | undefined;
```

En `RunResponse.run`, después de `userPrompt: string;`:

```ts
    userPrompt: string;
    summary?: string;
```

- [ ] **Step 2: Copiar el campo en el presenter**

En `apps/web/src/lib/server/runs/presenter.ts`:

En `toRunResponse`, junto a los demás `if (run.X !== undefined) payload.X = run.X;` (después de la línea de `pausedDuring`):

```ts
  if (run.summary !== undefined) payload.summary = run.summary;
```

En `toRunPreview`, dentro del objeto `preview` inicial, después de `userPrompt: run.userPrompt,`:

```ts
    userPrompt: run.userPrompt,
    summary: run.summary,
```

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm web:typecheck`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api-types.ts apps/web/src/lib/server/runs/presenter.ts
git commit -m "feat(web): expose run summary in API response and preview"
```

---

### Task 4: Evento SSE `title.updated`

**Files:**
- Modify: `apps/web/src/lib/server/runs/events.ts`

- [ ] **Step 1: Agregar el kind, la interface y el miembro del union**

En `apps/web/src/lib/server/runs/events.ts`:

Agregar `"title.updated"` al union `RunEventKind` (después de `"status.changed"`):

```ts
export type RunEventKind =
  | "status.changed"
  | "title.updated"
```

Agregar la interface (después de `StatusChangedEvent`):

```ts
export interface TitleUpdatedEvent extends RunEventBase {
  kind: "title.updated";
  title: string;
  summary: string;
}
```

Agregar al union `RunEvent` (después de `StatusChangedEvent`):

```ts
export type RunEvent =
  | StatusChangedEvent
  | TitleUpdatedEvent
```

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm web:typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/runs/events.ts
git commit -m "feat(web): add title.updated SSE event"
```

---

### Task 5: Cablear el titler en el planning pipeline

**Files:**
- Modify: `apps/web/src/lib/server/runs/runner.ts`
- Modify: `tests/run-runner.test.ts`

- [ ] **Step 1: Escribir el test failing**

En `tests/run-runner.test.ts`, agregar un test que verifica que un titler inyectado actualiza el RunRecord. Primero, importar el tipo de opciones (ya se importa `runPlanningPipeline`? — en el cleanup se quitó). Agregar `runPlanningPipeline` al import existente de `@/lib/server/runs/runner`:

```ts
import {
  runExecutionPipeline,
  runPlanningPipeline,
  type ExecutionEngine
} from "@/lib/server/runs/runner";
```

Agregar este test dentro del `describe("RunRunner", ...)`:

```ts
  it("applies an injected titler to the run record during planning", async () => {
    const runId = `${runIdBase}-titler`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "claude-opus-4.7",
      userPrompt: "Construí una mini-app de hábitos con persistencia local.",
      title: "Construí una mini-app de hábitos con persistencia local.",
      status: "created",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      patches: []
    });

    await runPlanningPipeline(runId, {
      intervalMs: 0,
      titler: async () => ({ title: "Habit counter", summary: "Mini-app de hábitos con persistencia local." }),
      // A decomposer stub so planning does not shell out to Gemini.
      decomposerFactory: () => stubDecomposerSelection()
    }).catch(() => undefined);

    const finalRun = await store.get(runId);
    expect(finalRun.title).toBe("Habit counter");
    expect(finalRun.summary).toBe("Mini-app de hábitos con persistencia local.");
  }, 30000);
```

> NOTE: `decomposerFactory`/`stubDecomposerSelection` may not exist as a seam. If injecting a decomposer is not already supported by `PlanningRunnerOptions`, this test must instead assert ONLY the titler effect by letting the decomposition fail fast (no Gemini available) — the titler runs first and persists before decomposition is attempted. In that case drop the `decomposerFactory` line and assert `finalRun.title`/`finalRun.summary` are updated even though the run ultimately ends `failed`. Confirm which path is real when implementing (read `pickDecomposer` and `PlanningRunnerOptions`), and keep the test asserting the titler effect either way.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run tests/run-runner.test.ts`
Expected: FAIL — `titler` is not a known option on `PlanningRunnerOptions`.

- [ ] **Step 3: Implementar el seam y la llamada**

En `apps/web/src/lib/server/runs/runner.ts`:

Importar el titler (junto a los otros imports locales):

```ts
import { generateRunTitle, type RunTitle } from "./run-titler";
```

Extender `PlanningRunnerOptions`:

```ts
export interface PlanningRunnerOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the real Gemini-backed titler. */
  titler?: (input: { userPrompt: string; model: string }) => Promise<RunTitle>;
}
```

Dentro de `runPlanningPipeline`, después de la transición a `generating` (después del bloque `if (run.status === "created" || run.status === "interrupted") { run = await transitionTo(...) }`) y antes de construir `livePlanningNodes`, insertar:

```ts
    // Generate a clean title + summary before decomposition so the workspace
    // header reads well while the graph is still generating. Cosmetic: a
    // titler failure must NOT fail the run (this is presentation, not D3).
    if (run.summary === undefined) {
      const titleFn = options.titler ?? ((input) => generateRunTitle(input));
      const runTitle = await titleFn({ userPrompt: run.userPrompt, model: run.model }).catch((error) => {
        console.warn(`[Runner] Titler skipped for run ${run.runId}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (runTitle !== null) {
        run = await getRunRepository().save({ ...run, title: runTitle.title, summary: runTitle.summary });
        publishRunEvent(run.runId, {
          kind: "title.updated",
          title: runTitle.title,
          summary: runTitle.summary,
          at: new Date().toISOString()
        });
      }
    }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run tests/run-runner.test.ts`
Expected: PASS. (If the `decomposerFactory` seam does not exist, follow the NOTE in Step 1 and assert the titler effect with the run ending `failed`.)

- [ ] **Step 5: Verificar typecheck**

Run: `pnpm web:typecheck`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/runs/runner.ts tests/run-runner.test.ts
git commit -m "feat(web): run titler as first planning step, persist title+summary"
```

---

### Task 6: UI — refresh ante title.updated + mostrar summary

**Files:**
- Modify: `apps/web/src/components/dag/RunCanvasShell.tsx`
- Modify: `apps/web/src/app/runs/[runId]/_components/run-header.tsx`

- [ ] **Step 1: Manejar `title.updated` en el live hook**

En `apps/web/src/components/dag/RunCanvasShell.tsx`, dentro de `es.onmessage`, agregar una rama al final de la cadena `if/else if` (después del bloque `else if (event.kind === "status.changed" ...)`):

```ts
        } else if (event.kind === "title.updated") {
          // Title/summary are server-rendered in the header; re-fetch to show them.
          router.refresh();
        }
```

- [ ] **Step 2: Mostrar el summary en el header**

En `apps/web/src/app/runs/[runId]/_components/run-header.tsx`, reemplazar el bloque del párrafo de descripción que hoy muestra `run.userPrompt`:

```tsx
          {run.userPrompt.length > 0 ? (
            <p
              style={{
                margin: "9px 0 0",
                maxWidth: 980,
                fontSize: 13.5,
                color: "var(--text-2)",
                lineHeight: 1.55
              }}
            >
              {run.userPrompt}
```

por la versión que prefiere el summary:

```tsx
          {(run.summary ?? run.userPrompt).length > 0 ? (
            <p
              style={{
                margin: "9px 0 0",
                maxWidth: 980,
                fontSize: 13.5,
                color: "var(--text-2)",
                lineHeight: 1.55
              }}
            >
              {run.summary ?? run.userPrompt}
```

(Solo cambian las dos líneas: la condición y el contenido del `<p>`. El resto del bloque — el cierre `</p>` y el `) : null}` — queda igual.)

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm web:typecheck`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/dag/RunCanvasShell.tsx apps/web/src/app/runs/[runId]/_components/run-header.tsx
git commit -m "feat(web): refresh header on title.updated and show summary as description"
```

---

### Task 7: Verificación final

- [ ] **Step 1: Tests completos**

Run: `pnpm test`
Expected: todos pasan (los nuevos + los existentes, ~349 passing).

- [ ] **Step 2: Typecheck web**

Run: `pnpm web:typecheck`
Expected: 0 errores.

- [ ] **Step 3: Build web**

Run: `pnpm web:build`
Expected: compila sin errores.

- [ ] **Step 4: Commit final si quedó algo suelto**

```bash
git status
```
