# Registro duradero de progreso — Cierre de tesis (Etapas 2–6)

> Registro continuo exigido por GOAL.md. Permite reanudar el trabajo si la
> sesión se interrumpe. Se actualiza al cerrar cada hito, no solo al final.
> Inicio de ejecución: 2026-07-23 (UTC). Commit de partida: `5355d4b`.

## Estado por etapa

| Etapa | Gate | Estado | Evidencia |
|---|---|---|---|
| 1 — Congelar alcance | G1 | **PASS** (aprobado por Francisco, D-1..D-4) | `docs/tesis/*.md`, `evidence/baselines/stage-1-baseline.md` |
| 2 — Toolchain y gates | G2 | **PASS** (commit `d552c5d`) | `evidence/gates/g2-gate-results.md`, `g2-fresh-install.md` |
| 3 — Aporte adaptativo | G3 | **PASS** (`3a52b8b`) | `evidence/gates/g3-adaptive-integration.md` |
| 4 — Run canónico | G4 | **PASS** (2 runs válidos consecutivos sobre `db096d0`) | `evidence/gates/g4-gate-results.md` |
| 5 — Experimento | G5 | **PASS** (12 celdas ejecutadas sobre `4f4ead5`; hipótesis falsada) | `evidence/gates/g5-gate-results.md` |
| 6 — Tesis y presentación | G6 | **PASS** (tesis 43 pág. y presentación 24 slides, ambas sin warnings, con la evidencia definitiva) | `docs/tesis/main.tex`, `docs/tesis/presentacion.tex` |

## Decisiones adoptadas

- **D-1..D-4:** aprobadas por Francisco (ver `research-questions.md` §4).
- **D-5:** escenario del run canónico — se confirma al iniciar Etapa 4; default:
  feature vertical sobre app TS pequeña externa (GOAL.md sugiere escenarios tipo
  división de gastos / tareas / inventario).
- **D-6 (adoptada):** pnpm 7.29.3 + lockfile 5.4. **Limitación local:** Node 22
  no está instalado (nvm local solo tiene 18/19; Node activo = 24.16.0 de
  instalación directa; instalar 22 requeriría descarga/elevación). Gates locales
  corren sobre Node 24.16.0; CI queda como autoridad de Node 22; `engines` se
  fija `>=22`.
- **D-7 (adoptada):** señales de complejidad híbridas — LLM propone, validador
  determinista acota contra `RepositorySnapshot`.
- **D-8 (adoptada):** el `RecursiveDecomposer` emite señales y delega la frontera
  leaf/composite a la política adaptativa (un solo planificador).

## Bitácora

### 2026-07-23 — Sesión de ejecución (inicio)

1. G1 cerrado `PASS` (Francisco aprobó D-1..D-4). Commit `b9c4e68` con los
   entregables G1 + GOAL.md.
2. Etapa 2: toolchain alineada — `packageManager: pnpm@7.29.3`, `engines`
   (`node >=22`, `pnpm 7.29.3`), `.nvmrc` = 22.
3. **Bug de entorno (causa raíz):** `node_modules/simple-git` era una junction
   huérfana hacia `C:\Users\franc_rgy\...\manyhands-isolated-typecheck\...`
   (workspace temporal de otro perfil). Eliminada la junction (`rmdir`, solo el
   link). Además `.modules.yaml` marcaba como *skipped* binarios win32-x64
   necesarios (`@esbuild/win32-x64@0.27.7`, sharp, tailwind oxide) por un install
   previo roto → `pnpm install --frozen-lockfile --force` re-materializó el
   virtual store (75s, lockfile sin cambios de contenido).
4. Gates: `pnpm build` EXIT 0 (47s) · packages typecheck EXIT 0 (19s) · web tsc
   EXIT 0 (10s) · suite inicial 3 fallos / 1068 pass.
5. **Regresiones UI reparadas (TDD, sin debilitar invariantes):**
   - `run-canvas-no-auto-fit.test.ts`: assertaba el wiring viejo de
     `MinimalRunGraph`/`RunGraphCanvas` (0 consumidores — código muerto). Se
     eliminó `apps/web/src/components/run-model/minimal-run-graph.tsx` y el test
     ahora guarda el invariante A17 repo-wide (prohíbe `.fitView(`/`.setCenter(`/
     `.setViewport(`/`fitView=` en todo apps/web/src) + exige `defaultViewport`
     estático y `showFitView={false}` en el canvas productivo. Más estricto que
     antes.
   - `typography-scale.test.ts`: 21 usos `text-[10px]`/`text-[11px]` y un
     `px-2.5` en los 5 componentes cockpit nuevos → `text-micro` (piso 11px del
     sistema) y `px-2`.
