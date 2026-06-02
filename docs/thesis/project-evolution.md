# ManyHands — Evolución del Proyecto

> Narrativa de la evolución arquitectónica para el tribunal de tesis.
> Audiencia: Francisco Clarke + tribunal de Ingeniería en Sistemas.
> Comunicación en español; términos técnicos y código en inglés.

---

## 1. El origen: laboratorio determinístico

ManyHands nació como respuesta a una pregunta de investigación concreta: ¿existe una granularidad óptima de descomposición que mejora la calidad del output de agentes LLM paralelos? Para poder responderla de forma metodológicamente sólida, el primer paso no fue correr agentes reales — fue construir un laboratorio.

El laboratorio inicial era completamente determinístico. No ejecutaba agentes LLM, no creaba git worktrees ni corría subprocesos. En cambio, simulaba el comportamiento de un pipeline de orquestación completo: tomaba una feature, la descomponía en un DAG jerárquico, asignaba contratos a las hojas, "ejecutaba" esas hojas con resultados determinísticos predefinidos, y generaba `RunSnapshot` con trazas auditables.

Esta decisión de diseño fue deliberada. El objetivo de la Etapa 1 no era demostrar que los agentes funcionan — era demostrar que la *arquitectura de orquestación* puede producir comparaciones reproducibles bajo condiciones controladas: misma feature, distintas estrategias de ejecución, mismos resultados estructurales cada vez.

Los cinco baselines del laboratorio cubren las estrategias de ejecución comparadas:
- **B0** — single agent (sin descomposición, referencia de complejidad nula)
- **B1** — DAG secuencial (una hoja a la vez)
- **B2** — paralelo naive (todas las hojas concurrentes sin coordinación)
- **B3** — paralelo + IntegrationAgent (cherry-pick bottom-up)
- **B4** — paralelo + risk-aware + IntegrationAgent + human gate

El evaluador consumía `RunSnapshot` y derivaba métricas estructurales: forma del grafo, contratos, riesgo de conflicto, scheduling, trazabilidad. Las advertencias metodológicas eran explícitas en los reportes: estos resultados validan estructura y reproducibilidad, no calidad final de código producido por agentes reales.

Este laboratorio mock fue la base sobre la que se construyó todo lo que siguió. Cada decisión posterior pudo hacerse sobre un andamiaje ya probado.

---

## 2. Pivote a producto visual

Después de construir el laboratorio determinístico, quedó claro que la tesis necesitaba un artefacto tangible más allá de un CLI de benchmarks. Un jurado técnico puede defender la arquitectura de un sistema si puede *verlo funcionar*, no solo si puede leer sus schemas.

El pivote fue construir una web app en Next.js App Router que consumiera el core existente directamente — no una UI con datos mockeados aparte, sino la misma lógica de orquestación expuesta visualmente. La decisión de no reimplementar la orquestación en la capa web fue clave: el web app llama APIs respaldadas por los mismos packages que el laboratorio, y muestra artefactos validados del core (`TaskGraph`, `AgentTaskContract`, `RunRecord`).

Las superficies principales de la aplicación:
- **Command Center** (`/`): el usuario describe una feature en lenguaje natural y crea un run
- **Run workspace** (`/runs/[runId]`): vista canónica con DAG interactivo, inspector de nodos, lifecycle del run y eventos SSE en tiempo real
- **Lab** (`/lab`): modo de benchmarks determinísticos para experimentos controlados
- **Replay** (`/replay/demo`): replay de snapshots para demos sin riesgo de ejecución live

El canvas del DAG usa `@xyflow/react` (React Flow) — un grafo interactivo basado en componentes React, con nodos editables, edges de dependencia, minimap, filtros y un inspector lateral. Los nodos muestran estado en tiempo real durante la ejecución; el inspector expone contratos, diffs, scope y trazas.

Este pivote fue importante para la tesis por dos razones. Primero, hace la arquitectura *visible y defendible*: el tribunal puede ver el DAG generarse, ver los contratos de cada hoja, ver cómo el scheduler agrupa hojas en batches, y ver las trazas de ejecución. No hay que inferir la estructura desde schemas abstractos. Segundo, la web app es el artefacto de producto — lo que hace que ManyHands sea "software" y no solo una biblioteca.

