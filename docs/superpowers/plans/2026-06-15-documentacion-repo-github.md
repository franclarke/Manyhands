# Plan de Implementación — Documentación del Repositorio (GitHub, cara a reclutadores)

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Goal:** Dejar la documentación del proyecto pulida, veraz (alineada al código real) y completa, con un `README.md` raíz vendedor en español, READMEs por paquete, identidad visual propia y `docs/` normalizada a español.

**Architecture:** Trabajo en seis fases secuenciales con dependencia: (0) auditoría doc-vs-código que produce un mapa de drift, (1) identidad visual, (2) README raíz, (3) READMEs por paquete, (4) normalización/actualización de `docs/`, (5) capturas de la UI, (6) verificación. Cada fase commitea de forma independiente.

**Tech Stack:** Markdown (GFM + GitHub admonitions), SVG (logo), monorepo pnpm + TypeScript, Next.js (apps/web), Puppeteer (capturas vía harness existente).

**Idioma:** Todo en **español** (READMEs, `docs/`). El código, nombres de API y términos técnicos permanecen en inglés.

---

## Decisiones fijadas (contexto de diseño)

- **Idioma de READMEs y `docs/`:** español. Normalizar `docs/system/` (hoy en inglés) a español.
- **Logo:** crear un SVG minimalista en la línea "ember sobre grafito" (ver memoria `design-system-ember`).
- **Alcance de READMEs por paquete:** `decomposer`, `execution-core`, `orchestrator-graph`, `task-graph`, `contracts`, `scheduler`, `conflict-risk`, `repository-index`, `run-store`, `trace-store`, `apps/web`. Se excluye `core` (legacy). `shared` recibe un README mínimo.
- **Restricciones de estilo del README (de la skill aportada por el usuario):** conciso y al grano; no abusar de emojis; GFM; usar [GitHub admonitions](https://github.com/orgs/community/discussions/16925) donde corresponda; **no** incluir secciones LICENSE/CONTRIBUTING/CHANGELOG (van en archivos dedicados); usar el logo en el header.

## Gotchas del repo (leer antes de ejecutar)

> [!WARNING]
> - **No** correr `pnpm test` / `web:typecheck` / `build` mientras `pnpm web:dev` está corriendo: dispara una race de `tsup --clean` y deja errores transitorios + overlay de Next pegado (memoria `dev-server-tsup-clean-race`).
> - Si un build falla raro, revisar espacio en disco: borrar `apps/web/.next` (~600 MB) recupera C: (memoria `dev-disk-full-next-cache`).
> - Capturas de UI: usar el harness `ui-shots.mjs` / `ui-shot-crop.mjs` (puppeteer-core + Chrome del sistema, `MSYS_NO_PATHCONV=1`). El MCP de preview es poco confiable para esto (memoria `ui-screenshot-harness`).
> - La UI es español + tema oscuro cálido por defecto (memoria `product_ui_language_theme`): asegurar ese tema en las capturas.

## Fuentes de verdad a consumir (no reinventar)

- `docs/development/product-vision.md`, `docs/development/architecture.md`
- `docs/DECISIONS.md` (D1–D14)
- `docs/system/01..11` (walkthrough técnico actual)
- `docs/design/` (modelo agent-first, run-operative-model)
- `CLAUDE.md` (invariantes), `MEMORY.md` (decisiones de producto)
- El código real de cada paquete (`packages/*/src/index.ts` y módulos principales)

---

## File Structure

Archivos creados/modificados, agrupados por responsabilidad:

**Auditoría (nuevo):**
- Create: `docs/development/doc-audit.md` — mapa doc-vs-código (insumo de las fases siguientes; puede archivarse al final).

**Identidad visual (nuevo):**
- Create: `.github/assets/logo.svg` — logo principal (icono + wordmark).
- Create: `.github/assets/logo-mark.svg` — solo icono (favicon/avatar).
- Create: `.github/assets/banner.svg` — opcional, header del README.

**README raíz (nuevo):**
- Create: `README.md`

**READMEs por paquete (nuevos):**
- Create: `packages/{decomposer,execution-core,orchestrator-graph,task-graph,contracts,scheduler,conflict-risk,repository-index,run-store,trace-store,shared}/README.md`
- Create: `apps/web/README.md`

**docs/ internas (modificar):**
- Modify: `docs/system/01..11` (traducir a español + corregir drift detectado en Fase 0)
- Modify: `docs/design/*` (normalizar idioma + corregir drift)
- Modify: `docs/development/architecture.md`, `product-vision.md` (corregir drift; ya en inglés → traducir)

**Capturas (nuevo):**
- Create: `.github/assets/screenshots/*.png`

---

## Task 0 — Auditoría doc-vs-código

**Objetivo:** producir un inventario que diga, por cada documento y por cada paquete, qué está *correcto*, *desactualizado*, *faltante* o *sobrante* respecto al código real. Es el insumo que evita escribir READMEs sobre supuestos.

**Files:**
- Create: `docs/development/doc-audit.md`
- Read (paquetes): `packages/*/src/index.ts` + módulos principales de cada uno
- Read (docs): `docs/system/01..11`, `docs/development/architecture.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Inventariar la API real de cada paquete**

Por cada paquete activo, leer su `src/index.ts` (exports públicos) y anotar: responsabilidad real, exports principales (tipos/funciones/clases), de qué paquetes depende. Registrar en una tabla por paquete.

- [ ] **Step 2: Contrastar cada doc de `docs/system/` con el código**

Por cada `docs/system/0X-*.md`, verificar que nombres de módulos, tipos, flujos y decisiones citadas existan en el código actual. Marcar discrepancias concretas (símbolo citado que ya no existe, flujo cambiado, etc.).

- [ ] **Step 3: Detectar faltantes y sobrantes**

Listar: conceptos del código sin doc (faltante) y docs que describen mecanismos retirados (sobrante — p. ej. referencias a Lab Mode / mock-v0 / replay que `DECISIONS.md` marca como superseded).

- [ ] **Step 4: Escribir `doc-audit.md`**

Estructura del documento:
```markdown
# Auditoría de Documentación vs Implementación (2026-06-15)

## Resumen
- N docs correctas, M con drift, K faltantes, J sobrantes.

## Inventario de paquetes
| Paquete | Responsabilidad real | Exports principales | Depende de | Doc existente |
|---|---|---|---|---|
...

## Drift detectado (doc desactualizada)
- `docs/system/0X-*.md` §Sección: [qué dice] → [qué hace el código]. Acción: corregir en Fase 4.

## Faltantes (código sin doc)
- ...

## Sobrantes (doc de mecanismos retirados)
- ...
```

- [ ] **Step 5: Commit**

```bash
git add docs/development/doc-audit.md
git commit -m "docs(audit): mapa doc-vs-codigo como base de la actualizacion"
```

---

## Task 1 — Identidad visual (logo SVG)

**Objetivo:** un logo propio, sobrio, coherente con el sistema de diseño "ember sobre grafito" (acento ámbar/ember sobre fondo grafito oscuro), sin celestes (memoria `design-system-ember`).

**Files:**
- Create: `.github/assets/logo.svg` (icono + wordmark "ManyHands")
- Create: `.github/assets/logo-mark.svg` (solo icono)
- Read: `apps/web/src/app/globals.css` o tokens de tema para tomar los valores exactos de color (grafito/ember).

- [ ] **Step 1: Extraer los tokens de color reales**

Leer los CSS variables del tema (fondo grafito, acento ember) para que el logo use los mismos valores que la UI.

- [ ] **Step 2: Diseñar el concepto del icono**

Concepto: "muchas manos / agentes en paralelo convergiendo". Opción simple y reproducible en SVG: varias líneas/ramas (un DAG estilizado) que convergen en un nodo, o un conjunto de trazos paralelos que se unen. Mantener geométrico, monocromo + 1 acento ember. Evitar gradientes complejos.

- [ ] **Step 3: Escribir `logo-mark.svg` y `logo.svg`**

SVG limpio, `viewBox` definido, sin dependencias externas, colores como valores explícitos (no CSS vars, para que renderice en GitHub). `logo.svg` = icono + texto "ManyHands". Asegurar legibilidad en fondo claro y oscuro de GitHub (usar `<svg>` con fondo propio o trazos que funcionen en ambos; si no, versión con fondo grafito).

- [ ] **Step 4: Verificación visual**

Abrir ambos SVG en el navegador (o `preview`) y confirmar render correcto y legibilidad. Ajustar si hace falta.

- [ ] **Step 5: Commit**

```bash
git add .github/assets/logo.svg .github/assets/logo-mark.svg
git commit -m "feat(brand): logo SVG ember-sobre-grafito para el repo"
```

---

## Task 2 — README raíz (`README.md`)

**Objetivo:** la pieza central cara a reclutadores. Debe explicar *qué es*, *qué problema resuelve*, *cómo funciona*, *cómo se corre* y *qué tiene de propio*, en español, conciso y bien jerarquizado.

**Files:**
- Create: `README.md`
- Read: `product-vision.md`, `architecture.md`, `DECISIONS.md`, `doc-audit.md` (Task 0)

- [ ] **Step 1: Redactar header + pitch**

```markdown
<div align="center">
  <img src=".github/assets/logo.svg" alt="ManyHands" width="420" />
  <p><strong>Sala de control para desarrollo de software con múltiples agentes LLM en paralelo.</strong></p>
</div>
```
Seguido de 2–3 frases que planteen el problema (paralelizar agentes sobre un mismo repo es propenso a conflictos y a falta de aislamiento) y la propuesta (descomponer en un DAG con contratos de interfaz, ejecutar hojas en worktrees aislados, componer bottom-up con reparación contract-aware).

- [ ] **Step 2: Sección "Características clave"**

Lista breve que **destaque los aportes propios** (no toda feature). Mínimo: descomposición recursiva *interface-aware*; ejecución aislada en git worktrees + `ScopeChecker`; composición *contract-aware* (cherry-pick + reparación semántica); sala de control *event-sourced* con canal único de decisiones; `git diff HEAD` como única fuente de verdad.

- [ ] **Step 3: Sección "Cómo funciona" + diagrama del pipeline**

Diagrama en bloque (mermaid o ASCII) del pipeline: `Describir feature → Plan (DAG + contratos) → Aprobar → Ejecutar hojas en paralelo aislado → Componer bottom-up → Supervisar/decidir → Aceptar`. Reusar el diagrama de `architecture.md` adaptado.

- [ ] **Step 4: Sección "Arquitectura" + tabla de paquetes**

Diagrama del monorepo y tabla `Paquete | Responsabilidad | Doc` con links a cada README de paquete (Task 3). Tomar la tabla de `architecture.md` y enlazar.

- [ ] **Step 5: Sección "Inicio rápido"**

> [!NOTE]
> Requisitos: Node.js, pnpm, y **Gemini CLI** configurado (executor por defecto; requiere API key). 

Pasos exactos: `pnpm install`; variables de entorno necesarias; `pnpm web:dev`; abrir `http://localhost:3000`. Verificar los comandos reales contra `package.json` raíz antes de escribirlos.

- [ ] **Step 6: Secciones "Uso", "Estructura del proyecto", "Stack" y "Documentación"**

- Uso: flujo mínimo (crear run → revisar plan → aprobar → supervisar → aceptar).
- Estructura: árbol resumido del monorepo (`apps/`, `packages/`, `docs/`).
- Stack: TypeScript, Next.js App Router, LangGraph, pnpm workspaces, Vitest, Gemini CLI.
- Documentación: links a `docs/system/`, `docs/design/`, `docs/DECISIONS.md`.
- Insertar 1–2 capturas (placeholder de ruta `.github/assets/screenshots/...`, se completan en Task 5).

> [!WARNING]
> No incluir secciones LICENSE / CONTRIBUTING / CHANGELOG (restricción de la skill). Usar admonitions para requisitos y para el estado "en desarrollo activo".

- [ ] **Step 7: Verificar enlaces y comandos**

Confirmar que todo link relativo apunta a un archivo existente (los READMEs de paquete pueden no existir aún → marcar como dependencia de Task 3) y que los comandos `pnpm ...` existen en `package.json`.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs(readme): README raiz en espanol cara a reclutadores"
```

---

## Task 3 — READMEs por paquete

**Objetivo:** un README conciso por paquete activo, con la misma plantilla, que explique propósito, rol en el pipeline, conceptos clave y API pública. Contenido derivado del inventario de Task 0 y del código real.

**Plantilla común (aplicar a cada paquete):**
```markdown
# @manyhands/<paquete>

> <una frase: qué hace y por qué existe>

## Rol en el pipeline
<dónde encaja: planning / ejecución / composición / soporte>

## Conceptos clave
- <Concepto 1>: ...
- <Concepto 2>: ...

## API pública
| Símbolo | Tipo | Descripción |
|---|---|---|
| `Foo` | tipo/clase/función | ... |

## Dependencias
Depende de: `@manyhands/...`. Usado por: `...`.

## Más
Ver [`docs/system/0X-*.md`](../../docs/system/0X-....md).
```

**Files (uno por sub-paso):**

- [ ] **Step 1: `packages/decomposer/README.md`** — Descomposición recursiva interface-aware; rol: planning; conceptos: decisión atómico/dividir, generación de `sharedInterface`, schemas LLM, prompt templates; API real desde `packages/decomposer/src/index.ts`. Link a `docs/system/03-decomposer.md`. Destacar como **aporte propio #1**. Commit: `docs(decomposer): README del paquete`.

- [ ] **Step 2: `packages/execution-core/README.md`** — Corazón de ejecución; conceptos: `WorktreeManager`, executor registry/perfiles (Gemini CLI), `ScopeChecker`, `FileSystemContextPacker`, `ValidationRunner`, `ResultRecorder`, `IntegrationAgent` (cherry-pick + reparación semántica), grounding, amendments, `GranularityVector`. API desde `src/index.ts`. Links a `docs/system/04..09`. Commit: `docs(execution-core): README del paquete`.

- [ ] **Step 3: `packages/orchestrator-graph/README.md`** — StateGraphs de planning/ejecución (LangGraph), state annotations, checkpointer JSON (resume/fork). Link a `docs/design/langgraph-orchestrator-design.md`. Commit: `docs(orchestrator-graph): README del paquete`.

- [ ] **Step 4: `packages/task-graph/README.md`** — `TaskNode`, `TaskGraph`, validación de DAG, topo sort; invariante `graph.dependencies` canónico (D1). Link a `docs/system/01-task-graph.md`. Commit: `docs(task-graph): README del paquete`.

- [ ] **Step 5: `packages/contracts/README.md`** — `AgentTaskContract`, `InterfaceContract`, `ExecutionScope` (`implementationPaths`/`testPaths`/`configPaths`/`forbiddenPaths`); campo canónico `goal` (D2). Link a `docs/system/02-contracts.md`. Destacar relación con composición contract-aware. Commit: `docs(contracts): README del paquete`.

- [ ] **Step 6: `packages/scheduler/README.md`** — Selección de waves consciente de scope/riesgo, políticas de scheduling (D9). Commit: `docs(scheduler): README del paquete`.

- [ ] **Step 7: `packages/conflict-risk/README.md`** — Predicción de riesgo de conflicto pairwise entre tareas. Commit: `docs(conflict-risk): README del paquete`.

- [ ] **Step 8: `packages/repository-index/README.md`** — Índice estructural de TypeScript para grounding. Commit: `docs(repository-index): README del paquete`.

- [ ] **Step 9: `packages/run-store/README.md`** — Snapshots/patches de runs y persistencia JSON (D7 JSON antes que SQLite). Commit: `docs(run-store): README del paquete`.

- [ ] **Step 10: `packages/trace-store/README.md`** — Eventos de traza. Commit: `docs(trace-store): README del paquete`.

- [ ] **Step 11: `packages/shared/README.md`** (mínimo) — `EntityId`, `IsoTimestamp`, helpers base. Commit: `docs(shared): README minimo del paquete`.

- [ ] **Step 12: `apps/web/README.md`** — La sala de control: Command Center, Run Workspace, modelo agent-first (reducer/selectores/view-models en `src/lib/run-model/`), hosts de planning/ejecución, APIs, SSE; UI derivada de `RunEvent` (event-sourced). Link a `docs/system/10-web-app.md` y `docs/design/`. Commit: `docs(web): README de la app`.

- [ ] **Step 13: Verificación de la fase**

Confirmar que cada API documentada existe en el `src/index.ts` correspondiente (no inventar símbolos) y que los links relativos resuelven.

---

## Task 4 — `docs/system/` didáctico + normalización del resto de `docs/`

**Objetivo:** reescribir `docs/system/` como **material de estudio del sistema** — explicativo y profundo, para que Francisco entienda cada componente a fondo (y pueda defenderlo) y su director lo comprenda con facilidad. En el resto de `docs/` (development, design), normalizar idioma a español y corregir el drift del `doc-audit.md` (Task 0).

> [!IMPORTANT]
> `docs/system/` no es referencia para reclutadores: es **material pedagógico** para Francisco + su director de tesis. Prioriza la *comprensión* sobre la exhaustividad. Para cada componente, responder: ¿qué problema resuelve?, ¿cómo funciona el flujo paso a paso?, ¿qué decisiones de diseño hay detrás (enlazar a `DECISIONS.md`)?, ¿cómo encaja con el resto? Usar diagramas, ejemplos concretos y un "modelo mental" inicial en cada capítulo. Tono de "explicar para enseñar", no de spec seca. Esta tarea NO es candidata a recorte: es de las de mayor valor para la defensa.

**Files:**
- Modify: `docs/system/README.md`, `docs/system/01..11`
- Modify: `docs/development/architecture.md`, `product-vision.md`
- Modify: `docs/design/*` (solo los con idioma mixto o drift)

- [ ] **Step 1: Aplicar correcciones de drift**

Para cada entrada de "Drift detectado" en `doc-audit.md`, editar el doc correspondiente para que describa el comportamiento real. Quitar/archivar referencias a mecanismos retirados (Lab Mode, mock-v0, replay) si aparecen.

- [ ] **Step 2: Reescribir `docs/system/` con enfoque didáctico (en español)**

Reescribir cada `docs/system/0X-*.md` como capítulo de estudio, no como traducción literal. Estructura sugerida por capítulo: (1) **Modelo mental** — la idea en una analogía/frase; (2) **Qué problema resuelve**; (3) **Cómo funciona** — flujo paso a paso con diagrama y un ejemplo concreto recorrido de punta a punta; (4) **Decisiones de diseño** — por qué así, enlazando a `DECISIONS.md` (D1–D14); (5) **Cómo encaja** — relación con los paquetes vecinos. Preservar nombres de API/tipos en inglés y los bloques de código. Verificar cada afirmación técnica contra el código real (no documentar lo que el `doc-audit` marcó como drift).

- [ ] **Step 3: Normalizar `docs/development/` y `docs/design/`**

Traducir `architecture.md` y `product-vision.md` a español; revisar `docs/design/` y unificar idioma. No reescribir contenido correcto, solo idioma + drift.

- [ ] **Step 4: Verificar enlaces internos de `docs/`**

Buscar links rotos tras los cambios (rutas y anclas).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: normalizar docs/ a espanol y corregir drift vs codigo"
```

---

## Task 5 — Capturas de pantalla de la UI

**Objetivo:** 3–5 capturas limpias de la sala de control para el README raíz (lo que un reclutador mira primero).

> [!WARNING]
> Usar el harness `ui-shots.mjs` / `ui-shot-crop.mjs` (puppeteer-core + Chrome del sistema, `MSYS_NO_PATHCONV=1`). Tema oscuro cálido (default). No usar el MCP de preview para esto.

**Files:**
- Create: `.github/assets/screenshots/command-center.png`
- Create: `.github/assets/screenshots/run-workspace.png`
- Create: `.github/assets/screenshots/plan-dag.png`
- Create: `.github/assets/screenshots/decision-channel.png`

- [ ] **Step 1: Levantar la app y un run de ejemplo**

`pnpm web:dev` (en su propia terminal; recordar el gotcha de no correr typecheck/build en paralelo). Tener un run con plan + ejecución para que las vistas no estén vacías.

- [ ] **Step 2: Capturar las vistas con el harness**

Correr `ui-shots.mjs` apuntando a Command Center, Run Workspace (DAG/plan), ejecución y canal de decisiones. Recortar con `ui-shot-crop.mjs` si hace falta.

- [ ] **Step 3: Insertar en el README raíz**

Reemplazar los placeholders de Task 2 Step 6 por las rutas reales. Una imagen "hero" arriba + el resto en una sección "Capturas".

- [ ] **Step 4: Commit**

```bash
git add .github/assets/screenshots/ README.md
git commit -m "docs(readme): capturas de la sala de control"
```

---

## Task 6 — Verificación final

**Objetivo:** confirmar que la documentación es correcta, navegable y que no se rompió nada.

> [!WARNING]
> Asegurarse de que `pnpm web:dev` **no** esté corriendo antes de typecheck/build (race de tsup).

- [ ] **Step 1: Chequeo de enlaces**

Verificar (con un link checker de markdown o revisión dirigida) que todos los links relativos del `README.md`, READMEs de paquete y `docs/` resuelven a archivos existentes.

- [ ] **Step 2: Verificar comandos del README**

Ejecutar los comandos del "Inicio rápido" en un entorno limpio mental: `pnpm install`, `pnpm web:typecheck`. Confirmar que existen y describen el flujo real.

- [ ] **Step 3: Revisión contra las restricciones de estilo**

Checklist: sin secciones LICENSE/CONTRIBUTING/CHANGELOG; emojis moderados; admonitions usadas donde aporta; logo en el header; conciso. Releer con ojos de reclutador.

- [ ] **Step 4: Sanity build**

`pnpm web:typecheck` y `pnpm test` para confirmar que ningún cambio (p. ej. en `docs/` enlazada desde código, o assets) rompió algo. Si falla por disco, borrar `apps/web/.next`.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "docs: verificacion final de la documentacion del repo"
```

---

## Orden y dependencias

```
Task 0 (auditoría) ──> Task 2 (README raíz) ──┐
                  └──> Task 3 (READMEs paquete) ┤
Task 1 (logo) ───────> Task 2 ─────────────────┤
                                                ├─> Task 5 (capturas) ─> Task 6 (verificación)
Task 0 ──────────────> Task 4 (docs/) ─────────┘
```

- Task 0 y Task 1 pueden ir en paralelo.
- Task 2 depende de Task 0 (contenido veraz) y Task 1 (logo).
- Task 3 depende de Task 0.
- Task 4 depende de Task 0.
- Task 5 depende de Task 2 (dónde insertar) y de la app corriendo.
- Task 6 cierra.

## Self-Review (cobertura del pedido del usuario)

- ✅ Analizar doc actual y compararla con la implementación real → Task 0.
- ✅ Actualizar / reescribir / agregar / quitar doc → Task 4 (drift, traducción, sobrantes).
- ✅ README raíz explicando bien el proyecto, cara a reclutadores → Task 2.
- ✅ READMEs en carpetas de módulos importantes → Task 3.
- ✅ Restricciones de la skill de README (estructura/tono, sin LICENSE/CONTRIBUTING, admonitions, logo) → Task 2 + Task 1.
- ✅ Idioma español + logo SVG → fijado y aplicado en todas las fases.
