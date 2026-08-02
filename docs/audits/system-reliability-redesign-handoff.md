# Handoff para continuar el rediseño de fiabilidad de ManyHands

Fecha de corte: 2026-08-02
Rama: `codex/system-reliability-redesign`
HEAD al iniciar este handoff: `e181acc`
Estado del árbol al iniciar este handoff: limpio
Push: no realizado.

Este documento está escrito para que otro agente pueda retomar el trabajo sin
repetir la auditoría, sin confundir trabajo parcial con arquitectura terminada
y sin modificar en paralelo la política de granularidad que se está trabajando
en otra conversación.

## 1. Objetivo y restricciones vigentes

El objetivo es convertir ManyHands en un sistema de planificación y ejecución
robusto, auditable y confiable. El foco es que la política guíe el planning antes
de la propuesta del LLM, que el Planner proponga alternativas semánticas
acotadas, que el compilador valide contratos, seams y ownership antes de
seleccionar, y que ejecución reciba una intención inmutable.

No se debe:

- modificar `docs/tesis/main.tex` ni `docs/tesis/presentacion.tex`;
- modificar, reinterpretar o borrar evidencia histórica de G6/Warehouse;
- cambiar fórmulas, estímulos, umbrales, oráculos, freezes o resultados de G6;
- ejecutar nuevos runs pagos o experimentos con LLM para validar este rediseño;
- hacer push;
- usar `reset`, `clean`, checkout destructivo o stash global;
- agregar dependencias salvo necesidad demostrada;
- agregar dependencias nuevas a `@manyhands/core`;
- declarar un gate verde si no se ejecutó y terminó satisfactoriamente.

Todo cambio conductual debe seguir TDD estricto: regresión roja por la causa
correcta, implementación mínima, prueba verde y verificación más amplia.
Antes de tests que consuman `dist/`, ejecutar `pnpm build`.

## 2. Estado implementado

### 2.1 Auditoría técnica

El diagnóstico completo está en
`docs/audits/system-reliability-redesign.md`. Se trazó la ruta productiva:

```text
goal -> repository grounding -> planning host -> Planner/LLM
     -> WorkBreakdown -> granularity policy -> graph compiler/contracts
     -> review/approval -> scheduler/waves -> leaf execution
     -> bottom-up integration -> candidate validation -> delivery
     -> journal, snapshots and UI projections
```

Las causas raíz están codificadas como `SRR-01` a `SRR-07`:

- `SRR-01` (crítico): la política selecciona tarde sobre un único árbol del
  LLM. Podar o colapsar ese árbol no equivale a explorar alternativas
  semánticas.
- `SRR-02` (crítico): la utilidad histórica pondera alivio de contexto,
  paralelismo, aislamiento y costos estructurales, pero no gatea ownership,
  seams completos, riesgo de integración, cobertura de criterios ni superficie
  de validación.
- `SRR-03` (alto): la propiedad de aceptación se deriva después de propagar
  intención ancestral a hojas. Eso puede duplicar criterios globales y vuelve
  implícita una decisión que debería ser revisable.
- `SRR-04` (alto): los seams tienen forma sintáctica, pero no expresan de manera
  suficiente productor, consumidor, compatibilidad, materialización, validación
  y dueño de la obligación.
- `SRR-05` (alto): la comparación de condiciones está contaminada parcialmente
  porque el LLM puede producir árboles distintos en cada planning.
- `SRR-06` (medio): se preservan fingerprints y attempts, pero la recuperación
  no tenía una representación inmutable completa de envelope, candidatos,
  selección e intención física.
- `SRR-07` (alto): una falla al registrar `run.failed` podía perder el hecho
  terminal durable aunque la ejecución original hubiera fallado.

La auditoría distingue defectos de producto, errores de diseño, brechas
arquitectónicas, límites del modelo y limitaciones experimentales. No concluye
que G6 haya demostrado superioridad de A, B o C.

### 2.2 PlanningEnvelope y validación determinista

Se agregó `packages/decomposer/src/planner/planning-envelope.ts`, exportado por
el índice de `@manyhands/decomposer`. El módulo contiene:

- `PlanningEnvelopeSchema` y `PlanningEnvelope` versionados;
- versión de política, snapshot del repositorio y digest del objetivo;
- presupuesto mínimo/máximo de candidatos;
- límites de contexto por hoja, paths por hoja y paralelismo;
- requisitos explícitos de exploración y validación;
- tipos de `CandidatePlan`, ownership de aceptación y especificaciones de seam;
- validación fail-closed del conjunto de candidatos;
- rechazo de candidatos fuera de snapshot, fuera de presupuesto, sin ownership
  explícito, con ownership duplicado/incompatible, sin aceptación local de hoja
  o con seams incompletos;