---

## 3. Execution Core: de simulación a worktrees reales

Con el laboratorio validado y la web app funcionando, el siguiente paso fue implementar el pipeline de ejecución real. Esto significó pasar de simular efectos (diffs, branches, resultados de validación) a producirlos de verdad en el sistema de archivos.

El `execution-core` pasó de ser un set de tipos y schemas a un pipeline funcional completo con componentes bien delimitados:

**Capa de git y worktrees:**
- `SimpleGitRunner` — wrapper tipado de `simple-git` para operaciones git del orquestador
- `WorktreeManager` — crea y limpia git worktrees aislados por tarea, detecta si el agente hizo commits inesperados

**Executor (seam provider-agnóstico):**
- `AgentExecutor` — interfaz que cualquier executor debe implementar
- `MockAgentExecutor` — test double determinístico, permite testear el pipeline sin invocar agentes reales
- `GeminiCliExecutor` — wrapper real de `gemini` headless

**Pipeline de resultado:**
- `ScopeChecker` — valida los archivos cambiados (`git diff --name-only`) contra `executionScope` y `forbiddenPaths`
- `ResultRecorder` — captura `git diff HEAD`, persiste patch y emite trace events
- `ValidationRunner` — ejecuta `leafValidationCommands`, `parentValidationCommands`, `runValidationCommands`
- `IntegrationAgent` — cherry-pick de commits hijo sobre rama padre + repair semántico con Gemini ante conflicto
- `BatchScheduler` — control de concurrencia (`maxParallel = 3`)
- `FileSystemContextPacker` — empaqueta contexto de archivos + interfaces consumidas para el prompt del agente
- `RunExecutor` — orquestador top-level que coordina todos los componentes

**Dos decisiones de diseño centrales** que atraviesan todo el pipeline:

*El orquestador hace commit.* El agente nunca debe hacer commit. El flujo es siempre: Gemini trabaja → `git diff HEAD` → scope check → validación → commit (orquestador). Si el agente commitea de todas formas, se detecta por comparación de SHA y se aplica la política configurada (`reject` por default). Esta restricción es lo que hace que el cherry-pick downstream sea predecible y que el audit trail sea estructurado.

*`git diff HEAD` como fuente de verdad.* El output de un LLM puede ser alucinado. Un agente puede reportar "implementé la función X" sin haber tocado ningún archivo. `git diff HEAD` es objetivo y verificable. El stdout/stderr del agente se persiste para diagnóstico en la UI, pero nunca se usa para determinar qué cambió.

La web app se cableó al motor real: `runner.ts` construye un `RunExecutor` sobre un repo fixture provisionado. Los eventos de ejecución llegan a la UI vía SSE. El `GranularityVector` (17 métricas) y el execution summary se persisten en el `RunRecord` y se proyectan en los paneles de evidencia del run workspace.

---

## 4. Los dos artifacts de tesis

### Artifact 1: Decomposer Recursivo Interface-Aware

El diseño original del decomposer era single-pass: una sola llamada al LLM producía el DAG entero de una vez, con granularidad como control global de cantidad de nodos. Esto generaba un problema fundamental: árbol con profundidad uniforme en todas las ramas, sin importar que la complejidad real sea desigual.

La intuición de Francisco fue exacta y llevó al rediseño: *"una rama del árbol podría necesitar más profundidad de descomposición que otra, por lo que no creo que sea útil definir un máximo o un objetivo de niveles."*

El nuevo decomposer es **recursivo y local**: cada nodo evalúa por sí mismo si conviene descomponerse más, aplicando una rúbrica de atomicidad explícita. Un nodo es atómico (hoja) cuando un agente puede implementarlo directamente sin ambigüedad, con el contexto disponible, sin necesitar definir abstracciones que compartan sus hermanos. El árbol resultante es asimétrico, reflejando la complejidad real de cada sub-problema.