6. Suite completa tras fixes: **181 files / 1072 passed / 2 skipped, EXIT 0, 88s**
   (2 skipped = kill-test POSIX en Windows, por diseño).
7. CI: agregados pasos `Typecheck (packages)` y `Build (web)` para equivalencia
   con los gates locales; comentario del lint actualizado (46 errores
   preexistentes, no-bloqueante, no es gate de tesis).

8. `web:build` EXIT 0 (116s). Commits `0757e55` (toolchain) y `d552c5d` (fixes
   UI). Fresh clone desde `d552c5d`: install 0 (35s, lockfile intacto), build 0
   (43s), test 0 (82s, 181/1072). **G2 = PASS.** Evidencia en
   `evidence/gates/g2-*.md`.

### Etapa 3 (en curso)

9. Diseño ajustado por evidencia: el planner productivo V2 es
   `WorkBreakdownPlanner` (no el `RecursiveDecomposer`, que es de la ruta legacy
   `/api/runs`). El punto de integración es entre `plan()` y `compile()` en
   `runPlanningV2`. D-8 se aplica sobre el planner productivo.
10. TDD: creado `tests/decomposer-adaptive-planning.test.ts` (rojo verificado por
    ZodError del schema estricto). Implementados: `ComplexitySignalsSchema`
    opcional en `WorkUnit` (planner/schema.ts) y
    `granularity/adaptive-planning.ts` (`applyAdaptiveGranularity`, formula
    version `c-task/1.0.0`, validación híbrida D-7: llm/clamped/derived, bridge a
    `compileAdaptiveWorkUnitTree`, preservación de campos semánticos, métricas
    estructurales).

11. **G3 = PASS** (commit `3a52b8b`). Suite 185 files / 1085 tests, exit 0.
    Evidencia: `evidence/gates/g3-adaptive-integration.md`.

### Etapa 4 (en curso) — run canónico

12. **Cambio de regla (Francisco, 2026-07-23):** Codex para planning **y**
    ejecución (reemplaza Claude Sonnet en planning).
13. Codex CLI 0.141.0 autenticado con cuenta ChatGPT. `gpt-5-codex`,
    `gpt-5.1-codex*` y `gpt-5` **no soportados** con esa cuenta; el default del
    config (`gpt-5.6-sol`) exige CLI más nuevo. **Modelo elegido: `gpt-5.5`**
    (probado OK).
14. Repo objetivo creado fuera de ManyHands:
    `~/manyhands-thesis-targets/expense-splitter` (TS, dominio + API + web +
    tests, 5 tests verdes, typecheck limpio). Base SHA `1da878d`.
15. **Run 1 (`890f19e1`)**: planning adaptativo con Codex real **funcionó** —
    `planning.granularity_assessed` persistido, señales `llm` aceptadas, grafo
    compilado. Pero el grafo salió patológico: **23 conflict constraints para 9
    nodos** y partes `:part-N` con **scopes idénticos**.
16. **Bug A (causa raíz):** las partes sintetizadas heredaban *todos* los
    `evidenceIds` del padre, así que el contract-compiler les daba el scope
    completo del padre. Además `synthesizeUnits` tenía un fallback degenerado
    que duplicaba todos los paths. Regresión agregada + corregido (evidencia por
    slice, sin fabricar partes sin trabajo disjunto).
17. **Run 2 (`8074fd46`)**: `planning.failed` — `candidate ... references
    unknown producer/consumer`. **Bug B (causa raíz):** al reshapear el árbol no
    se remapeaban `candidateArtifacts`/`candidateSeams`, así que las referencias
    a unidades fusionadas/colapsadas quedaban colgando. Regresión + corregido
    (`absorptionMap` + `remapRelations`, descarta auto-referencias).
18. **Run 3 (`88263695`)**: planning limpio al primer intento. Grafo sano: 5
    nodos, **3 conflictos** (antes 23), scopes distintos, coalescencia real
    (`domain-category-totals` + `web-category-breakdown` fusionados). Plan
    aprobado → ejecución real: 3 attempts en worktrees aislados (pool 2 slots),
    2 waves, agentes Codex exit 0 (125s/144s/184s). **Los 3 fallaron con
    `scope_violation`.**
19. **Bug C — hallazgo empírico decisivo.** Las partes sintetizadas reciben
    particiones mecánicas de paths que no corresponden a unidades de trabajo
    coherentes (`part-2` recibió solo `src/domain/expense.ts`; el agente
    necesitaba también el test y el tipo). **Causa raíz sistémica:** la política
    determinista puede *detectar* exceso de complejidad, pero **no puede
    inventar el corte semántico** — eso es responsabilidad del Architect
    (`DECISIONS.md` A4). Corrección: se retiró por completo `synthesizeUnits`;
    cuando el Architect no propone sub-unidades se conserva la hoja cohesiva y
    se registra `resplit_declined` con su rationale. El run canónico produjo la
    evidencia que justifica esta decisión de diseño.

