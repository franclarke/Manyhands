# Afirmaciones no verificadas por completo

Lista honesta de lo que el Artifact afirma con confianza parcial, y por qué. Todo lo demás fue verificado leyendo el código y los tests citados en `evidencia-tecnica.md`.

## No ejecutado (verificado solo estáticamente)

1. **Comportamiento runtime de los CLIs de agentes** (Claude Code / Codex): la integración se verificó en código (`cli-executor.ts`, perfiles, tests con executors falsos y suites `execution-core-claude-code-cli.test.ts` / `codex-cli.test.ts`), pero en esta investigación **no se ejecutó un run real end-to-end** contra un CLI vivo. Los tiempos, costos y modos de falla del proveedor citados provienen de la estructura del código (timeouts, failureKind), no de una corrida.
2. **La suite de tests no fue corrida en esta sesión.** Los nombres de tests citados como evidencia se extrajeron de los archivos (`describe`/`it` reales), y CI (`.github/workflows`) ejecuta build/typecheck/test — pero no verifiqué su estado verde en este commit exacto.
3. **El render del Artifact** fue validado estructuralmente y en navegador local (Chromium, viewports desktop y mobile, incluyendo el escalado automático de contenido que no entra en pantalla), pero no pixel a pixel en múltiples navegadores. Las interacciones son simples: navegación por riel lateral, flechas de teclado y `Home`/`End`. No hay drawer de notas ni filtro de evidencia — se retiraron: el contenido de apoyo vive en los documentos complementarios, no en el Artifact.

## Leído parcialmente (afirmaciones acotadas a lo leído)

4. **`delivery.ts` / ruta `deliver`**: verifiqué el gate de ciclo de vida (`deliver` solo en estados terminales, `deliver-route-guard.test.ts` existe) y la generación del branch final en `final-apply.ts`. El detalle interno de merge/descartes/limpieza de `delivery.ts` no fue leído línea por línea; el Artifact solo afirma lo primero.
5. **`world-reconciler.ts` (internals)**: el contrato (INV-3, evento `world.reconciled` con kept/invalidated/cleaned) se verificó por el payload tipado, el punto de invocación en `execution-pipeline.ts` y los tests nombrados; no leí la implementación completa del reconciliador.
6. **`amendments-engine.ts` (internals)**: el flujo de `approve_amendment` (ruta de decisiones → `amendSeam` → filtrado de resultados → reset del thread → re-ejecución sembrada) se verificó en la ruta y sus tipos; la mecánica interna del engine (cómo computa el closure inválido) no fue leída en detalle. Los golden fixtures (`golden-seam-amendment-blast-radius`) respaldan el comportamiento observable.
7. **Prompts completos del decomposer** (`step-prompt.ts`): verifiqué el esquema de salida por paso (`atomic|decompose|question`, seams) y el manejo de errores/retries; no auditué el texto completo del prompt ni su versión (`RECURSIVE_DECOMPOSER_PROMPT_VERSION`).
8. **`pause-control.ts` / `terminal-sessions.ts` / vistas de terminal**: mencionados solo tangencialmente; no forman parte de las afirmaciones del Artifact.
9. **`repo-provisioner.ts`**: se afirma que provisiona el repo local configurado en el workspace y registra `provisioned{repoRoot,baseBranch,baseCommit}` (visto en el pipeline y schema); los modos de `RepoSpec` distintos de `localPath` no fueron examinados.

## Afirmaciones con matiz deliberado (no son incertidumbre, son precisión)

10. **"`git diff HEAD` es la fuente de verdad"**: el mecanismo real es staging con exclusión de artefactos + `git diff --cached` (o diff por rango cuando el agente commiteó). Semánticamente equivalente a un diff contra HEAD que además captura archivos nuevos; el Artifact lo presenta con ese matiz.
11. **"Diff fuera del scope ⇒ fallo"**: solo cierto para `forbiddenPaths` (deny-list). El allow-list es advisory por diseño documentado en el propio código (ADR-0023) y test dedicado. El Artifact lo presenta así.
12. **Conteo "~40 tipos de eventos v1"**: `RUN_EVENT_TYPES` contiene 41 entradas; se redondeó deliberadamente y el número exacto no es load-bearing.
13. **"~150 suites de test"**: `tests/` contiene 146 archivos `*.test.ts` más 5 suites dentro de `packages/orchestrator-graph`. El orden de magnitud es correcto; no se auditó cuántos casos individuales contiene cada una.
14. **Cifras de configuración** (maxParallel 6, leaf timeout 300 s, integration timeout 600 s, 4 repairs/integración, 2 pasadas/conflicto, auto-repair de hoja = 1 intento en el host web): leídas de los defaults en código; un run puede sobreescribirlas vía `executionConfig`. El deck muestra varias de estas cifras en los slides 4 y 5 — siempre como defaults, no como límites duros.

15. **Ejemplo continuo del deck** (`leaf-schema`, `leaf-store`, `leaf-api`, seam `ExpenseStore`, contratos y payloads de wave con valores): es un ejemplo ilustrativo construido para la narrativa, no una traza capturada de un run real. Las **formas** (campos, tipos, orden de pasos, nombres de eventos y símbolos) sí fueron verificadas contra el código en julio 2026; los **valores** (ids, paths, firmas) son inventados con formato realista.

