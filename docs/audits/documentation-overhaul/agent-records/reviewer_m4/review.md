# Auditoría y Revisión Crítica — Hito 4: Persistence, Engine & Coordination READMEs

**Fecha**: 2026-08-18  
**Revisor**: Reviewer M4 (Reviewer & Adversarial Critic)  
**Veredicto**: `REQUEST_CHANGES`  
**Alcance**:
- `packages/run-store/README.md`
- `packages/trace-store/README.md`
- `packages/run-engine/README.md`
- `packages/run-coordinator/README.md`
- `packages/orchestrator-graph/README.md`
- `packages/execution-core/README.md` (verificación de snippet)

---

## 1. Resumen Ejecutivo de Revisión

Se ha llevado a cabo una inspección exhaustiva, línea por línea, de los 5 archivos `README.md` generados para el Hito 4 y la actualización del snippet en `packages/execution-core/README.md`. La verificación contrastó la documentación contra el código fuente real en `packages/*/src/`, los esquemas Zod, las firmas TypeScript exportadas en `index.ts`, la ejecución de compilación (`pnpm build`) y verificación estática de tipos (`pnpm -r --filter "./packages/*" typecheck`).

### Evaluación General:
- **Calidad Pedagógica y Redacción en Español**: Excelente. Explicaciones claras, profundas, conceptos de dominio bien articulados manteniendo términos y símbolos en inglés.
- **Estructura Modular**: Las 7 secciones estándar requeridas están presentes en los 5 paquetes.
- **Transición y Delimitación Arquitectónica**: Correcta. `orchestrator-graph` está adecuadamente calificado como transicional hacia `run-engine` + `apps/daemon`, y la separación de autoritariedad entre `run-store` (dominio) y `trace-store` (diagnóstico) es precisa.
- **Integridad Técnica y Ausencia de Fachadas**: No se detectaron violaciones de integridad ni simulaciones ficticias.
- **Discrepancias de Símbolos y Snippets de Código (Requiere Corrección)**: Se identificaron discrepancias en nombres de clases exportadas (`FilePhysicalEffectReceiptStore` vs `FileEffectReceiptStore`, `RunSnapshotStore` vs `SnapshotStore`, adaptadores de fábrica vs clases), esquemas Zod en payloads de eventos y propiedades del objeto `RunProjection` (`status` / `pendingDecisions` vs `lifecycle` / `decisions`) en snippets de código que causarían errores de tipado o excepciones en tiempo de ejecución al ser utilizados.

Por tanto, el veredicto formal es **`REQUEST_CHANGES`** para subsanar los hallazgos detallados a continuación.

---

## 2. Hallazgos Detallados (Findings)

### [Major] Finding 1: Discrepancia en nombre de clase `FilePhysicalEffectReceiptStore` (`run-store`)
- **Qué**: El README cita `FileEffectReceiptStore` repetidamente en lugar de su nombre real `FilePhysicalEffectReceiptStore`.
- **Dónde**: `packages/run-store/README.md` (Sección 1 ítem 2, Sección 2 desglose de `effect-receipt-store.ts`, Sección 3.2 ítem 2, Sección 4.1 tabla fila 3, Sección 5 tabla fila 3).
- **Por qué**: En `packages/run-store/src/effect-receipt-store.ts` (línea 45), la clase exportada es `FilePhysicalEffectReceiptStore`. Quien intente importar `FileEffectReceiptStore` obtendrá un error de exportación no encontrada.
- **Sugerencia**: Reemplazar `FileEffectReceiptStore` por `FilePhysicalEffectReceiptStore` en todo el documento.

---

### [Major] Finding 2: Discrepancia en nombre de clase `RunSnapshotStore` (`run-store`)
- **Qué**: El README cita `SnapshotStore` en lugar de `RunSnapshotStore`.
- **Dónde**: `packages/run-store/README.md` (Sección 1 ítem 4/5, Sección 2 desglose de `snapshot-store.ts`, Sección 4.1 tabla fila 7).
- **Por qué**: En `packages/run-store/src/snapshot-store.ts` (línea 21), la clase exportada es `RunSnapshotStore`. No existe la clase `SnapshotStore`.
- **Sugerencia**: Reemplazar `SnapshotStore` por `RunSnapshotStore`.

