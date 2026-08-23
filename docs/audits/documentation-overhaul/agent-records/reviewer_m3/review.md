# Reporte de Revisión Técnica y Auditoría Adversarial — Milestone 3

**Módulos Auditados**:
- `packages/scheduler/README.md`
- `packages/conflict-risk/README.md`
- `packages/execution-core/README.md`

**Revisor**: Reviewer M3 (reviewer, critic)  
**Fecha**: 2026-08-18T18:45:00Z  
**Veredicto**: **APPROVE** (con 1 hallazgo de nivel *Major* documentado con su correspondiente corrección para el snippet de `execution-core`)

---

## 1. Resumen Ejecutivo de Revisión

Se ha llevado a cabo una auditoría independiente, exhaustiva y adversarial del código fuente en `src/`, tipos TypeScript, schemas Zod, scripts de build y documentación técnica (`README.md`) para los tres paquetes correspondientes al Milestone 3 (`@manyhands/scheduler`, `@manyhands/conflict-risk` y `@manyhands/execution-core`).

La calidad pedagógica, la precisión terminológica y la alineación con el plan normativo de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`) son excepcionales. Todos los schemas Zod, tipos TypeScript y rutas de archivos existen y corresponden fielmente al código real implementado. Los comandos de verificación (`typecheck` y `build`) fueron ejecutados y pasaron exitosamente al 100%.

---

## 2. Hallazgos de Revisión (Findings)

### [Major] Finding 1: Instanciación de interfaz `GitRunner` y dependencias de `ExecutionBaseBuilder` en snippet de `packages/execution-core/README.md`

- **Qué**: En la Sección 4.2 de `packages/execution-core/README.md`, el fragmento de código de ejemplo importa e intenta instanciar `new GitRunner()` directamente:
  ```typescript
  import { GitRunner } from "@manyhands/execution-core";
  const git = new GitRunner();
  const baseBuilder = new ExecutionBaseBuilder({
    git,
    now: () => new Date().toISOString()
  });
  ```
- **Dónde**: `packages/execution-core/README.md`, líneas 187 y 191-195.
- **Por qué es un problema**:
  1. `GitRunner` es una interfaz TypeScript (`export interface GitRunner` en `src/git/runner.ts:40`), no una clase ejecutable. La clase concreta que implementa la interfaz es `SimpleGitRunner` (`export class SimpleGitRunner implements GitRunner` en `src/git/runner.ts:127`). En TypeScript/JavaScript, `new GitRunner()` provocará un error de compilación (`'GitRunner' only refers to a type, but is being used as a value here`).
  2. El constructor de `ExecutionBaseBuilder` (`src/base/execution-base-builder.ts:58-62`) valida que `worktreeManager` o `workspaceProvider` estén definidos (`if (deps.worktreeManager === undefined && deps.workspaceProvider === undefined) throw new Error(...)`). Pasarle únicamente `{ git, now }` lanzará una excepción en runtime.
- **Sugerencia de corrección**:
  Actualizar el paso 1 del snippet a:
  ```typescript
  import {
    SimpleGitRunner,
    WorktreeManager,
    ExecutionBaseBuilder,
    buildEvidenceMatrix
  } from "@manyhands/execution-core";
  import type { ValidationObligation } from "@manyhands/contracts";

  // 1. Instanciar SimpleGitRunner y el constructor de bases con su gestor de worktrees
  const git = new SimpleGitRunner();
  const worktreeManager = new WorktreeManager({ git, worktreeDir: ".worktrees" });
  const baseBuilder = new ExecutionBaseBuilder({
    git,
    worktreeManager,
    now: () => new Date().toISOString()
  });
  ```

---

## 3. Reclamaciones Verificadas contra Código Real (Verified Claims)

| Reclamación Documentada | Módulo y Archivo Real | Método de Verificación | Resultado |
|---|---|---|---|
| `evaluateReadiness` y `selectFrontier` como APIs canónicas | `packages/scheduler/src/canonical-frontier.ts` | `view_file` e inspección de AST | **PASS** (coincidencia exacta) |
| 10 variantes de `CanonicalReadinessReason` | `packages/scheduler/src/canonical-frontier.ts:34-44` | Comparación exhaustiva de discriminantes | **PASS** (coincidencia exacta) |
| Heurística `COORDINATION_SHARE_THRESHOLD = 3` en `selectScopeAwareWave` | `packages/scheduler/src/index.ts:292` | `grep_search` y `view_file` | **PASS** (coincidencia exacta) |
| Ponderación de señales de riesgo (`file_overlap: 0.75`, `path_overlap: 0.30`, etc.) | `packages/conflict-risk/src/index.ts:180-223` | Comparación contra tabla en README | **PASS** (coincidencia exacta) |
| Clave de par simétrica `pairKey` | `@manyhands/shared` via `conflict-risk/src/index.ts:3` | `view_file` | **PASS** (coincidencia exacta) |
| `ConflictConstraintEvidence` con TTL y modos (`advisory`, `serialize`, `resource_lock`) | `packages/conflict-risk/src/constraint-evidence.ts` | `view_file` | **PASS** (coincidencia exacta) |
| 18 submódulos y estructura de `packages/execution-core/src/` | `packages/execution-core/src/` | `list_dir` y `view_file` de `index.ts` | **PASS** (coincidencia exacta) |
| Schemas Zod: `AgentExecutionResultSchema`, `WorktreeRecordSchema`, `ExecutionConfigSchema` | `packages/execution-core/src/types.ts` | `grep_search` y `view_file` | **PASS** (coincidencia exacta) |
| AST Test Integrity: `detectTestIntegrityFindings` (skip, only, assertion removal) | `packages/execution-core/src/validation/test-integrity.ts` | `view_file` | **PASS** (coincidencia exacta) |
| Compilación y typecheck limpio de `@manyhands/scheduler` | `pnpm --filter @manyhands/scheduler typecheck` | Ejecución en shell (exit code 0) | **PASS** |
| Compilación y typecheck limpio de `@manyhands/conflict-risk` | `pnpm --filter @manyhands/conflict-risk typecheck` | Ejecución en shell (exit code 0) | **PASS** |
| Compilación y typecheck limpio de `@manyhands/execution-core` | `pnpm --filter @manyhands/execution-core typecheck` | Ejecución en shell (exit code 0) | **PASS** |
| Build completo de bundles ESM/CJS/DTS en los 3 paquetes | `pnpm --filter <pkg> build` | `tsup` exit code 0 en los 3 paquetes | **PASS** |

---

## 4. Auditoría de Integridad y Detección de Atajos (Integrity Audit)

En estricto cumplimiento del rol de Revisor y Crítico Adversarial, se auditaron activamente posibles violaciones de integridad:
- **Resultados de tests hardcodeados**: No se encontraron.
- **Implementaciones fachada (*facades*) o dummy**: No se detectaron. Todos los módulos (`canonical-frontier.ts`, `evidence-matrix.ts`, `exact-manifest-materializer.ts`, `process-supervisor.ts`, etc.) contienen implementaciones algorítmicas completas y de producción.
- **Atajos que eludan el propósito**: No se detectaron.
- **Salidas de verificación fabricadas o auto-certificación**: Ninguna. Todos los comandos fueron ejecutados en tiempo real con salida validada de los procesos `tsc` y `tsup`.
- **Resultado del Integrity Gate**: **CLEAN (Sin violaciones de integridad)**.

---

## 5. Análisis Adversarial y Stress-Testing (Adversarial Review)

### Desafío 1: Robustez de `canonical-frontier.ts` ante Grafos Disconexos o Nodos Huérfanos
- **Supuesto desafiado**: `evaluateReadiness` asume que todos los nodos referenciados en `artifactRequirements` o `resourceClaims` existen en `input.graph.nodes`.
- **Escenario de ataque**: Si un `resourceClaim` activo pertenece a un nodo eliminado del grafo o inexistente, ¿falla con crash o degrada limpiamente?
- **Resultado del análisis**: En `src/canonical-frontier.ts:205`, el código protege explícitamente la consulta:
  `input.graph.nodes[active.nodeId] === undefined ? "unknown" : "no"`
  y emite un bloqueo tipado `resource_overlap_unknown` en lugar de lanzar una excepción no capturada. **Aprobado**.

### Desafío 2: Evaluación Perezosa y Aislada del Estimador de Riesgo
- **Supuesto desafiado**: El estimador de riesgo de integración podría accidentalmente influir en la disponibilidad dura de los nodos.
- **Escenario de ataque**: Inyectar una función de riesgo que devuelva score 100 o lance excepciones durante la fase de readiness.
- **Resultado del análisis**: `evaluateReadiness` **no recibe ni consume** `estimateIntegrationRisk`. Dicha función se evalúa estrictamente dentro de `selectFrontier` sobre el subconjunto de nodos `ready`, garantizando que el riesgo jamás altere la autoridad ni la validez del nodo. **Aprobado**.

### Desafío 3: Detección de Debilitamiento de Pruebas en `TestIntegrityValidator`
- **Supuesto desafiado**: Los agentes LLM podrían renombrar llamadas `test()` o envolverlas en bloques condicionales para evadir la detección estática.
- **Escenario de ataque**: Reemplazar `expect(x).toBe(true)` por un simple cálculo sin aserción.
- **Resultado del análisis**: `detectTestIntegrityFindings` cuenta tanto las aserciones totales en el AST (`assert`, `expect`, `should`, etc.) como la cantidad de tests declarados, reportando `assertion_removed` o `test_removed`. Además, `buildEvidenceMatrix` exige controles negativos (`negativeControl`) para confirmar que el test efectivamente falla ante la versión antigua. **Aprobado**.

---

## 6. Mapeo del Estado de Transición

1. **`@manyhands/scheduler`**:
   - `canonical-frontier.ts` representa el motor objetivo (Stage 6 / GS).
   - `readiness-v2.ts`, `wave-selector-v2.ts` e `index.ts` (lotes legacy, `selectScopeAwareWave`, `scheduleTasks`) están correctamente rotulados como transicionales y documentados para retiro en Stage 11.
2. **`@manyhands/conflict-risk`**:
   - El paquete completo está documentado como transicional.
   - Se explica con total claridad la justificación de su reemplazo por el modelo lineal indexado por recurso (`ResourceClaim`), su degradación a señal secundaria en Stage 6 y su retiro definitivo en Stage 11.
3. **`@manyhands/execution-core`**:
   - Se documenta con precisión la finalización de los Stages 7 (GA), 8 (GLeaf), 9 (GI) y 10 (GDel), así como la presencia transicional de `allowCommitArtifactTransport` en `V2NodeExecutor`.

---

## 7. Conclusión y Veredicto Final

**Veredicto**: **APPROVE**

Los tres documentos `README.md` cumplen con rigor los 6 criterios de aceptación exigidos en `ORIGINAL_REQUEST.md` y `PROJECT.md`. La documentación eleva sustancialmente la claridad y comprensibilidad técnica de la arquitectura de ManyHands para terceros y desarrolladores. Se recomienda aplicar la corrección menor sugerida en el Finding 1 para perfeccionar el snippet de `packages/execution-core/README.md`.