- selección determinista con desempate estable por `candidateId`;
- resultado explícito `replan_required` cuando ningún candidato válido puede
  seleccionarse.

La frontera se endureció con `createCandidatePlan()` y
`selectPlannerCandidate()`: el registro conserva hash estable, snapshot, digest
del objetivo, scopes, criterios explícitos, ownership, seams con participantes,
materialización y validación, obligaciones cross-layer y validación observable
por hoja. Un `WorkBreakdown[]` crudo se rechaza antes del score y no se usa para
inferir ownership o seams.

Este módulo todavía no está conectado como flujo productivo completo. Es un
contrato y un gate disponible; no debe presentarse como prueba de que la
política ya compara candidatos reales en producción.

### 2.3 Brief previo al planning y trabajo paralelo

El trabajo paralelo incorporó `GranularityPlanningBrief` en
`packages/decomposer/src/granularity/planning-brief.ts`. El brief comunica al
planner un presupuesto de exploración acotado, restricciones de contexto,
paralelismo, ownership, seams y gates esperados.

También se incorporó `planCandidates()` en
`packages/decomposer/src/planner/work-breakdown.ts`. Actualmente ese método
produce `WorkBreakdown[]`, no todavía un `CandidatePlanSet` tipado completo con
matriz de ownership y seams verificables. Esa diferencia es la brecha principal
de integración pendiente.

### 2.4 Persistencia del envelope y proyección

El host V2 ahora construye el brief, crea un `PlanningEnvelope` determinista,
persiste `planning.envelope_created` antes de continuar, entrega el brief al
planner y proyecta el envelope en el reducer de `packages/run-coordinator`.

Las piezas afectadas son:

- `apps/web/src/lib/server/runs/v2/planning-host.ts`;
- `packages/run-coordinator/src/domain/events.ts`;
- `packages/run-coordinator/src/reducer.ts`.

Los eventos estrictos permiten reconstruir la configuración inicial de planning
y, mediante `planning.candidates_evaluated`, el conjunto completo de
candidatos, hashes, diagnósticos, scores, ganador y eventual replan. El evento y
su reducer ya están implementados, pero aún no son emitidos por el host
productivo.

### 2.5 Receipts de fallas terminales

Se implementó `apps/web/src/lib/server/runs/v2/execution-failure-receipt.ts`.
El receipt se escribe de forma durable bajo el directorio de runs, con escritura
atómica y estados `pending`/`reconciled`. Conserva `receiptId`, `runId`,
`operationId`, fencing token, timestamp, área (`planning` o `execution`), causa
original y error de persistencia.

`execution-pipeline.ts` reconcilia receipts pendientes antes de ejecutar y
preserva el error original junto con un eventual error del recorder. El mismo
mecanismo cubre `planning.failed`: `planning-host.ts` reconcilia receipts de
planning antes de reintentar y no convierte una falla de persistencia en éxito.

La reconciliación es idempotente. Un receipt no habilita un retry semántico
abierto ni inventa un resultado terminal.

## 3. Commits locales relevantes

Todos son commits locales de esta rama. No se hizo push.

| Commit | Contenido |
| --- | --- |
| `b9884bc` | Auditoría técnica completa y causas raíz SRR-01..SRR-07. |
| `8e17d9e` | Tipos, schema y validación inicial de `PlanningEnvelope`/`CandidatePlan`. |
| `1536ef0` | Enforcement del presupuesto de candidatos. |
| `7390b6e` | Trabajo paralelo integrado: brief, prompt y `planCandidates()`. |
| `53c3e40` | ADR 0013 sobre la frontera de candidate planning. |
| `30ca18f` | Normalización del final del ADR. |
| `ba58caf` | Receipt durable y reconciliación de fallas de ejecución. |
| `a7d89e4` | Persistencia del envelope y entrega del brief al host/planner. |
| `3634200` | Auditoría actualizada con la brecha de migración productiva. |
| `f8c8c8c` | Primer handoff operativo. |
| `e181acc` | Receipts genéricos para fallas de planning y ejecución. |
| `59c71a7` | Contrato tipado fail-closed de `CandidatePlan` y regresiones de selección. |
| `4d19171` | Evento/reducer para reconstruir evaluación, selección y replan de candidatos. |
| `74d6b67` | Ajuste de fixtures de regresión para ownership tipado. |

