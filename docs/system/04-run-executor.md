# RunExecutor

**Archivos fuente:** `packages/execution-core/src/run/executor.ts`

---

## Qué es

El `RunExecutor` es el orquestador top-level de la ejecución. Toma un `TaskGraph` aprobado y coordina todos los demás componentes del sistema para llevarlo a término: forma batches de hojas, las ejecuta en paralelo, recoge los resultados, integra los composites de abajo hacia arriba, y al final computa el `GranularityVector` del run.

---

## Responsabilidad

El `RunExecutor` no sabe cómo ejecutar agentes, ni cómo hacer git, ni cómo validar scope — cada una de esas responsabilidades vive en un componente específico. Lo que sí sabe el RunExecutor es *en qué orden* y *con qué dependencias* se coordinan esos componentes. Es el director de orquesta: decide qué pasa cuándo y qué hacer con cada resultado.

---

## Cómo funciona

### Construcción

El `RunExecutor` se construye con sus dependencias inyectadas: un `SimpleGitRunner`, un `AgentExecutor` (en producción el `GeminiCliExecutor`; en tests el `MockAgentExecutor`), y un `TraceStore`. A partir de ellos construye internamente:

- `WorktreeManager` — para crear y limpiar worktrees
- `ResultRecorder` — para capturar diffs y commitear
- `IntegrationAgent` — para cherry-pick y repair semántico
- `ChildProcessValidationRunner` — para ejecutar comandos de validación
- `BatchScheduler` — para agrupar hojas respetando dependencias
- `FileSystemContextPacker` — para armar el prompt de cada hoja

### El loop principal

El método `run()` ejecuta el siguiente ciclo hasta que el grafo completa o falla:

1. **Obtener el orden topológico** del `TaskGraph`.
2. **Preguntar al `BatchScheduler`** cuáles hojas están listas para ejecutar en este momento.
3. **Lanzar todas las hojas del batch en paralelo** (`Promise.all`) — cada una pasa por su propio ciclo: crear worktree → empaquetar contexto → ejecutar agente → validar scope → commitear resultado → limpiar worktree.
4. **Recoger resultados.** Cada hoja retorna un `AgentExecutionResult` con su status (`success`, `scope_violation`, `validation_failed`, `empty_diff`, etc.).
5. **Verificar si algún composite puede integrarse ahora** — cuando todas las hojas de un `integrator` completaron, el RunExecutor invoca `IntegrationAgent.integrate()` para ese composite.
6. **Repetir** con las hojas que quedaron pendientes.

### El ciclo de vida de una hoja

Dentro del batch, cada hoja sigue estos pasos secuenciales:

```
WorktreeManager.create()
  → FileSystemContextPacker.pack()
  → GeminiCliExecutor.execute()
  → ScopeChecker.check()              ← si falla: status = scope_violation
  → ValidationRunner.run()            ← si falla: status = validation_failed
  → ResultRecorder.commit()           ← si diff vacío: status = empty_diff
  → WorktreeManager.clean()
```

Si cualquier paso falla, el estado de la hoja refleja el motivo, pero el batch puede continuar con las otras hojas en paralelo (el error de una hoja no aborta el batch, a menos que sea un error fatal de infraestructura).

### Integración bottom-up

Cuando todas las hojas de un `integrator` completan (con cualquier resultado), el RunExecutor invoca al `IntegrationAgent`. Este proceso es recursivo: un composite de nivel 2 puede integrarse solo cuando todos sus composites hijos de nivel 1 ya integraron. El grafo se "sube" de hojas hacia root.

Si la integración de un composite falla (`executor_repair_failed`), ese composite se marca como fallido, lo que bloquea la integración de sus ancestros. El run termina con fallo parcial.

### Trazas

En cada etapa el RunExecutor emite `TraceEvent`s al `TraceStore`: `batch_started`, `worktree_created`, `agent_started`, `executor_started`, `executor_completed`, `scope_check_failed`, `validation_started`, `agent_committed`, `integration_started`, `cherry_pick_attempted`, `cherry_pick_conflict`, `integration_completed`, `batch_completed`, `run_completed`.

Estos eventos son la fuente de la timeline en la web app y el audit trail del run.

### GranularityVector

Al terminar la run (con éxito o con fallo parcial), `computeGranularityVector()` toma el `TaskGraph` y todos los `AgentExecutionResult` y produce el vector de 17 métricas que captura la granularidad y el desempeño. Este vector se persiste como parte del `RunRecord`.

---

## Interfaces

**Recibe:** `TaskGraph` (aprobado), `runId`, `repoRoot`, y un `ExecutionConfig` con defaults configurables (maxParallel, timeouts, policy de commits inesperados).

**Produce:** un `RunRecord` con el resultado de cada hoja, el resultado de cada integración, el `GranularityVector`, y el estado final del run.

**Depende de:** `WorktreeManager`, `GeminiCliExecutor` (o mock), `ScopeChecker`, `ResultRecorder`, `ValidationRunner`, `IntegrationAgent`, `BatchScheduler`, `FileSystemContextPacker`, `TraceStore`.

---

## Decisiones de diseño

El `RunExecutor` no implementa la lógica de ninguno de sus sub-componentes — solo los coordina. Esta separación permite testear el pipeline completo con `MockAgentExecutor` sin invocar Gemini real, y permite cambiar el executor (por ejemplo, a otro CLI) sin tocar la lógica de orquestación.

La integración bottom-up ocurre dentro del loop principal del RunExecutor (no en un paso separado posterior) porque en grafos profundos un composite puede integrarse antes de que las hojas del siguiente nivel estén listas — hay paralelismo potencial entre la integración de un subárbol y la ejecución de otro.