## Siguiente acción exacta

- Verificar suite completa tras el retiro de la síntesis; commit del fix.
- Relanzar el run canónico (Run 4) y llevarlo hasta `completed` con delivery.
- Escribir `evidence/canonical-run/` con el paquete completo.


### Etapas 4–6 — cierre de sesión (2026-07-24)

20. **Run canónico completado.** Run `55f8ba9f` alcanzó `completed`:
    `finalSha c48835a ≠ base 1da878d`, 4 archivos (+104/−5), manifest + receipt
    confirmados, 12 tests verdes y typecheck limpio verificados **en clon
    limpio**. Ejecutor Codex `gpt-5.5` en planning y ejecución.
21. **Defectos adicionales corregidos con regresión previa:**
    - delivery bloqueada por el propio `.manyhands/` del target (`9338419`);
    - clasificación de fallo por causa real, no `execution_failed` genérico
      (`a73c6ba`) — verificado en run 6: `scope_unexpected_commit`, `discard: true`;
    - el motivo de una violación de alcance volcaba el diff en vez de nombrar
      las rutas (`225881d`).
22. **Reproducibilidad: 1 de 4 runs completó.** Causa raíz caracterizada: bajo
    política `strict`, un archivo fuera de `allowedPaths` se rechaza; el objetivo
    invita a crear tests nuevos que el planner no pre-declaró. **No se relajó la
    política** (invariante de seguridad). Tres líneas de solución documentadas en
    `evidence/canonical-run/README.md` §7.
23. **G5 no ejecutado**, con razón declarada y procedimiento de reanudación en
    `evidence/experiment/protocol.md`. La tesis no afirma superioridad de la
    política adaptativa.
24. **Tesis reescrita íntegramente** (`docs/tesis/main.tex`): nueva estructura de
    9 capítulos derivada del análisis de tesinas de referencia
    (`evidence/thesis-reference-analysis.md`), bibliografía reconstruida a 24
    referencias verificables (se eliminaron 3 fabricadas), SQLite WAL y los
    números `GEI` removidos, privacidad y WCAG matizados, rótulos «V3»
    eliminados, y un capítulo de evaluación basado en el run real incluido el
    resultado negativo.
25. **PDF no compilado:** no hay toolchain LaTeX en el entorno
    (`pdflatex`/`xelatex`/`latexmk`/`tectonic` ausentes). Limitación de entorno,
    no del documento.
26. Suite final: **187 archivos, 1099 tests, 2 skipped, exit 0**.

### 2026-07-24 — Etapa 4 (reanudación): causa raíz del alcance

27. **Causa raíz corregida (commit `4bc0040`).** Se implementó la línea (b) de
    las tres documentadas: **creación acotada** mediante `outputRoots` en el
    contrato de alcance. Un nodo puede *crear* archivos que no pre-declaró,
    siempre que sean nuevos y estén bajo un directorio que ya posee. Las
    fronteras que lo mantienen acotado:
    - los roots los **deriva el compilador** de los directorios de las rutas
      declaradas por el propio nodo; el modelo no puede pedirlos;
    - una ruta en la raíz del repositorio no produce root alguno, y el esquema
      rechaza `.` y globs, así que un root nunca se ensancha a escritura
      repo-wide;
    - solo autoriza **creación**: editar un archivo preexistente no declarado
      sigue fuera de alcance, de modo que un root no puede apropiarse del
      trabajo de un hermano;
    - `forbiddenPaths` sigue ganando incondicionalmente;
    - «nuevo» lo determina `git diff --diff-filter=A`, nunca el agente.

    El alcance efectivo viaja dentro del `InputFingerprint`, porque los roots
    viven en el contrato de alcance cuya revisión ya integra
    `contractRevisions`. Regresión previa en `tests/scope-bounded-creation.test.ts`.
28. **Condiciones A/B/C parametrizadas por run (commit `7d36faf`).** Umbral,
    pesos y activación del crítico de coalescencia son ahora configuración por
    run, resuelta desde una etiqueta de condición y plegada en `formulaVersion`
    (`c-task/1.0.0+condA`). Omitir la condición deja el comportamiento
    productivo idéntico. Precondición de G5 satisfecha.
29. **Drivers reproducibles (commit `b8832ca`):** `run-experiment.mjs`,
    `generate-cells.mjs`, `run-g5.mjs` y `derive-metrics.mjs`. Ninguna cifra
    reportada se transcribe a mano.
