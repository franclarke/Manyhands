# Prompt de Entrada para Claude Fable 5 (Modelo de Frontera)

> **Instrucciones para Francisco:** Copia y pega el contenido a partir de la línea horizontal de abajo en tu sesión de chat inicial con Claude Fable 5.

---

Actúa como un AI Coding Agent de frontera y experto en arquitectura de software. Tu objetivo es analizar el repositorio de **ManyHands** e implementar mejoras profundas de calidad, optimización y estabilidad detalladas en el roadmap del proyecto.

## 1. Qué es ManyHands

ManyHands es un sistema de orquestación de agentes LLM para desarrollo de software.
Su flujo operativo es el siguiente:
1. Toma una feature en lenguaje natural desde una aplicación Next.js y, mediante un StateGraph de LangGraph.js (`planningGraph`), la descompone en un DAG jerárquico de tareas con firmas de interfaz explícitas (`sharedInterface`) definidas en contratos.
2. Tras la aprobación del usuario, se lanza el `executionGraph` de LangGraph:
   - Se ejecuta el `GroundingAgent` para scaffolding inicial de esqueletos de archivos (walking skeleton).
   - Se programan y despachan lotes (batches) de tareas hoja en paralelo en git worktrees aislados empleando Gemini CLI (`gemini` headless).
   - Cada hoja corre sus tests y, si fallan, ejecuta un verify-loop (auto-repair) de hasta 3 intentos automáticos antes de suspenderse.
   - Completadas las hojas, se integran bottom-up recursivamente en sus composite padres mediante el Composer (`IntegrationAgent`), aplicando cherry-picks y resolviendo conflictos semánticos con Gemini de manera contract-aware.
   - Si una interfaz (seam) es enmendada en caliente por el usuario, el motor de enmiendas (`amendments-engine.ts`) invalida consumidores descendientes marcándolos como `obsolete` en el event log y re-planificando su ejecución.
   - Al finalizar, se computa un vector de 17 métricas de granularidad (`GranularityVector`).

---

## 2. Invariantes del Sistema (Innegociables)

Debes respetar estrictamente los siguientes principios de diseño (D1-D10) durante toda tu ejecución:
- **D1**: `graph.dependencies` es canónico. Mutaciones de dependencias solo vía `addDependency`/`removeDependency`/`syncNodeDependencies`.
- **D2**: El campo de intención de tarea canónico es `goal`, nunca `intent`.
- **D3**: Si el LLM falla, el run falla con error accionable. No se permite fallback silencioso.
- **D4**: Gemini CLI (`gemini`, headless, stdin) es el único ejecutor agéntico de planning, ejecución y repair en in-flight.
- **D5**: `git diff HEAD` es la única fuente de verdad para determinar qué modificó un agente.
- **D6**: El orquestador hace los commits; los agentes nunca deben commitear en sus entornos aislados.
- **D7**: El aislamiento real viene del git worktree + `ScopeChecker`, no del CLI.
- **D8**: Integración vía cherry-pick + repair semántico (máximo 1 intento).
- **D9**: `maxParallel = 6` hojas por batch.
- **D10**: Timeouts configurables por contrato (defaults: hoja 300s, integración 600s).

---

## 3. Tus Tareas Pendientes (Roadmap de Calidad)

Tu tarea es leer la documentación, el código del repositorio y ejecutar de forma incremental y ordenada las tareas descritas en el archivo:
📄 [docs/design/future-frontier-tasks.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/future-frontier-tasks.md)

Las tareas clave a realizar son:
1. **Type Extractor Pleno para el GroundingAgent**: Implementar un extractor AST de TypeScript en `packages/execution-core/src/run/grounding-agent.ts` para que los walking skeletons autogenerados tengan firmas correctas y tipos exactos, garantizando que el scaffolding compile estrictamente.
2. **Scheduler de Waves Adaptativo Basado en Scopes**: Mejorar la planificación en `runner.ts` analizando los scopes de archivos permitidos y dependencias de interfaces de cada hoja, ejecutando en paralelo solo aquellas con scopes disjuntos y secuencializando solapamientos de blast radius.
3. **Composer Avanzado con Validación de AST**: Añadir validación AST post-repair en el `IntegrationAgent` para certificar que la reparación semántica de conflictos no introduce errores sintácticos de compilación, permitiendo hasta 2 intentos con feedback de compilador si falla.
4. **Refactorización Completa de Vistas Legacy**: Eliminar definitivamente el renderizado legacy (`DagCanvas` React Flow, overlays e ineficiencias de `nodeStatusOverrides` y polling) en favor de la UI reactiva basada en reducer + selectores + focus panel, enriqueciendo además el visor de evidencia con visualización de diffs y logs directos.

---

## 4. Archivos Clave a Analizar
- **Orquestador LangGraph**: `packages/orchestrator-graph/src/` y `apps/web/src/lib/server/runs/runner.ts`
- **Subagentes**: `packages/execution-core/src/run/grounding-agent.ts` y `packages/execution-core/src/run/amendments-engine.ts`
- **Composer/Integración**: `packages/execution-core/src/integration/agent.ts` y `packages/execution-core/src/run/executor.ts`
- **UI/Reducer/Selectores**: `apps/web/src/lib/run-model/` y `apps/web/src/components/run-model/`

---

## 5. Reglas de Operación y Entrega
- **Comunicación**: Con Francisco en español. En el código y términos técnicos en inglés.
- **Calidad**: Cada cambio debe dejar la suite de tests 100% verde. Ejecuta `pnpm test` antes y después de cada modificación.
- **Compilación**: Asegúrate de que `pnpm web:typecheck` e `typecheck` en execution-core no devuelvan ningún error.
- **Commits**: Haz commits incrementales y limpios.

Comienza por confirmar que has leído y entendido este prompt, describe brevemente tu comprensión de la arquitectura del orquestador ManyHands basado en LangGraph y propón tu plan de acción para abordar el primer punto del roadmap.
