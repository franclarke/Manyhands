# IntegrationAgent (Composer)

**Archivos fuente:** `packages/execution-core/src/integration/agent.ts`

---

## Qué es

El `IntegrationAgent` (también llamado Composer) es el componente que integra los resultados de las hojas hijas en su nodo composite padre. Lo hace mediante cherry-pick de los commits de cada hoja, y cuando hay conflictos, los resuelve con contexto semántico completo en lugar de hacer un merge textual ciego.

---

## Responsabilidad

El Composer tiene que resolver un problema fundamental del paralelismo: varias hojas trabajaron en simultáneo sobre el mismo código base, cada una en su propio worktree aislado, y ahora hay que combinar sus cambios en una rama coherente. El cherry-pick es el mecanismo; el repair semántico es lo que lo hace robusto cuando el cherry-pick encuentra conflictos.

---

## Cómo funciona

### El camino limpio: cherry-pick en orden topológico

El `IntegrationAgent.integrate()` primero verifica que todas las hojas hijas completaron con éxito. Si alguna hoja falló, la integración no empieza.

Luego, para cada hijo en orden topológico (respetando las dependencias entre ellos), ejecuta `git cherry-pick <commitSha>`. El cherry-pick aplica el commit de esa hoja sobre la rama del composite padre.

Si el cherry-pick aplica limpiamente, el Composer avanza al siguiente hijo. Al terminar, si hay `parentValidationCommands` en el contrato, los ejecuta contra el worktree integrado para verificar que las costuras quedaron correctas.

### El conflicto: cuándo falla el cherry-pick

Un conflicto de cherry-pick ocurre cuando dos hojas modificaron las mismas líneas de un archivo de maneras incompatibles. En un merge textual ordinario, git muestra los marcadores `<<<<<<<`, `=======`, `>>>>>>>` y el desarrollador los resuelve manualmente. En un entorno headless automatizado, no hay desarrollador.

La solución naive sería dejar el conflicto para que el usuario lo resuelva en la web app. Pero esto rompe la automatización para el caso más común: dos hojas que implementaron la misma interfaz de maneras ligeramente distintas porque no tenían una definición canónica que honrar.

### El repair semántico: resolución por referencia al contrato

Cuando hay un conflicto, el Composer invoca a Gemini con un prompt de repair que contiene:

1. **El goal y acceptance criteria del composite padre** — qué tiene que lograr el conjunto integrado, no solo las hojas individuales.
2. **El `sharedInterface` canónico** del composite — las firmas TypeScript que se definieron cuando el Decomposer descompuso este nodo. Estas son la fuente de verdad: si dos hojas discrepan sobre cómo debe verse un tipo o función, la definición canónica del sharedInterface gana.
3. **La intención de cada hijo involucrado en el conflicto** — su goal y qué interfaces produce y consume — para que Gemini entienda por qué cada lado tomó la decisión que tomó.
4. **El diff en conflicto y la salida del cherry-pick** — el texto real del conflicto, lo mismo que en un repair tradicional.

El mensaje conceptual del prompt es: *"El hijo A produce la interfaz X con esta forma exacta. El hijo B la consume. Hay un conflicto en estos archivos. Resolvé el conflicto de modo que el resultado honre exactamente la definición canónica de X y cumpla el objetivo del padre."*

Esto convierte el conflicto de "¿cómo reconcilio estas dos versiones de código?" a "¿qué forma debe tener el código para cumplir este contrato?". La respuesta es determinista: la forma que describe el `sharedInterface`.

### El límite de un repair por integración

El Composer hace máximo un intento de repair por integración (ADR-0025). Si el repair también falla, el composite queda en `executor_repair_failed` y el run termina con fallo parcial en ese subárbol. No se hacen retries indefinidos porque cada intento de repair consume tokens y tiempo, y un repair fallido repetido normalmente indica un problema más profundo en el diseño de las costuras — algo que requiere intervención del usuario, no más intentos automáticos.

### Estados de salida

- `success` — todos los cherry-picks aplicaron limpiamente y la validación pasó
- `executor_repair_success` — hubo un conflicto pero el repair semántico lo resolvió y la validación pasó
- `executor_repair_failed` — el repair intentó pero falló
- `validation_failed` — cherry-pick y repair pasaron, pero `parentValidationCommands` fallaron
- `cherry_pick_conflict` — conflicto sin intento de repair (no debería ocurrir en el flujo normal)

---

## Interfaces

**Recibe:** el composite `TaskNode` (con su goal, sharedInterfaces y parentValidationCommands), los `AgentExecutionResult` de sus hijos, y el `WorktreeRecord` del worktree del composite.

**Produce:** `IntegrationResult` con `{ status, childResults, conflictDetails?, repairResult? }`.

**Lo invoca:** `RunExecutor` en el loop de integración bottom-up, cuando todas las hojas de un composite terminaron.

**Depende de:** `SimpleGitRunner` (para cherry-pick), `GeminiCliExecutor` (para el repair semántico), `ValidationRunner` (para parentValidationCommands), `TraceStore` (para los eventos de integración).

---

## Decisiones de diseño

La elección de cherry-pick sobre merge es deliberada: el cherry-pick aplica un commit específico con su historia intacta, lo que hace el historial de git más limpio y el rollback más predecible. Con merge, el historial se complica con merge commits y la trazabilidad de "quién hizo qué" se pierde.

El repair semántico contract-aware es el Artifact 2 de la tesis. La diferencia con un merge tool tradicional es que no intenta reconciliar código — intenta honrar un contrato. Si el contrato está bien definido, la resolución es determinista. Si el contrato está mal definido, el repair puede fallar, pero eso es información útil: indica que el Decomposer no definió bien las costuras.
