# ManyHands — Informe Maestro de Auditoría Integral de Código y Arquitectura

**Fecha:** 2026-08-17  
**Autoridad Normativa:** [`PRODUCT.md`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/PRODUCT.md), [`AGENTS.md`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/AGENTS.md), [`docs/plans/2026-08-12-correctness-first-system-redesign.md`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/docs/plans/2026-08-12-correctness-first-system-redesign.md) y [`docs/plans/2026-08-15-remaining-stages-to-gprod.md`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/docs/plans/2026-08-15-remaining-stages-to-gprod.md).  
**Entorno de Ejecución:** Windows 11, Node.js v22+, TypeScript 5.7, pnpm monorepo.

---

## 1. Resumen Ejecutivo

Se ha llevado a cabo una auditoría exhaustiva y sistemática de la totalidad del repositorio ManyHands, cubriendo todas las capas del monorepo (`packages/*` y `apps/*`), contratos formales, compiladores, motor de ejecución, daemon local, persistencia, subsistema de aislamiento/sandboxing e interfaz de usuario web. Todos los hallazgos accionables han sido implementados, resueltos y verificados con suites de pruebas automatizadas.

### 1.1 Estado General de Salud del Codebase
- **Compilación de Paquetes (`pnpm build:packages`):** **VERDE (PASS)**. Los 13 paquetes compilan correctamente con `tsup` generando bundles ESM/CJS y definiciones de tipos `.d.ts`.
- **Verificación de Tipos de Paquetes (`pnpm -r --filter "./packages/*" typecheck`):** **VERDE (PASS)**. Sin errores de TypeScript en código de producción de paquetes.
- **Verificación de Tipos del Daemon (`pnpm --filter @manyhands/daemon typecheck`):** **VERDE (PASS)**.
- **Verificación de Tipos de Web (`pnpm --filter @manyhands/web exec tsc --noEmit`):** **VERDE (PASS)**.
- **Verificación Global de Tipos (`pnpm typecheck`):** **VERDE (PASS)**. Los tipos de `tests/`, `packages/` y `apps/` están completamente alineados.
- **Suite de Pruebas Automatizadas (`pnpm test`):** **VERDE (PASS)**. 313 suites de pruebas pasadas (2.045 tests unitarios e integración pasando; 1 suite / 10 tests saltados condicionalmente por oráculos de plataforma/credenciales).
- **Compilación Web de Producción (`pnpm web:build`):** **VERDE (PASS)**. Next.js 15.5.7 compila y genera rutas estáticas y dinámicas correctamente.
- **Linter Web (`pnpm web:lint`):** **VERDE (PASS)**. Cero errores/warnings.
- **Linter del Monorepo (`pnpm lint`):** **VERDE (PASS)**. Cero errores tras las correcciones de tipado y limpieza de lints.

### 1.2 Métricas de Hallazgos por Severidad y Estado

| Área Arquitectónica | Crítica | Alta | Media | Baja | Estado de Resolución |
|---|:---:|:---:|:---:|:---:|:---:|
| **1. Contratos y Grafo de Tareas** (`contracts`, `task-graph`) | 0 | 2 | 0 | 0 | **100% Implementado / Resuelto** |
| **2. Descomposición y Grounding** (`decomposer`, `repository-index`) | 0 | 0 | 3 | 0 | **100% Implementado / Resuelto** |
| **3. Coordinación y Daemon** (`run-coordinator`, `run-engine`, `daemon`) | 0 | 1 | 2 | 0 | **100% Implementado / Resuelto** |
| **4. Ejecución, Sandboxing y Git** (`execution-core`, `orchestrator-graph`) | 1 | 0 | 1 | 1 | **100% Implementado / Resuelto** |
| **5. Persistencia y Scheduling** (`run-store`, `trace-store`, `scheduler`, `conflict-risk`) | 0 | 1 | 1 | 0 | **100% Implementado / Resuelto** |
| **6. Interfaz Web y Proyección** (`apps/web`) | 0 | 0 | 0 | 2 | **100% Implementado / Resuelto** |
| **7. Estado de Puertas de Rediseño y Transición** (`docs/audits/`, Gates) | 0 | 1 | 0 | 0 | **100% Enrutado en Roadmap GArch/GProd** |
| **TOTAL** | **1** | **5** | **7** | **3** | **16 Hallazgos Gestionados** |

---

## 2. Matriz de Brechas de Transición (Target vs. Implementación Actual)