30. **Defecto operativo descubierto y registrado.** El servidor de desarrollo
    resuelve `@manyhands/*` desde `dist`, no desde las fuentes. Un primer run se
    lanzó contra un `dist` del día anterior y **no** estaba ejercitando el fix;
    se detectó y descartó. Desde entonces: `pnpm build` obligatorio antes de
    todo run que valide un cambio conductual.
31. **Run descartado por fallo de entorno.** El run `16429274` superó
    planificación y su **primera hoja pasó el control de alcance y commiteó**
    (3 archivos) —donde antes fallaba—, pero el nodo siguiente expiró por
    **disco lleno (0 bytes libres en C:)**. Es un fallo de entorno, no de
    ManyHands, así que el run se descarta y no cuenta para la serie. Para
    liberar espacio se eliminaron `.manyhands/_archive_old_runs` (855 MB) y
    `.manyhands/_archive_huge` (72 MB) —runs legacy V1/V2 que Francisco ya
    había declarado descartables y que no son evidencia de tesis— y se ejecutó
    `pnpm store prune`. **Consecuencia declarada:** la observación de
    `stage-1-baseline.md` §runs legacy ya no es re-verificable sobre esos
    archivos.

32. **Run canónico válido tras el fix de alcance** (`a55525c7`, 14 min):
    `1da878d → 0e550b49`, receipt confirmado, 3 hojas ejecutadas y **ninguna
    rechazada por alcance** —donde antes fallaban 3 de 3—. Verificado en clon
    limpio: **11 tests verdes** (baseline 5) y `tsc --noEmit` exit 0.
33. **Telemetría de consumo (commit `fe6d5ab`).** RQ2 pregunta por el costo y el
    journal no registraba tokens: la usage del ejecutor llegaba a
    `AgentExecutionResult` y se descartaba. Ahora viaja en
    `attempt.candidate_created` y `attempt.failed`, con `source` obligatorio.
    **Limitación observada:** Codex CLI reporta `source: "unavailable"`, así que
    el componente de tokens de RQ2 **no es derivable** con este ejecutor; la
    duración wall-clock queda como el único indicador de costo disponible.
34. **Defecto sistémico: deadlock silencioso (commit `c227205`).** El run
    `0c0f066a` de la serie se detuvo sin fallo, sin decisión y sin avance. Causa
    raíz: un nodo adoptaba **solo** su artefacto de resultado, así que un
    artefacto declarado por el planificador entre hermanos nunca se satisfacía y
    sus consumidores jamás se volvían elegibles. Un estancamiento que no reporta
    nada es peor que un fallo: es indistinguible de trabajo en curso. Evidencia
    completa en `canonical-run/defects/silent-artifact-deadlock/`.
    **Consecuencia:** la serie de G4 se reinició por completo sobre el commit
    corregido, conforme al criterio del roadmap.
35. **Dato de evaluación que el defecto deja expuesto:** la variabilidad del
    planificador no solo cambia la topología, cambia **qué caminos del
    orquestador se ejercitan**. El defecto llevaba latente todos los runs
    anteriores. Un run exitoso no cubre el espacio de grafos posibles.
36. **G6 desbloqueado:** MiKTeX 25.12 instalado; `main.tex` compila a **36
    páginas**, con 0 referencias/citas indefinidas, 0 cajas desbordadas y 0
    advertencias de LaTeX. Se creó `presentacion.tex` (no existía ninguna),
    19 diapositivas con notas del orador, y `evidence/DEMO.md` con el guion de
    demo y su material de respaldo rotulado.

## Siguiente acción exacta (para reanudar)

1. Obtener **dos runs canónicos válidos consecutivos** sobre el commit
   `f634ff0` → cerrar G4. Antes de cada run: `pnpm build`, servidor reiniciado,
   target en `1da878d`, y **verificar espacio libre en disco** (cada run consume
   varios GB entre pools de worktrees e instalaciones).
2. Ejecutar el protocolo de G5 con `run-g5.mjs` sobre un único commit de
   ManyHands; derivar tablas y figuras con `derive-metrics.mjs`.
3. Completar la toolchain LaTeX y compilar `docs/tesis/main.tex`; revisar el PDF.
4. Actualizar tesis y `claim-evidence-matrix` con la evidencia definitiva.
5. Regenerar la presentación desde la tesis final.

### 2026-07-24 — Cierre de G5 y G6

37. **G4 = PASS** (`db096d0`): dos runs válidos consecutivos, verificados en clon
    limpio (13 y 10 tests sobre una base de 5). Evidencia en
    `evidence/gates/g4-gate-results.md`. Las dos ejecuciones produjeron
    **topologías distintas** para el mismo objetivo, lo que el gate admite y la
    tesis reporta como variabilidad del planificador.