## 4. Pruebas y estado real de verificación

### 4.1 Regresiones rojas que guiaron los fixes

1. `tests/execution-failure-receipt.test.ts` comenzó roja porque faltaba el
   módulo de receipt. Después de implementar almacenamiento, reconciliación e
   idempotencia, quedó verde.
2. `tests/planning-v2-pipeline.test.ts` comenzó roja porque el host no pasaba el
   brief ni registraba el envelope. Después del cableado de host, evento y
   reducer, quedó verde.

### 4.2 Pruebas verdes focalizadas

Las pruebas focalizadas se ejecutaron después de `pnpm build`:

```text
pnpm build
pnpm exec vitest run tests/execution-failure-receipt.test.ts tests/planning-v2-pipeline.test.ts
=> 2 archivos, 9 tests passing
```

También hubo una ejecución focalizada previa del conjunto de planning,
adaptive y selección de estrategia:

```text
pnpm build
pnpm exec vitest run tests/planning-v2-pipeline.test.ts tests/planning-v2-adaptive.test.ts tests/run-granularity-strategy-selected.test.ts
=> 3 archivos, 11 tests passing
```

El resultado del archivo de receipts después del último ajuste fue 3/3
passing.

### 4.3 Gates globales pendientes

La secuencia global fue iniciada pero se interrumpió mientras la suite estaba
corriendo para preservar créditos. Por lo tanto, estos gates no están
aprobados:

```text
pnpm build
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm web:build
git diff --check
```

El siguiente agente debe reanudar desde `pnpm build`, con el árbol limpio, y
corregir únicamente regresiones atribuibles a esta rama.

En esta sesión `pnpm build` falló antes de compilar por instalación local
inconsistente (`tsup` no pudo cargar `tinyglobby`); intentos de reparación
frozen/offline fallaron porque falta el tarball de `node-pty`. Por eso las
regresiones nuevas y los gates globales de esta sesión quedaron sin ejecución y
no se declaran verdes.

## 5. Bloqueo actual: integración con el trabajo paralelo

El host productivo todavía invoca `dependencies.plan()` una sola vez. Aunque
existe `planCandidates()`, el flujo todavía no transporta candidatos tipados
desde el planner hacia validación y selección.

La solución incorrecta sería inferir ownership desde `acceptanceIntentIds`,
partir el árbol por paths o adaptar silenciosamente la política para fabricar
candidatos. Eso recrearía SRR-03 y contradice la frontera del rediseño:

- política: restricciones y selección;
- Planner/LLM: unidades semánticas y alternativas;
- Graph Compiler: validación de artifacts, seams, scopes y obligaciones;
- scheduler: agenda, no reinterpreta intención;
- executor/integrator: ejecuta contratos fijados, no inventa alcance.

Otra conversación ya está trabajando en la política de granularidad. No cambiar
sin coordinación explícita estos archivos:

- `packages/decomposer/src/granularity/strategy-selector.ts`;
- `packages/decomposer/src/granularity/adaptive-planning.ts`;
- `packages/decomposer/src/granularity/planning-brief.ts`;
- `packages/decomposer/src/planner/prompt.ts`;
- `packages/decomposer/src/planner/work-breakdown.ts`.

El siguiente agente debe acordar la frontera de tipos con ese trabajo paralelo y
hacer luego la integración vertical sin sobrescribirlo.

## 6. Secuencia exacta para continuar

### Paso 0: reanudar con seguridad

```powershell
git status --short
git diff HEAD
git branch --show-current
git log -5 --oneline --decorate
```

Confirmar rama y árbol antes de modificar. Leer este handoff, la auditoría,
`docs/adr/0013-policy-guided-candidate-planning.md` y el código actual.

### Paso 1: cerrar el contrato de salida del planner

Escribir primero una regresión roja que demuestre que un `WorkBreakdown[]` sin
ownership/seams completos no puede llegar a selección.

Elegir la migración más pequeña entre:

- extender el resultado para que cada candidato sea un `CandidatePlan` completo;
- mantener `WorkBreakdown` como semántica del planner y agregar un adaptador
  explícito que lo envuelva en `CandidatePlan`, sin inferir ownership de IDs.

El contrato debe tener datos tipados para identidad/hash, snapshot, digest del
objetivo, unidades semánticas, scopes, criterios `leafAcceptance`,
`seamAcceptance` y `globalAcceptance`, ownership, productor/consumidor,
compatibilidad/validación de seams y obligaciones cross-layer.