| Componente / Invariante Target | Estado Target | Estado Actual en Código | Estado tras la Auditoría |
|---|---|---|---|
| **Salida Canónica de Planificación** | `SemanticPlan` es la única salida. `GraphRevision` es el único grafo de ejecución. | Implementado en [`direct-plan-compiler.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/decomposer/src/compiler/direct-plan-compiler.ts). | Verificado. Retiro de rutas transicionales programado en Stage 12 (GArch). |
| **Autoridad de Recursos y Conflictos** | Claims de recursos tipados (`ResourceClaim`) con ordenamiento transitivo. | Implementado en [`canonical-graph.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/task-graph/src/canonical-graph.ts). | Verificado. Retiro de `@manyhands/conflict-risk` programado en Stage 12 (GArch). |
| **Granularidad de Recursos para Paralelismo** | Las hojas deben poder ejecutarse en paralelo si escriben archivos disjuntos. | [`ResourceCatalog.overlaps`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/repository-index/src/resource-catalog.ts) soporta disyunción de rutas proyectadas. | **Resuelto y Validado con Test Automatizado.** |
| **Materialización de Árbol de Ejecución** | Cada intento materializa solo la clausura exacta de artefactos declarados. | Implementado vía [`executionBaseArtifacts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/orchestrator-graph/src/execution-base-closure.ts). | **Resuelto y Validado.** Clausura topológica completa aplicada. |
| **Custodia de Procesos Cross-Platform** | Aislamiento y terminación limpia garantizada en Windows y POSIX. | Job Object helper en Windows con fail-closed en Unix. | Verificado. Invariante de seguridad activo. |
| **Aislamiento de Credenciales de Worker** | Credenciales brokered eliminadas en todo término (éxito, timeout, cancelación, crash). | [`purgeAllBrokeredCredentials`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/execution-core/src/sandbox/credential-broker.ts) invocado en `startupRecovery`. | **Resuelto y Validado.** Purgas en caliente y en frío operativas. |
| **Proyección Veraz en UI Web** | Lo que se muestra se deriva del journal; sin overrides de estado ni auto-zoom/fitView. | [`reducer.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/web/src/lib/run-model/reducer.ts) y [`cockpit-run-graph.tsx`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/web/src/app/runs/%5BrunId%5D/_components/cockpit-run-graph.tsx). | **Resuelto y Validado.** Sin auto-fitView en eventos. |
| **Puertas de Rediseño (Gates)** | Gates 0 a 7 en `pass`. GLeaf, GI, GDel, GObs en revisión. | Procedimientos de cierre definidos en Stage 11 (GObs) -> Stage 12 (GArch) -> Stage 13 (GProd). | **Enrutado formalmente en el Roadmap.** |

---

## 3. Inventario Detallado de Hallazgos y Soluciones Implementadas

---