---

### [Major] Finding 3: Snippet con payload y propiedades inválidas en `run-store`
- **Qué**: El snippet en la Sección 4.3 de `packages/run-store/README.md` construye eventos que no cumplen con `RunEventSchema` y accede a una propiedad inexistente de `RunProjection`.
- **Dónde**: `packages/run-store/README.md`, líneas 188-210.
- **Por qué**:
  1. Para `run.created`: pasa `timestamp`, `runId`, `rootGoal`, `initiator` en la raíz del objeto, cuando `RunEventSchema` exige `occurredAt: string` y `payload: { goal: string, definition?: ProductRunDefinition }`.
  2. Para `effect.requested`: pasa `timestamp`, `effectId`, `inputDigest`, `kind` en la raíz, cuando exige `occurredAt: string` y `payload: { intent: EffectIntent }`.
  3. `projection.status`: `RunProjection` define `projection.lifecycle`, no `status`. Al ejecutar `console.log(projection.status)` se obtiene `undefined`.
- **Sugerencia**:
  Ajustar el snippet para estructurar los eventos con `occurredAt` y `payload: { ... }` válidos según `RunEventSchema`, y consultar `projection.lifecycle`.

---

### [Major] Finding 4: Importación errónea en snippet de `run-engine`
- **Qué**: El snippet en la Sección 4.3 importa `FileEffectReceiptStore` desde `@manyhands/run-store`.
- **Dónde**: `packages/run-engine/README.md`, líneas 146 y 157.
- **Por qué**: `@manyhands/run-store` no exporta `FileEffectReceiptStore`, sino `FilePhysicalEffectReceiptStore`. Esto causa un error de compilación TypeScript inmediato.
- **Sugerencia**: Cambiar la importación e instanciación a `FilePhysicalEffectReceiptStore`.

---

### [Major] Finding 5: Representación de Adaptadores Físicos en `run-engine`
- **Qué**: La tabla de la Sección 4.1 y la Sección 2 describen los adaptadores físicos como clases (`ModelCallPhysicalEffectAdapter`, `SandboxCreatePhysicalEffectAdapter`, etc.), e incluye un adaptador inexistente `ProcessSupervisePhysicalEffectAdapter`.
- **Dónde**: `packages/run-engine/README.md` (Sección 1 ítem 2, Sección 2 desglose de `physical-effect-adapters.ts`, Sección 4.1 tabla filas 8 a 12).
- **Por qué**:
  1. En `packages/run-engine/src/physical-effect-adapters.ts`, los adaptadores se exportan como funciones de fábrica (`createModelCallPhysicalEffectAdapter`, `createSandboxCreatePhysicalEffectAdapter`, `createGitMutationPhysicalEffectAdapter`, `createArtifactMaterializePhysicalEffectAdapter`, `createValidationPhysicalEffectAdapter`, `createDeliveryPhysicalEffectAdapter`, `createCleanupPhysicalEffectAdapter`) que retornan objetos de tipo `PhysicalEffectAdapter`.
  2. No existe un adaptador `ProcessSupervisePhysicalEffectAdapter` en `run-engine` (la supervisión de procesos reside en `execution-core` y `windows-job-runner`).
- **Sugerencia**:
  Actualizar la tabla y el desglose para reflejar las funciones de fábrica reales (`createModelCallPhysicalEffectAdapter`, `createSandboxCreatePhysicalEffectAdapter`, `createGitMutationPhysicalEffectAdapter`, `createArtifactMaterializePhysicalEffectAdapter`, `createValidationPhysicalEffectAdapter`, `createDeliveryPhysicalEffectAdapter`, `createCleanupPhysicalEffectAdapter`).

---