38. **G5 = PASS** (`4f4ead5`): 12 celdas, **10 entregas**. La hipótesis
    pre-registrada quedó **falsada**: sobre T1 la condición A —no dividir—
    entregó 2/2 mientras B y C entregaron 1/2, con cerca de un tercio del tiempo
    y un cuarto de los tokens para la misma superficie funcional. Sobre T2 la
    mitad favorable de la hipótesis sí se sostuvo: las tres condiciones
    convergieron a una sola unidad, **incluida B**, que fuerza dividir.
39. **Defecto de medición declarado como resultado principal.** Los criterios de
    aceptación se compilan por unidad, así que su cantidad depende de la
    descomposición (5 en A frente a 14 en B y C sobre T1). Las 12 celdas dieron
    cobertura 1,00 porque **cada condición satisfizo su propia vara**. «Tasa de
    entrega verificada», tal como está instrumentada, no puede responder RQ1.
40. **Dos intentos completos de G5 descartados** por defectos del sistema
    (§6 del protocolo): el esquema del evento exigía umbral positivo y anulaba
    la condición B; y los objetivos estaban sub-especificados, lo que hacía que
    el planificador se detuviera a preguntar. Ambas correcciones quedaron
    registradas como enmiendas E-1 y E-2 en el protocolo, con el argumento de por
    qué no son ajuste post-hoc.
41. **La regla de escalamiento no se invocó** pese a que dos celdas discrepan
    entre repeticiones: agregar una tercera después de ver datos desfavorables
    sería el ajuste que el pre-registro prohíbe.
42. **G6 = PASS.** Tesis recompilada a **43 páginas** con la evidencia
    definitiva: resumen, capítulo de evaluación con el estudio comparativo,
    amenazas a la validez ampliadas, limitaciones, conclusiones y trabajo futuro.
    0 referencias/citas indefinidas, 0 cajas desbordadas, 0 advertencias.
    Presentación a **24 diapositivas**, 0 errores, con las slides del resultado
    falsado y del defecto de medición, más notas del orador.

### 2026-07-24 — Programa C + Warehouse, checkpoint 1

43. **Checkpoint 1 = PASS.** Se aceptó ADR 0012 y se implementó el núcleo puro
    de C sin conectarlo todavía a producción: métricas exactas de bytes/líneas
    en el índice, estimator de contexto versionado y selector bottom-up A/B/C.
    Verificación: 45 tests verdes y typechecks de `repository-index` y
    `decomposer`. Evidencia en
    `evidence/warehouse/checkpoints/checkpoint-1.md`.
44. **Límite explícito:** CLAIM-111/112 sólo están implementados como
    componentes. El siguiente checkpoint debe demostrar replan, criterios no
    duplicados, eventos replayables y configuración productiva antes de que C
    pueda aparecer como resultado de tesis.

### 2026-07-24 — Programa C + Warehouse, checkpoint 2

45. **Checkpoint 2 = PASS.** C gobierna la ruta productiva como default; C1
    queda documentado como histórico no replayable bajo la política actual.
    La política admite un único replan semántico, persiste evidencia completa y
    se explica desde replay sólo para runs C actuales.
46. **La contaminación de aceptación queda corregida en diseño.** Los mismos
    cinco intents del usuario se compilan una vez bajo A, B y C; cada nodo
    conserva sólo una obligación técnica local cuando no es owner.
47. **Candidate replay queda aislado como control experimental.** Sólo omite el
    Planner cuando hash, snapshot, goal y aceptación coinciden; la construcción
    longitudinal seguirá usando planificación viva.
48. **Verificación:** 50 tests enfocados, typechecks de `decomposer`,
    `run-coordinator` y web, y builds de ambos packages PASS. Evidencia en
    `evidence/warehouse/checkpoints/checkpoint-2.md`. C-G2 aún requiere Task 10
    y dos runs reales de estabilidad.

### 2026-07-24 — C-G1 y preflight de C-G2

49. **C-G1 = PASS** sobre `cf6db65`: selector, señales, contratos y derivación
    no censurada pasan sus regresiones; el G5 histórico rederiva 12 celdas.
50. **Checks locales de C-G2 = PASS:** 199 archivos/1153 tests, 12 typechecks
    de packages, typecheck web, build de packages y build productivo web.
51. **C-G2 sigue INCOMPLETE.** El preflight midió 8,71 GB libres frente al
    mínimo de 25 GB. No se iniciaron los dos runs reales y no se borró ni movió
    evidencia o pools sin autorización.

### 2026-07-25 — Cierre de C-G2 y checkpoint 3

52. **Capacidad operativa restablecida.** Francisco liberó espacio y el
    preflight superó el mínimo de 25 GB sin borrar automáticamente evidencia ni
    pools del usuario.