Pero el cambio más importante no fue la recursión — fue descubrir que el **problema central del paralelismo no es cómo partir el trabajo, sino cómo definir las costuras (seams) entre las piezas**. En el diseño anterior, dos hojas paralelas trabajaban a ciegas: cada una inventaba su propia versión de la interfaz que compartían, y cada una pasaba su scope check individual. El cherry-pick fallaba después — no por un conflicto de texto trivial, sino porque habían diseñado interfaces incompatibles.

La solución fue producir, en cada paso de descomposición, un `sharedInterface`: las definiciones TypeScript concretas (tipos y firmas de funciones) que los hijos de ese composite deben respetar. Cada hijo declara qué interfaces `consumes` (producidas por hermanas o ancestros) y qué `produces` (para hermanas). En ejecución, el `ContextPacker` inyecta en el prompt de cada hoja las interfaces que consume, fijando la costura antes de despachar los agentes en paralelo.

**Claim falsable:** Producir un `sharedInterface` en cada paso de descomposición reduce `conflictRate` y aumenta `integrationSuccessRate` versus descomposición single-pass sin costuras explícitas.

Esta idea conecta con la literatura de SWE-agent, que mostró que la *agent-computer interface* condiciona fuertemente el rendimiento del agente. Aquí se aplica la misma idea a la **inter-agent interface**: la costura entre dos subagentes que trabajan en paralelo es una interfaz de primera clase que hay que diseñar, no un accidente emergente.

### Artifact 2: Composer Contract-Aware

El `IntegrationAgent` original era un integrador sintáctico: ante un conflicto de cherry-pick, le pasaba a Gemini el texto del conflicto y nada más. Gemini veía el choque de líneas pero no sabía por qué cada hoja tomó la decisión que tomó, ni cuál era el objetivo del padre, ni cuál era la interfaz canónica que ambas hojas debían honrar. Para conflictos triviales alcanzaba; para conflictos reales, la resolución podía ser sintácticamente válida pero funcionalmente incorrecta.

El **Composer contract-aware** es el sucesor. Ante un conflicto, el repair se hace con contexto semántico completo:
- El **goal y acceptance criteria del padre** — qué tiene que lograr el conjunto integrado
- El **`sharedInterface` canónico** relevante al conflicto — la fuente de verdad de la costura
- El **contrato de cada hijo**: goal, qué `produces`/`consumes`, su diff

El mensaje conceptual al modelo: *"El hijo A produce la interfaz X (acá está su definición canónica). El hijo B la consume. Hay un conflicto en estos archivos. Resolvé de modo que el resultado honre exactamente la definición canónica de X y cumpla el objetivo del padre."* El conflicto se resuelve por referencia al contrato, no adivinando qué quería cada lado.

Adicionalmente, cuando el composite tiene `parentValidationCommands` (poblados por el Decomposer al descomponer), el Composer los corre contra el worktree integrado. Esto verifica que la costura quedó correcta — típicamente tests de integración que ejercitan la interfaz compartida. Cierra el lazo de calidad: `testsPassedRate` mide el sistema integrado funcionando, no solo hojas aisladas.

**Claim falsable:** Resolver conflictos por referencia al `sharedInterface` logra mayor `integrationSuccessRate` y `testsPassedRate` post-integración versus un repair sintáctico que solo ve el diff en conflicto.

---

## 5. Migración Codex → Gemini CLI

El executor original del pipeline real era Codex CLI (`codex exec --instructions-file`). La migración a Gemini CLI (`gemini`) ocurrió en junio 2026 por razones de acceso y disponibilidad práctica.

La transición fue relativamente limpia porque el seam `AgentExecutor` ya era provider-agnóstico por diseño previo. El cambio principal fue de invocación: Codex recibía instrucciones via archivo temporal (`--instructions-file`), Gemini las recibe por stdin (`gemini -p`). El control de no-interactividad pasó de `bypassApprovals: true` a `--approval-mode yolo` para ejecución de hojas, y de un modo restrictivo a `--approval-mode plan` para el decomposer (read-only, sin efectos secundarios).