### Paso 2: conectar la exploración acotada

Escribir una regresión roja que compruebe que el host no usa una sola llamada
cuando el envelope exige el rango de candidatos. Luego:

1. adaptar la dependencia del planner para invocar `planCandidates()` con brief
   y presupuesto;
2. conservar una ruta explícita de replay para candidatos congelados;
3. deduplicar por hash sin reintentos abiertos;
4. preservar un fallo pre-candidate como fallo, no como candidato artificial;
5. mantener lectura compatible de runs históricos.

Hacer esta adaptación en el host/adaptador, no cambiando fórmulas o umbrales
experimentales.

### Paso 3: compilar y validar cada candidato antes de seleccionar

Agregar tests rojos para seam faltante, ownership ambiguo, criterio sin dueño,
criterio global duplicado como obligación local, scope fuera del grounding,
contrato sin productor/consumidor/test de compatibilidad, hoja sin validación
observable y dependencia semántica representada sólo por paths compartidos.

Implementar validación fail-closed y garantizar que sólo candidatos válidos
entren a la política. Scheduler y executor no deben interpretar intención
adicional.

### Paso 4: selección reproducible y replan diagnosticable

Reutilizar la selección determinista existente sobre el conjunto validado sin
mover la fórmula congelada de G6. Persistir envelope, versión de política,
hashes, resultado de cada gate, score, ganador, desempate y
`replan_required` con razón estructurada.

Agregar pruebas para que el mismo envelope, snapshot, conjunto y configuración
produzcan la misma selección serializada, y para que A/B/C o futuras políticas
se evalúen sobre el mismo conjunto congelado.

### Paso 5: eventos, reducer y diagnóstico de operador

Agregar eventos versionados y snapshots para reconstruir todos los candidatos,
rechazos, scores, ganador y motivo de replan. La UI debe reutilizar el workspace
existente, sin crear destinos primarios nuevos ni navegación de
Tasks/Planning/Integration/Interfaces.

### Paso 6: recuperación y gates finales

Agregar replay/reconciliación que demuestre que una reparación no borra
intención, criterios, seams ni evidencia. Mantener errores de planning,
compilación, ejecución e integración clasificados.

Ejecutar en este orden:

```powershell
pnpm build
pnpm exec vitest run <tests focalizados>
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm web:build
git diff --check
git diff --numstat
```

Antes de cada commit, normalizar archivos propios a LF, revisar el diff y crear
un commit local pequeño y coherente.

## 7. Criterios de aceptación del rediseño

No considerar terminado hasta demostrar con tests deterministas que:

1. mismo conjunto de candidatos y configuración produce la misma selección;
2. la política no inventa tareas, paths ni seams;
3. los criterios globales no se duplican en hojas incompatibles;
4. seam incompleto u ownership ambiguo no llega a ejecución;
5. un cambio cross-layer conserva una obligación verificable;
6. una reparación no borra intención ni evidencia de un hijo;
7. existe replan con diagnóstico concreto y acotado;
8. A/B/C se evalúan sobre candidatos idénticos cuando corresponde;
9. eventos y snapshots reconstruyen exactamente la decisión;
10. decisiones pendientes no bloquean trabajo independiente;
11. los errores permanecen clasificados y no se convierten en éxito;
12. todos los gates globales tienen resultado registrado.

## 8. Límites: afirmaciones que no se deben hacer

- No está demostrado que la política adaptativa sea superior, inferior o igual
  a A/B en términos experimentales.
- No está demostrado que el planner produzca consistentemente candidatos válidos.
- El conjunto tipado ya está conectado al host y al Graph Compiler; falta sólo
  conservar evidencia de los gates globales finales antes de declarar cierre.
- No está aprobada la suite global de esta rama.
- No hay autorización para lanzar runs pagos.
- Los resultados adversos de G6 siguen siendo evidencia histórica preservada y
  no deben reformularse para validar el rediseño.

## 9. Entrega de esta sesión

La continuación cerró la frontera acordada con el trabajo paralelo. El planner
emite drafts tipados y acotados; el host valida, puntúa, persiste y selecciona;
el Graph Compiler recibe la intención congelada y falla si se la sustituye. Se
agregó replay A/B/C sobre candidatos idénticos, sin runs pagos ni cambios en
fórmulas, pesos, umbrales u oráculos G6. Los commits nuevos quedan registrados
en el log local de `codex/system-reliability-redesign`. No se hizo push. La
integración en `main` sólo procede después de la revisión Standards/Spec y de
todos los gates globales.