53. **C-G2 = PASS sobre ManyHands `5584602`.** Dos runs secuenciales con el
    mismo objetivo, configuración y base `1da878d` terminaron `completed`; los
    journals pliegan correctamente, los receipts están confirmados y las dos
    matrices satisfacen 5/5 criterios.
54. **Verificación externa real.** Los commits `f86c5c7` y `cf0810b` se
    instalaron y verificaron en clones limpios: 9/10 tests respectivamente y
    typecheck PASS. No hubo eventos de fallo ni reparación.
55. **Decisión estable, no fan-out forzado.** C eligió una hoja en ambas
    repeticiones porque el split del composite raíz tuvo ventajas `-0.2005` y
    `-0.2271`, inferiores al mínimo `0.15`. Los hashes candidatos difieren por
    variación del Planner y se preservan como evidencia, no se normalizan.
56. **Checkpoint 3 = completed.** CLAIM-111 queda implementado y con estabilidad
    productiva; su ventaja comparativa continúa pendiente de Warehouse Final.

### 2026-07-25 — Programa C + Warehouse, checkpoint 4

57. **Seed reproducible fijado.** El repositorio externo
    `warehouse-control-tower-seed` quedó en `0f87e45`, con cero código de dominio
    y lockfile estable después de install congelado; test, typecheck y build
    vacíos son PASS.
58. **Instrumento pre-registrado.** Protocolos, prompts W1–W8 y oráculos
    externos quedaron versionados antes de ejecutar W1. Los oráculos usan una
    sonda productiva determinista y no aceptan fixtures como sustituto.
59. **Driver longitudinal = PASS.** 26 tests cubren integridad, disco, dirty
    target, hashes, `dist`, fallo de oráculo y adopción de base. El dry-run real
    sobre `c0d4be8` imprimió ocho celdas sin mutar target ni crear worktrees.
60. **Checkpoint 4 = completed.** CLAIM-114 sólo tiene instrumento; ninguna
    construcción Warehouse se afirma todavía. Sigue Task 13 Pilot.

### 2026-07-30 — Reconciliación y lifecycle terminal

61. Los tickets 19–26 se reconcilian como `closed` según sus estados durables.
    `retry-9`, `retry-10` y `retry-11` permanecen inmutables; retry-11 queda
    registrado como instrumento inválido/no entregado por ausencia de evento
    terminal, candidate SHA, receipt y delivery.
62. Se crea el ticket sucesor local 27 para converger desde salida inesperada
    del ejecutor a un estado terminal durable, preservando decisiones pendientes
    y respetando heartbeat, fencing y takeover stale.
63. La primera regresión productiva de ticket 27 cubre salida sin candidate,
    decisión pendiente, operación fresca y retry transitorio del handler. La
    suite focal queda en 27 tests PASS; no se inicia una nueva serie N=4/N=8/N=16.
64. **Ticket 02 cerrado.** La regresión RED mostró que `C1`/`C2` se
    normalizaban silenciosamente a `C`; GREEN ahora rechaza explícitamente el
    replay histórico y elimina el resolver de policy legacy. Suites de política,
    replay de candidate y adaptive planning: 11 tests PASS; typecheck de
    `@manyhands/decomposer` PASS.
65. **Ticket 12 cerrado como limitación.** Los journals contienen valores
    observados de `validationDuplication` y la fórmula sigue midiendo
    asignaciones repetidas de acceptance intents. No existe validación externa
    de que el proxy represente costo semántico ni umbral de calidad; no se
    cambia fórmula, threshold ni estímulo.
66. **Freeze sucesor retry-12 creado sin ejecución.** El commit `e1a411d`, la
    base W1 `71f61c9`, la selección Codex `gpt-5.5/high`, condición C, probes,
    oráculo y targets N=4/N=8/N=16 quedaron registrados antes de consumir cuota.
    La evidencia permanece `not_run` hasta que exista una transición terminal,
    candidate SHA y receipt observables.
67. **retry-12 N=4 preservado sin entrega.** La celda produjo candidate
    `7a08eebdf5a3c929097b57a617f9d1fe9f45893b`, pero su validacion quedo
    `unverified` y el run levanto una decision real `resolve_conflict`. El
    driver pre-registrado expiro su margen en `waiting_for_input`, con
    `finalSha: null`, `receipt: null` y sin delivery. No se inicia N=8/N=16,
    no se marca PASS y no se repite la celda.
68. **WC1 implementado en sucesor limpio.** Desde W1 `71f61c9` se construyó el
    repositorio `warehouse-control-tower-compact`, commit `8ce6e98`, con
    pedidos/reservas atómicas, API versionada, SSE monotónico, simulación
    determinista, torre SVG con heatmap y detalle textual, y probe propio.
    Verificación: 33 tests, typecheck, build, probe byte-identical y smoke HTTP
    PASS. Ticket 28 sigue abierto hasta candidate execution, receipt, delivery
    y oráculo externo atribuibles.