### [Major] Finding 6: Snippet con esquema inválido y `TypeError` en `run-coordinator`
- **Qué**: En la Sección 4.3 de `packages/run-coordinator/README.md`, el evento `decision.raised` no cumple con `DecisionInputSchema` y se accede a una propiedad inexistente `pendingDecisions` en `RunProjection`.
- **Dónde**: `packages/run-coordinator/README.md`, líneas 191-208.
- **Por qué**:
  1. En `domain/decisions.ts`, `DecisionInputSchema` requiere `{ id, kind, question, options: [{ id, label }], affectedNodeIds, evidenceRefs, impact }`. El snippet pasa `{ decisionId, runId, title, description, options: [{ optionId, title }] }`, lo cual dispara una excepción Zod en `reduceRun`.
  2. En la línea 208, `Object.keys(updatedProjection.pendingDecisions)` lanza `TypeError: Cannot convert undefined or null to object` porque `RunProjection` almacena las decisiones en `updatedProjection.decisions` y los IDs pendientes en `updatedProjection.readiness.pendingDecisionIds`.
- **Sugerencia**:
  Actualizar el payload de `decision.raised` para satisfacer `DecisionInputSchema` y acceder a `Object.keys(updatedProjection.decisions)`.

---

### [Minor] Finding 7: Falta de `FencedRunActorJournal` en tabla de `run-engine`
- **Qué**: La Sección 4.1 lista `RunActorJournalPort` (interfaz), pero no menciona la clase concreta `FencedRunActorJournal` que implementa dicho puerto.
- **Dónde**: `packages/run-engine/README.md`, Sección 4.1.
- **Por qué**: `FencedRunActorJournal` es la clase clave en `src/run-event-journal.ts` que vincula el `RunActor` con `JsonlRunEventStore`.
- **Sugerencia**: Incorporar `FencedRunActorJournal` en la tabla de símbolos.

---

### [Minor] Finding 8: Uso de `projection.status` en snippet de `run-engine`
- **Qué**: En la línea 197 de `packages/run-engine/README.md`, el snippet imprime `projection.status`.
- **Dónde**: `packages/run-engine/README.md`, línea 197.
- **Por qué**: En `RunProjection` el estado del ciclo de vida se denomina `lifecycle` (`RunLifecycle`), no `status`.
- **Sugerencia**: Reemplazar `projection.status` por `projection.lifecycle`.

---

## 3. Matriz de Reclamos Verificados (Verified Claims)

| Paquete / Archivo | Afirmación / Reclamo | Método de Verificación | Resultado |
|---|---|---|---|
| `packages/trace-store` | 62 tipos de eventos en `TraceEventTypeSchema` | Inspección de `src/trace-types.ts` (líneas 4-64) | ✅ PASÓ |
| `packages/trace-store` | Sanitización recursiva `redactSecrets` y sobres con checksum SHA-256 | Inspección de `src/jsonl-trace-store.ts` | ✅ PASÓ |
| `packages/trace-store` | Separación estricta de autoridad (telemetría no autoritativa) | Revisión conceptual contra `AGENTS.md` y `PROJECT.md` | ✅ PASÓ |
| `packages/trace-store` | Snippet de uso ejecutable | Inspección de firmas de `JsonlTraceStore` y `append` | ✅ PASÓ |
| `packages/orchestrator-graph` | `CanonicalExecutionDriver`, `assertNoConcurrentResourceConflict`, `executionBaseArtifacts` | Inspección de `src/index.ts` y archivos de `src/` | ✅ PASÓ |
| `packages/orchestrator-graph` | Estado transicional hacia `run-engine` + `apps/daemon` | Verificación con `docs/plans/2026-08-12-...` Stage 11 | ✅ PASÓ |
| `packages/orchestrator-graph` | Snippet de verificación de invariantes de concurrencia | Inspección de tipos y opciones de `CanonicalExecutionDriver` | ✅ PASÓ |
| `packages/execution-core` | Snippet actualizado con `SimpleGitRunner` | Inspección de `src/git/runner.ts` e `index.ts` | ✅ PASÓ |
| `packages/run-coordinator` | 42 eventos canónicos en `RunEventSchema` | Conteo e inspección en `domain/events.ts` | ✅ PASÓ |
| `packages/run-coordinator` | Función pura reductora `reduceRun` y `foldRun` | Inspección de `src/reducer.ts` | ✅ PASÓ |
| `packages/run-coordinator` | 7 clases de fallos en `FailureClassSchema` | Inspección de `src/domain/failures.ts` | ✅ PASÓ |
| `packages/run-store` | Log append-only `.events.v2.jsonl`, `acquireDurableLock`, `EventStoreCompactor` | Inspección de `src/jsonl-event-store.ts`, `durable-lock.ts`, `compactor.ts` | ✅ PASÓ |
| `packages/run-store` | Fencing tokens con `FencingAuthority` y detección de stale tokens | Inspección de `src/event-store.ts` y `jsonl-event-store.ts` | ✅ PASÓ |
| `packages/run-engine` | Modelo de Actores por corrida con `RunActor` y mailbox secuencial | Inspección de `src/run-actor.ts` y `run-actor-registry.ts` | ✅ PASÓ |
| Monorepo General | Typecheck en todos los paquetes del workspace | `pnpm -r --filter "./packages/*" typecheck` | ✅ PASÓ (código 0) |
| Monorepo General | Build de paquetes (ESM, CJS, DTS) | `pnpm build` | ✅ PASÓ (código 0) |

