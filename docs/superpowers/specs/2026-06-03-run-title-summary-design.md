# LLM-Generated Run Title & Summary — Design Spec

**Date:** 2026-06-03
**Status:** Approved (approach A)

---

## Problema

Al crear un run, el título es `userPrompt.slice(0, 120)` (el prompt crudo cortado) y la descripción mostrada es `run.userPrompt` (el prompt crudo entero). Se ve mal — un volcado del prompt en vez de un título y resumen prolijos. El usuario quiere que un LLM escriba ambos.

## Enfoque elegido (A): titler dedicado, async durante el planning

Un componente aislado ("run titler") hace una llamada corta a **Gemini CLI** (`--approval-mode plan`, read-only, sin repo) que convierte el prompt del usuario en `{ title, summary }`. Corre como **primer paso** del planning pipeline, persiste los campos en el `RunRecord` y emite un evento SSE para que la UI se actualice en vivo.

- La creación del run (`POST /api/runs`) **no cambia**: sigue siendo instantánea y el título inicial sigue siendo el prompt truncado (placeholder hasta que el titler responde, ~1-2s).
- **No toca** los artifacts de tesis (decomposer/composer).
- **Fallback cosmético:** si el titler falla, el run NO falla — se conserva el título truncado actual y la descripción cae al `userPrompt`. Esto es presentación, no aplica el D3 estricto (que es para la generación del grafo).

## Componentes

### 1. `run-titler.ts` (nuevo) — `apps/web/src/lib/server/runs/`

Módulo con una sola responsabilidad: dado un prompt y un modelo, devolver `{ title, summary }`.

- `generateRunTitle(input: { userPrompt: string; model: string; binaryPath?: string; timeoutMs?: number; spawn?: SpawnFn }): Promise<{ title: string; summary: string }>`
- Invoca Gemini CLI con el mismo patrón que `GeminiRecursiveDecomposer`: `spawn(bin, ["--model", model, "--approval-mode", "plan", "-o", "text", "-p", STDIN_DIRECTIVE], …)`, prompt completo por stdin, `extractJson` sobre el stdout.
- Prompt: pide JSON `{ "title": string, "summary": string }`. Título ≤ 8 palabras, sin comillas ni markdown, en el idioma del prompt. Summary: 1-2 oraciones que describan qué construye el run, en lenguaje natural.
- Valida la salida con un Zod schema `RunTitleSchema` (`title` 1-80 chars, `summary` 1-400 chars). Si el parse falla o el proceso falla/timeout → lanza un error tipado `RunTitlerError`.
- Timeout default: 30s (más corto que el del decomposer; es una llamada chica).
- Binario: `MANYHANDS_GEMINI_BIN` (igual que el resto).

### 2. Schema — `apps/web/src/lib/server/runs/schema.ts`

- Agregar `summary: z.string().max(400).optional()` a `RunRecordSchema`.
- No se agrega a `RunCreateRequestSchema` (es generado, no viene del cliente).

### 3. API types — `apps/web/src/lib/api-types.ts`

- `RunResponse.run`: agregar `summary?: string`.
- `RunPreview`: agregar `summary?: string`.

### 4. Presenter — `apps/web/src/lib/server/runs/presenter.ts`

- `toRunResponse`: copiar `run.summary` si está presente.
- `toRunPreview`: copiar `run.summary` si está presente.

### 5. Planning pipeline — `apps/web/src/lib/server/runs/runner.ts`

Dentro de `runPlanningPipeline`, después de transicionar a `generating` y **antes** de arrancar la decomposición (para que el título limpio aparezca lo antes posible, mientras el grafo todavía se está generando):

```
const titler = await generateRunTitle({ userPrompt: run.userPrompt, model: run.model })
  .catch(() => null);
if (titler !== null) {
  run = await getRunRepository().save({ ...run, title: titler.title, summary: titler.summary });
  publishRunEvent(run.runId, { kind: "title.updated", title: titler.title, summary: titler.summary, at: ... });
}
```

- El `.catch(() => null)` implementa el fallback cosmético: un titler fallido no rompe el planning.
- Se ejecuta una sola vez por run. Si el run ya tiene `summary` (re-planning / interrupted resume), se saltea para no regenerar.

### 6. Evento SSE — `apps/web/src/lib/server/runs/events.ts`

- Agregar a `RunEvent` un kind `title.updated` con `{ title: string; summary: string }`.
- El cliente (live run hook) ya re-fetchea el run ante eventos; alcanza con que el evento dispare un refresh. Si el hook discrimina por kind, agregar el caso para actualizar título/summary en el estado local. (Se confirma al leer `RunCanvasShell`/`useLiveRun` en el plan.)

### 7. UI

- **`run-header.tsx`**: el `<h1>` ya muestra `run.title` (ahora limpio). El párrafo de descripción pasa a mostrar `run.summary ?? run.userPrompt`. El prompt crudo sigue disponible en el RunRecord.
- **`recent-runs-strip.tsx`**: ya usa `run.title`; sin cambio funcional (mejora gratis al venir limpio).

## Decisiones de diseño

- **Modelo:** reusar `run.model` (consistencia, sin config nueva). Un título no necesita el modelo más fuerte, pero reusar el seleccionado evita superficie de configuración extra.
- **Idioma:** el titler respeta el idioma del prompt (instrucción explícita en el prompt del titler), porque Francisco escribe en español.
- **El prompt crudo no se pierde:** `run.userPrompt` se conserva intacto; solo cambia qué se muestra como descripción.
- **Aislamiento:** el titler es un módulo independiente, testeable con un `spawn` inyectado (igual que el decomposer), sin invocar Gemini real en tests.

## Testing

- Test unitario de `generateRunTitle` con un `spawn` fake que emite JSON válido → `{ title, summary }` parseado.
- Test de `spawn` fake que emite JSON inválido → `RunTitlerError`.
- Test de `spawn` fake que falla (exit ≠ 0) → `RunTitlerError`.
- Test del planning pipeline: con un titler inyectado/fake que devuelve un título, el `RunRecord` persiste `title`+`summary` y se emite `title.updated`; con un titler que lanza, el run sigue a `needs_review` con el título original (fallback).
- Schema test: `RunRecordSchema` acepta `summary` opcional.

## Fuera de alcance

- Regenerar el título manualmente desde la UI (botón "regenerar título"). Posible follow-up.
- Editar el título/summary a mano. Posible follow-up.
- Usar un modelo distinto/fijo para el titler.