69. **WC2 implementado acumulativamente.** El sucesor avanzó de `8ce6e98` a
    `4da4a45` con rutas de picking conectadas, waves con capacidad limitada,
    explicaciones de no asignación, costo sensible a congestión y overlay
    visual/textual. Verificación: 37 tests, typecheck, build y probe WC2
    determinista PASS. Ticket 29 sigue abierto hasta evidencia atribuible.
70. **WC3 implementado y revisado visualmente.** El sucesor cerró en `5da6019`
    con journal append-only, snapshots/replay con hash exacto, timeline,
    analytics, alertas, corrupción accionable y estados operativos/accesibles.
    Verificación: 41 tests, typecheck, build, probes WC1/WC2/WC3, smoke HTTP y
    revisión Playwright PASS. La implementación está completa; tickets 28–30
    siguen abiertos hasta freeze, candidate execution, receipt, delivery y
    oráculos externos atribuibles.
71. **Freeze atribuible WC1 creado.** Quedaron congelados ManyHands
    `3625434`, base W1 `71f61c9`, Codex `gpt-5.5/high`, condición C, target
    limpio, prompt, budgets, reglas de corte y oráculo compacto hasheado en
    `evidence/warehouse/compact/wc1-freeze.json`. No comenzó todavía la
    candidate execution.
72. **WC1 candidate execution preservada como evidencia adversa.** La primera
    hoja produjo candidate `68a06db4b8c9640aa15d603c80795c98df42100a` y dos
    artefactos adoptados. La segunda expiró con `git clean -fdx` fallando al
    remover `start-smoke.out.log`/`.err.log` porque el smoke server quedó vivo;
    el retry siguiente bloqueó `WorktreePool.acquire()` sin señal ni timeout.
    El run `3f5cf275-85c7-49ce-9fef-12744e1846d8` no tiene candidate final,
    receipt, delivery ni oráculo; la decisión real queda sin responder.
    Se crea el sucesor 31 para corregir teardown, release y cancelación antes
    de repetir WC1.
73. **Ticket 31 implementado parcialmente y detenido por review.** Los commits
    `8f8dca1`, `dedf0ff` y `6c71214` propagaron cancelaciÃ³n/timeout hasta pool,
    WorktreeManager, repair y composite; limpiaron worktrees abortados y
    eliminaron slots parciales. Las suites focales y typecheck pasaron, pero
    Standards/Spec dejaron abiertas evidencia durable/teardown smoke,
    operaciones Git cancelables y recovery de huÃ©rfanos. No se repite WC1 ni se
    consume N=4/N=8/N=16 hasta cerrar esas aceptaciones.
74. **Compatibilidad del driver y gate raiz parcial.** `6251751` agrega
    defaults para `recoveryHistory` y `now`; la suite de concurrencia queda
    10/10 PASS y el typecheck de orchestrator-graph PASS. `pnpm test` aun
    conserva 6 fallos no atribuibles al teardown: freeze hash historico,
    finalManifest, lifecycle de decision de integracion y expiracion de
    decisiones. No se modifican freezes ni se inicia una candidate sucesora.
75. **Proyecciones de decision y manifest reconciliadas.** `5b398e9` permite
    la propuesta de una nueva revision desde `waiting_for_input`, completa el
    `finalManifest` de la regresion V2 y alinea la expectativa de una decision
    de integracion con el lifecycle canonico. Las regresiones focales pasan;
    `pnpm test` queda en 220 files y 1537 tests PASS, con 2 fallos restantes en
    `wide-graph-oracle-contract` (freeze historico y codigo de salida del
    proceso oracle). No se alteran freezes ni se inicia WC1 sucesor.
76. **Runner externo estable en Windows.** La regresion integrada reprodujo un
    abort de Node `3221226505` causado por `process.exit(1)` durante el cierre
    de handles HTTP/IPC. `2421e10` usa `process.exitCode`; la prueba aislada del
    contrato queda en 6/7 PASS y el escenario delivery/restart pasa. Resta
    solamente el hash del `dist` historico no versionado; no se modifica el
    freeze ni se inicia WC1 sucesor.
77. **Teardown supervisado y Git cancelable.** `1df4548` propaga `AbortSignal`
    a las operaciones Git del pool durante init/acquire y agrega la regresion
    de sanitation cancelable. Las validaciones supervisadas enumeran y
    verifican descendientes antes de devolver un resultado; un sobreviviente
    produce exit 125 y no PASS. Suites focales: pool/worktree 30/30,
    validation runner 18/18 y typecheck de execution-core PASS. Ticket 31
    sigue abierto hasta la candidate real, lifecycle huerfano/restart y
    reviews nuevas; no se repite WC1 ni se ejecuta N=4/N=8/N=16.