## Fuera de alcance de la verificación

16. **Rendimiento y escalabilidad reales** (cuántas hojas en paralelo aguanta una máquina, costos por run): no hay benchmark activo por decisión de proyecto (`docs/DECISIONS.md`), y el Artifact no hace afirmaciones cuantitativas de performance.
17. **Cobertura de los golden fixtures vs. el comportamiento del backend real**: los fixtures del run-model son autoría manual (documentado en `fixtures/_authoring.ts`); demuestran el contrato reducer/selectors, no una traza capturada de producción.

## Parte II — cierre de tesis (slides 7-10)

Esta sección separa explícitamente lo verificado (estado actual del código) de lo
propuesto (nada de esto está implementado; es el plan a presentar a los profesores).

### Verificado contra el código (julio 2026, branch `main`)

18. **Flujo `GranularityMode → Aggressiveness`**: verificado de punta a punta —
    `RunCreateRequestSchema.granularity` (`schema.ts`) → `resolveDecompositionMode`
    (identidad, `planning-host.ts:694`) → `modeToAggressiveness`
    (`recursive-decomposer.ts:1412`, coarse→low/balanced→medium/fine→high/auto→auto)
    → `buildStepPrompt` (`step-prompt.ts`). La rúbrica `COHESIVE_UNIT` con sus 4
    niveles y la cita literal de `auto` ("whatever size matches THIS node's
    complexity — you choose") están copiadas del archivo, no parafraseadas.
19. **`auto` como ciudadano de segunda**: los tres puntos citados
    (`replan-service.ts:133` degrada a `balanced`; `run-model-event-log.ts:226`
    registra `medium`; `aggressivenessToGranularity` devuelve `medium` para `auto`)
    fueron leídos directamente en esas líneas.
20. **Scorer de routing** (`scoreNodeComplexity`, `complexity.ts`): la tabla de
    señales y puntajes del apunte técnico transcribe la función completa; los
    tiers (`trivial ≤2`, `standard ≤5`, `complex ≤9`, `critical >9`) y las lanes
    (`DEFAULT_TIER_ROUTES`, `policy.ts`) están citados tal cual del código.
21. **Routing puenteado en producción**: verificado en `execution-host.ts:223` —
    el router solo se construye si `routing !== "fixed"` y no hay selección
    explícita de executor/modelo en el run. No se verificó con qué frecuencia los
    runs reales crean con selección explícita (probable pero no medido en esta
    sesión); la afirmación se limita a lo que el código permite.
22. **`GranularityVector` ya instrumentado**: los campos citados (`depth`,
    `leafCount`, `compositeCount`, `leafSuccessRate`, `integrationSuccessRate`,
    `conflictRate`, `totalCostUsd`, etc.) están tomados de
    `packages/execution-core/src/granularity/vector.ts` y su schema; se emite en
    `run.metrics.ready` según `execution-pipeline.ts` / `execution-state.ts`. No
    se verificó en esta sesión que el campo se puebla correctamente en un run real
    end-to-end (consistente con el ítem 1 de este documento: nada se ejecutó).
23. **Señales estructurales D19** (`static_import_dependency`, etc.): citadas de
    `docs/DECISIONS.md`, no releídas directamente en `packages/conflict-risk`
    para esta sección — se asume que D19 sigue vigente tal como está documentado.

### Propuesta — nada de esto existe todavía

24. **`auto v2` (prior determinista + rúbrica cost-aware + feedback del corpus)**:
    es un diseño, no código. Ningún archivo nuevo fue creado ni modificado. El
    apunte técnico y el guion lo marcan como propuesta en cada mención, y el deck
    usa "propuesta" en el kicker del slide 9. Verificar antes de implementar que
    el `repository-index` expone las señales D19 en el punto donde se resolvería
    `COHESIVE_UNIT` — no confirmado en esta sesión.
25. **Diseño experimental (4 brazos, 40 runs, corpus de 5 features)**: es un plan.
    Los números (40 runs, ~5 h por ventana de cuota, ~4-5 runs/día) son estimaciones
    del usuario sobre su plan de $20 de Claude/Codex, no medidos por esta sesión.
    El corpus de 5 features todavía no existe; sus criterios de diseño están
    especificados pero no aplicados.
26. **Curva del sweet spot (slide 10, diagrama derecho)**: es una ilustración
    conceptual de la forma esperada, rotulada explícitamente "sin datos todavía"
    en el propio SVG. No debe leerse ni citarse como resultado.
27. **Cronograma de 4 semanas**: existe únicamente como estimación de factibilidad
    en `apunte-tecnico-cierre-tesis.md` (semanas 1 / 2-3 / 4), para argumentar que
    el diseño entra en el presupuesto de tokens. Ya no aparece en ningún slide ni
    se narra como plan formal en la charla (versión corta, 10-15 min): el cierre
    pide feedback en base a cuatro preguntas conversacionales
    (`guion-cierre-tesis.md`), no a un cronograma mostrado en pantalla.