---

## 4. Análisis Crítico y Stress-Testing Adversarial

### Escenario 1: Copiado directo de snippets de documentación por desarrolladores
- **Ataque**: Un desarrollador copia el snippet de `run-store/README.md` o `run-coordinator/README.md` para integrar un nuevo componente o test.
- **Resultado actual**:
  - `run-store`: El código arroja `ZodError` en `appendFenced` porque las propiedades `timestamp`, `rootGoal`, etc. no coinciden con `RunEventSchema`.
  - `run-coordinator`: El código arroja `ZodError` en `reduceRun` por esquema de decisión inválido, seguido de un `TypeError` fatal en `Object.keys(updatedProjection.pendingDecisions)`.
  - `run-engine`: Falla la compilación por importar `FileEffectReceiptStore` (inexistente).
- **Mitigación**: Corregir los 3 snippets con código 100% tipado y conforme a los esquemas Zod reales.

### Escenario 2: Ambigüedad en la arquitectura de adaptadores en `run-engine`
- **Ataque**: Un implementador asume que existen clases exportadas `ModelCallPhysicalEffectAdapter` y busca extenderlas o instanciarlas directamente.
- **Resultado actual**: `TypeError: ModelCallPhysicalEffectAdapter is not a constructor`.
- **Mitigación**: Describir las funciones de fábrica (`createModelCallPhysicalEffectAdapter`, etc.) y el tipo `PhysicalEffectAdapter`.

---

## 5. Recomendaciones de Corrección Inmediata para el Agente Worker

1. **`packages/run-store/README.md`**:
   - Reemplazar todas las ocurrencias de `FileEffectReceiptStore` por `FilePhysicalEffectReceiptStore`.
   - Reemplazar `SnapshotStore` por `RunSnapshotStore`.
   - Corregir el snippet de la Sección 4.3 para usar eventos válidos según `RunEventSchema` (usando `occurredAt`, `payload: { goal: ... }`, `payload: { intent: ... }`) y cambiar `projection.status` por `projection.lifecycle`.

2. **`packages/run-engine/README.md`**:
   - Corregir la importación del snippet en la Sección 4.3 a `FilePhysicalEffectReceiptStore`.
   - Actualizar la tabla de la Sección 4.1 y la Sección 2 para listar las funciones de fábrica `create*PhysicalEffectAdapter` e incluir `FencedRunActorJournal`.
   - Cambiar `projection.status` a `projection.lifecycle`.

3. **`packages/run-coordinator/README.md`**:
   - Corregir el payload de `decision.raised` en el snippet de la Sección 4.3 para que cumpla estrictamente con `DecisionInputSchema` (`id`, `kind`, `question`, `options: [{ id, label }]`, `affectedNodeIds`, `evidenceRefs`, `impact`).
   - Cambiar `updatedProjection.pendingDecisions` por `updatedProjection.decisions`.