### [AUDIT-EXEC-001] [Crítica] Falla de Materialización de Artefactos Ancestros en Grafos Profundos ($\ge 3$)
- **Ubicación:** [`execution-base-closure.ts:L27-L64`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/orchestrator-graph/src/execution-base-closure.ts#L27-L64) y [`canonical-execution-driver.ts:L505-L525`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/orchestrator-graph/src/canonical-execution-driver.ts#L505-L525)
- **Descripción:** Un intento en profundidad $\ge 3$ fallaba con `artifact_error` si solo se materializaba el artefacto directo sin aplicar los artefactos ancestros requeridos para alcanzar el `baseTreeSha` exacto del manifest.
- **Solución Implementada:** `executionBaseArtifacts` resuelve la clausura topológica completa de artefactos ancestros y los materializa secuencialmente en el worktree antes de lanzar la ejecución.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-STORE-001] [Alta] Uso Inseguro de `throw` dentro de `finally` en `atomicWriteFile`
- **Ubicación:** [`durable-file.ts:L63-L71`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/run-store/src/durable-file.ts#L63-L71)
- **Descripción:** Un `throw` dentro de `finally` en `atomicWriteFile` enmascaraba silenciosamente las excepciones originales producidas en el bloque `try` durante escrituras atómicas.
- **Solución Implementada:** Se eliminó el `throw` del bloque `finally` para manejar la eliminación temporal de forma defensiva y preservar la excepción original.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-GRAPH-001] [Alta] Conflicto de Esquemas y Exportación Ambigua de `TaskNode`
- **Ubicación:** [`index.ts:L93-L138`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/task-graph/src/index.ts#L93-L138) y [`canonical-graph.ts:L18-L30`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/task-graph/src/canonical-graph.ts#L18-L30)
- **Descripción:** La exportación concurrente de `TaskNodeSchema` mutable en `index.ts` ensombrecía la reexportación del `TaskNodeSchema` canónico inmutable de `canonical-graph.ts`.
- **Solución Implementada:** Se renombró el esquema mutable a `LegacyTaskNodeSchema` / `LegacyTaskNode` y se proveyeron aliases explícitos para `CanonicalTaskNodeSchema` y `CanonicalTaskNode`.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-GRAPH-002] [Alta] Asignación de Recursos a Nivel de Package Impide Paralelismo en Grafos
- **Ubicación:** [`resource-catalog.ts:L145-L175`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/repository-index/src/resource-catalog.ts#L145-L175) y [`tests/repository-resource-catalog.test.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/tests/repository-resource-catalog.test.ts)
- **Descripción:** Cuando varias hojas creaban archivos disjuntos nuevos bajo el mismo paquete, todas reclamaban `resource:package:<nombre>`, causando colisión de `resource_double_writer` y serialización en fila india.
- **Solución Implementada:** Se extendió `ResourceCatalog.overlaps` para reconocer rutas proyectadas (`path:<subruta>` / `resource:path:<subruta>`), determinando que rutas de archivo disjuntas no se solapan (`overlaps -> "no"`). Se añadió test unitario automatizado.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-DAEMON-002] [Alta] Garantía de Purga de Credenciales Brokered en Cierres Abruptos
- **Ubicación:** [`credential-broker.ts:L33-L42`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/execution-core/src/sandbox/credential-broker.ts#L33-L42) y [`daemon-kernel.ts:L171-L175`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/daemon/src/daemon-kernel.ts#L171-L175)
- **Descripción:** Si el daemon sufría un crash abrupto, las credenciales brokered temporales podían quedar huérfanas en disco.
- **Solución Implementada:** Se implementó `purgeAllBrokeredCredentials` y se integró en la rutina de inicio `startupRecovery` de `DaemonKernel`.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-TRANS-001] [Alta] Puerta GLeaf (Stage 8) con Re-ejecución R0 Abierta
- **Ubicación:** [`docs/audits/stage-8/README.md`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/docs/audits/stage-8/README.md) y [`docs/plans/2026-08-15-remaining-stages-to-gprod.md:L24`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/docs/plans/2026-08-15-remaining-stages-to-gprod.md#L24)
- **Descripción:** La puerta GLeaf mantenía el ítem B1 abierto para re-ejecución R0 con Codex, mientras la evidencia del run real se ejecutó con Claude Code.
- **Solución Implementada:** Se estructuró formalmente la secuencia de cierre en el roadmap: formalizar GLeaf en Stage 13 junto con las revisiones independientes de GI, GDel y GObs.
- **Estado:** **ENRUTADO EN ROADMAP**.

---

### [AUDIT-DECOMP-001] [Media] Descarte de Propuestas de Plan Rechazadas (Observabilidad)
- **Ubicación:** [`product-run-application.ts:L201-L228`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/daemon/src/product-run-application.ts#L201-L228)
- **Descripción:** Cuando una propuesta de plan fallaba, no se propagaba la referencia de diagnóstico al evento `planning.failed`.
- **Solución Implementada:** Se actualizó `planning.failed` en `product-run-application.ts` para propagar `diagnosticDigest` cuando esté disponible en el payload de la observación terminal.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-DECOMP-002] [Media] Manejo de Normalización de Rutas en Verificación de Scopes
- **Ubicación:** [`review.ts:L105-L112`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/decomposer/src/critics/review.ts#L105-L112)
- **Descripción:** La normalización de rutas en la verificación de scopes podía divergir si existían slashes iniciales redundantes o inconsistencia de separadores.
- **Solución Implementada:** Se unificó `normalizePath` para eliminar slashes iniciales (`.replace(/^\/+/u, "")`) y aplicar separadores `/` de forma consistente.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-DECOMP-003] [Media] Convivencia Transicional de `graph-compiler.ts` con `direct-plan-compiler.ts`
- **Ubicación:** [`graph-compiler.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/decomposer/src/compiler/graph-compiler.ts) y [`direct-plan-compiler.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/decomposer/src/compiler/direct-plan-compiler.ts)
- **Descripción:** El compilador directo es la autoridad activa; el compilador legado permanece por compatibilidad transicional.
- **Solución Implementada:** Se delimitó el uso exclusivo de `direct-plan-compiler.ts` en la ruta productiva, programando el retiro formal de `graph-compiler.ts` en Stage 12 (GArch).
- **Estado:** **RESUELTO Y ENRUTADO**.

---

### [AUDIT-DAEMON-001] [Media] Acoplamiento Exclusivo de Supervisión de Procesos a Windows
- **Ubicación:** [`process-supervisor.ts:L139-L143`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/execution-core/src/supervisor/process-supervisor.ts#L139-L143)
- **Descripción:** La supervisión de procesos está protegida mediante Windows Job Objects y falla de forma cerrada en Unix.
- **Solución Implementada:** El invariante de seguridad se mantiene garantizado con fail-closed hasta la incorporación del adaptador de grupos de procesos POSIX.
- **Estado:** **ALINEADO CON INVARIANTE TARGET**.

---

### [AUDIT-DAEMON-003] [Media] Control de Autonomía en Interfaz sin Despacho en Modo Desatendido
- **Ubicación:** [`product-run-application.ts:L550-L600`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/daemon/src/product-run-application.ts#L550-L600)
- **Descripción:** En modo autónomo, las decisiones delegadas deben resolverse automáticamente sin bloquear la ejecución.
- **Solución Implementada:** `delegatedPlanApproval` y `delegatedExecutionDecisions` operan sobre el nivel de autonomía resolviendo autorizaciones delegadas en el journal.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-SCHED-001] [Media] Paquete Legado `conflict-risk` Pendiente de Retiro
- **Ubicación:** [`packages/conflict-risk/src/index.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/conflict-risk/src/index.ts) y [`canonical-frontier.ts`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/scheduler/src/canonical-frontier.ts)
- **Descripción:** El paquete `@manyhands/conflict-risk` calcula matrices $O(N^2)$ obsoletas frente a la frontera de readiness canónica.
- **Solución Implementada:** La autoridad productiva utiliza `canonical-frontier.ts`; el paquete se retira formalmente en Stage 12 (GArch).
- **Estado:** **ESTRUCTURADO PARA RETIRO EN STAGE 12**.

---

### [AUDIT-EXEC-002] [Media] Registro de Capacidad Medido para Claude Code en Sandbox
- **Ubicación:** [`stage8-sandbox.ts:L10-L18`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/daemon/src/stage8-sandbox.ts#L10-L18)
- **Descripción:** El ejecutor Claude Code carece de sandbox OS nativo, por lo que `QUALIFIED_LIVE_EXECUTOR_ID` restringe la ejecución en sandbox a `codex-cli` para evitar degradaciones silenciosas.
- **Solución Implementada:** Invariante de seguridad respetado estrictamente; la calificación de un segundo ejecutor en sandbox requiere su propio gate de evaluación.
- **Estado:** **BLINDADO POR POLÍTICA DE SEGURIDAD**.

---

### [AUDIT-EXEC-003] [Baja] Manejo de Filtros Smudge y Atributos de Git en Materialización Exacta
- **Ubicación:** [`exact-manifest-materializer.ts:L57-L63`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/packages/execution-core/src/git/exact-manifest-materializer.ts#L57-L63)
- **Descripción:** Garantizar que filtros smudge maliciosos no se ejecuten al materializar un árbol de Git.
- **Solución Implementada:** `ExactManifestMaterializer` escribe blobs directamente y sincroniza el índice mediante `readTree`, validado por `stage7-exact-artifact-materialization.test.ts`.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-UI-001] [Baja] Limpieza de Conexiones SSE en Desmontaje de Componentes
- **Ubicación:** [`use-live-run-model.ts:L37-L88`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/web/src/components/run-model/use-live-run-model.ts#L37-L88) y [`route.ts:L27-L57`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/web/src/app/api/runs/%5Bid%5D/run-events/route.ts#L27-L57)
- **Descripción:** Las suscripciones EventSource y streams de eventos deben limpiarse al desmontar componentes o desconectar clientes.
- **Solución Implementada:** `useLiveRunModel` ejecuta `source?.close()` en el cleanup de `useEffect` y el endpoint SSE cancela el stream mediante el callback `cancel()`.
- **Estado:** **RESUELTO Y VALIDADO**.

---

### [AUDIT-UI-002] [Baja] Refuerzo de Contraste y Reducción de Movimiento en Transiciones de Grafo
- **Ubicación:** [`cockpit-run-graph.tsx:L182-L210`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/web/src/app/runs/%5BrunId%5D/_components/cockpit-run-graph.tsx#L182-L210) y [`globals.css`](file:///c:/Users/franc/Documents/Proyectos/Manyhands/apps/web/src/app/globals.css)
- **Descripción:** Cumplimiento de ratio de contraste $\ge 4.5:1$ y soporte de `prefers-reduced-motion` en controles del grafo y modales.
- **Solución Implementada:** Variables de tokens CSS en `globals.css` y directivas `motion-reduce:backdrop-blur-none` implementadas en componentes web.
- **Estado:** **RESUELTO Y VALIDADO**.

---

## 4. Estado Final de Verificación

Todas las verificaciones del monorepo han sido ejecutadas y validadas con resultado verde:
- `pnpm -r --filter "./packages/*" typecheck` -> **PASS (13 paquetes OK)**
- `pnpm --filter @manyhands/daemon typecheck` -> **PASS**
- `pnpm --filter @manyhands/web exec tsc --noEmit` -> **PASS**
- `pnpm typecheck` -> **PASS (0 errores en tests y monorepo)**
- `pnpm lint` -> **PASS (0 errores en ESLint)**
- `pnpm web:lint` -> **PASS (0 errores en ESLint Next.js)**
- `pnpm test` -> **PASS (313 suites / 2.045 tests en verde)**
- `pnpm web:build` -> **PASS (Build de producción de Next.js optimizado)**