78. **Fallo de ejecucion independiente con decision pendiente corregido.** La
    regresion RED reprodujo que una decision ajena podia suprimir cualquier
    fallo de background y dejar el run en `waiting_for_input`. `4a0be8d`
    restringe esa supresion a fallos no ejecutivos: un executor que termina con
    error registra `run.failed` sin eliminar la decision pendiente. La suite
    focal queda en 6/6 PASS y el typecheck web pasa. Ticket 31 sigue abierto;
    no se repite WC1 ni se ejecuta N=4/N=8/N=16.
79. **Descendientes del ejecutor registrados antes del teardown.** `63ce478`
    agrega un watchdog durable de tabla de procesos: si un smoke server nace
    mientras el executor sigue activo, se registra con PID/comando/label y
    queda disponible para un takeover posterior aunque el padre ya haya
    terminado. La regresion de journal y teardown verifica `allDead=true`; la
    suite focal queda verde junto con typechecks y leases/takeover. Ticket 31
    sigue abierto hasta candidate integrada y reviews nuevas; no se repite WC1
    ni se ejecuta N=4/N=8/N=16.
80. **Release del pool cancelable.** `cf13028` propaga `AbortSignal` desde el
    executor hasta la sanitizacion/recreacion de slots durante `release()`;
    una cancelacion libera la lease activa sin dejar el pool bloqueado. La
    regresion RED/GREEN y las suites WorktreePool 18/18, execution-core-worktree
    13/13 y artifacts 1/1 pasan, junto con typechecks. Ticket 31 sigue abierto
    por la candidate integrada y las reviews; no se repite WC1 ni se ejecuta
    N=4/N=8/N=16.
81. **Gate raiz tras las correcciones de lifecycle/worktree.** `pnpm test`
    queda en 220 archivos PASS, 1544 tests PASS y 2 skipped. El unico fallo es
    el hash del `dist` historico de `wide-graph-oracle-contract`; no se altera
    el freeze ni se interpreta como evidencia positiva. No aparecieron
    regresiones en lifecycle, leases, takeover, supervisor o pool. Ticket 31
    sigue abierto por candidate integrada y reviews; WC1 sucesor y N=4/N=8/N=16
    continÃºan detenidos.
82. **Freeze historico materializado de forma reproducible.** El `dist` exacto
    de `4fe8544` se reconstruyo y su hash `f95b...` coincide; la copia durable
    se versiona bajo `evidence/warehouse/wide-graph/frozen-dist/` y el freeze
    apunta a ella. `wide-graph-oracle-contract` queda en 7/7 PASS sin cambiar
    la semantica historica. Falta repetir el gate raiz y cerrar ticket 31;
    WC1 sucesor y N=4/N=8/N=16 siguen detenidos.
83. **Gate raiz verde con freeze versionado.** `pnpm test` queda en 221
    archivos PASS, 1545 tests PASS y 2 skipped. El contrato del freeze pasa
    7/7 y desaparece el unico fallo de hash sin reinterpretar evidencia. El
    commit documental es `a42ebaf`; ticket 31 sigue abierto por la candidate
    integrada y las reviews Standards/Spec. WC1 sucesor y N=4/N=8/N=16
    continuan detenidos.
84. **Watchdog cubre executor root ya terminado.** Una regresion RED demostro
    que un descendiente vivo podia no registrarse si el root desaparecia entre
    muestras. La correccion busca la descendencia por `ppid` aunque el root ya
    no este en la tabla; evidencia 7/7, typecheck web y diff check pasan.
    Ticket 31 sigue abierto por candidate integrada y recovery real. WC1 sera
    el siguiente incremento y N=4/N=8/N=16 quedan para despues de WC3.
85. **Freeze sucesor WC1 v2 preparado.** La celda congela ManyHands
    `d442ff5`, W1 `71f61c9`, Codex/gpt-5.5/high, condicion C, ejecucion
    secuencial y reglas de corte sin retry silencioso. La base externa esta
    limpia y lista, pero la candidate aun no se ejecuta. Ticket 31 sigue
    abierto hasta validar el host real; WC2 y N=4/N=8/N=16 esperan el
    veredicto WC1.
86. **Regresion de watchdog estabilizada bajo carga.** El gate completo habia
    expuesto una espera fija demasiado corta en el test del root ya terminado;
    se reemplazo por polling acotado observable. La suite focal queda 7/7
    PASS. Falta repetir el gate completo serial y, si queda verde, ejecutar
    una sola candidate WC1 v2.