Las garantías de aislamiento no cambiaron: siguen dependiendo del git worktree aislado y del `ScopeChecker`, no del sandbox del CLI. `--approval-mode yolo` auto-aprueba tool calls para evitar bloqueos interactivos en modo headless, pero el `ScopeChecker` verifica independientemente que el agente no tocó archivos fuera de su scope.

El decomposer también migró: `AnthropicDecomposer` como default pasó a `GeminiRecursiveDecomposer`. Gemini corre en `--approval-mode plan` durante la descomposición, lo que le permite leer archivos del repo para fundamentar sus decisiones de interfaz y scope.

La migración también fue una oportunidad para renombrar referencias de provider-específicas a provider-agnósticas: `CodexExecutionError` → `AgentExecutionError`, `codex_started`/`codex_completed` trace events → `executor_started`/`executor_completed`.

---

## 6. Estado actual y lo que falta

### Lo implementado

El pipeline de orquestación está implementado de punta a punta, con la web app cableada al motor real:

- Decomposer recursivo interface-aware (Artifact 1) con GeminiRecursiveDecomposer como default
- Composer contract-aware (Artifact 2) con repair semántico y verificación post-integración
- Pipeline de ejecución completo: worktrees, GeminiCliExecutor, ScopeChecker, ResultRecorder, ValidationRunner, IntegrationAgent, BatchScheduler
- Web app con SSE de ejecución en tiempo real, DAG interactivo, inspector de nodos, paneles de evidencia
- GranularityVector (17 métricas: 9 pre-ejecución + 8 post-ejecución) persistido por run
- Dos fixtures de benchmark: `benchmarks/expression-calculator/` (costuras reales, profundidad desigual natural) y `benchmarks/task-manager-api/` (smoke test REST API)
- 455 tests passing + 3 skipped, typechecks limpios en todos los packages

### Lo que falta: la evidencia empírica

El pipeline funciona con mocks y tests E2E. Lo que **no existe todavía** es la evidencia del experimento real:

- La matriz de experimentos — baselines (B0-B4) × granularidades (`low`/`medium`/`high`) sobre los fixtures con agentes Gemini reales — no se corrió
- No hay `GranularityVector` post-ejecución real (solo validación estructural con mock)
- No hay `integrationSuccessRate`, `conflictRate`, ni `testsPassedRate` con agentes reales

Esta es la diferencia entre "el sistema funciona" (validado) y "la hipótesis de la tesis tiene evidencia" (pendiente).

El siguiente paso experimental es: provisionar un fixture → correr una feature → capturar el GranularityVector real → repetir con distintos niveles de agresividad → analizar la correlación entre atomicidad de la descomposición y calidad de la integración.

---

## Arquitectura resultante

```
apps/
  web/                  Next.js App Router
                        Command Center · Run workspace · Lab · Replay

packages/
  task-graph/           TaskNode, TaskGraph, DAG, validación, topo sort
  contracts/            AgentTaskContract V1+V2, InterfaceContract (seams)
  decomposer/           GeminiRecursiveDecomposer (default) + baselines Anthropic
  execution-core/       Pipeline completo: worktree, executor, scope, recorder,
                        integration, scheduler, granularity, RunExecutor
  scheduler/            sequential, naive, risk-aware
  run-store/            RunSnapshot, patches, JSON persistence
  trace-store/          50+ trace event types (planning + execution)
  shared/               EntityId, IsoTimestamp, helpers

benchmarks/
  expression-calculator/ Fixture con costuras reales (Token[], Ast)
                         42 tests de integración, arquitectura interna libre
  task-manager-api/      Fixture REST API con endpoints PUT/DELETE a completar

docs/
  adr/                  29 ADRs — registro histórico inmutable
  design/               Diseño detallado de los artifacts de tesis
  thesis/               Narrativa del proyecto (este archivo)
  DECISIONS.md          Síntesis de decisiones para agentes
  development/          Arquitectura actual, plan de tesis, visión de producto y UI
```
