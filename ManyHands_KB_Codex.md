# ManyHands Knowledge Base para Codex 5.5

> Documento de contexto de arranque para un agente de desarrollo (Codex 5.5). Define **qué** construir, **por qué**, **con qué decisiones ya tomadas** y **con qué restricciones**. Codex debe tratar este documento como fuente de verdad de la intención técnica, académica y experimental del proyecto. Ante ambigüedad, preferir las decisiones marcadas como cerradas (§14) y respetar el alcance (§16).

**Cómo leer las etiquetas epistémicas.** A lo largo del documento se distingue:
- **[HECHO]** — verificable en literatura o en el comportamiento de git/LLMs/TS.
- **[INFERENCIA]** — razonamiento derivado del estado del arte.
- **[HIPÓTESIS]** — afirmación que el proyecto busca probar/refutar (no asumir como verdadera).
- **[DECISIÓN]** — decisión de diseño propia, ya tomada para el MVP.
- **[ABIERTO]** — decisión pendiente; Codex debe dejar el punto de extensión y no clavar la elección.

---

## 0. Resumen para el agente de desarrollo

ManyHands coordina múltiples agentes LLM de código sobre un repositorio real. Toma una *feature* en lenguaje natural, la **descompone recursivamente** en un **DAG** de sub-tareas hasta llegar a **tareas hoja atómicas**, convierte cada hoja en un **contrato** ejecutable, ejecuta las hojas mediante **subagentes en git worktrees aislados**, **anticipa conflictos** entre hojas concurrentes mediante señales estáticas (archivos, símbolos, contratos, dependencias), las programa con un **scheduler consciente de riesgo**, e **integra de abajo hacia arriba** produciendo un *diff* o borrador de *pull request*. Todo bajo **supervisión humana**.

El proyecto es una **tesis-producto**: un artefacto funcional cuyo diseño es defendible académicamente y que sirve de **plataforma experimental** para medir cómo la **granularidad de descomposición** afecta la **calidad del resultado**.

**Stack cerrado:** TypeScript end-to-end. Monorepo. Next.js (UI) + Node/TS (orquestación) + SQLite (trazas) + git worktree + Claude Code CLI como backend de agente + Zod para esquemas. Detalle y justificación en §14.

**Principio rector de implementación:** construir primero el lazo angosto *descomponer → ejecutar (mock) → validar → integrar (mock)* sobre **una** feature real, con todo mockeable detrás de interfaces, antes de invertir en UI completa, agente real o predictor sofisticado.

---

## 1. Problema y por qué es relevante

**[HECHO]** Los agentes de código LLM degradan su rendimiento cuando la tarea es grande: el contexto se satura y el objetivo se difumina. **[HECHO]** La práctica de correr varios agentes en paralelo, cada uno en un `git worktree` aislado, resuelve el aislamiento físico pero deja dos problemas:

1. **Descomposición:** hoy la partición de la tarea la hace el humano a mano o no se hace.
2. **Riesgo diferido al merge:** **[HECHO]** los worktrees evitan colisiones de directorio durante la ejecución, pero **[INFERENCIA]** difieren los conflictos al momento de integrar; dos ramas pueden producir cambios incompatibles que recién explotan al combinarse.

**Núcleo original/defendible de la tesis.** No es "orquestar agentes en paralelo" (ya existe en industria). Es: (a) **descomposición recursiva automática a hojas atómicas con contratos**, (b) **anticipación de conflictos por señales estáticas antes de ejecutar** —usando, distintivamente, la **API del compilador de TypeScript** para detectar incompatibilidades de tipos/firmas entre ramas hermanas— y (c) la **medición empírica del efecto de la granularidad sobre la calidad**, que la literatura no estudia en este setup.

---

## 2. Pregunta de investigación

**Central [HIPÓTESIS]:** ¿Descomponer una tarea en sub-tareas atómicas y delegarlas a agentes paralelos produce mejor calidad que un único agente con la tarea completa, y existe una granularidad óptima?

**Secundarias:**
- ¿La ejecución consciente de conflictos reduce los fallos de integración frente al paralelismo naive?
- ¿Cuál es la profundidad práctica de descomposición antes de que la coordinación supere el beneficio?
- ¿Qué contrato mínimo necesita una hoja para ser ejecutable por un agente?
- ¿Qué señales permiten anticipar conflictos antes del merge?
- ¿Qué métricas comparan ejecución monolítica, secuencial, paralela naive y paralela risk-aware?

Codex debe diseñar el sistema de modo que estas preguntas sean **medibles** (ver §11): toda decisión de scheduling, predicción y resultado debe quedar registrada en el trace store.

---

## 3. Agentic Task Graph

Modelo formal de una feature como grafo ejecutable. **[DECISIÓN]** Estructura: árbol de descomposición + dependencias transversales = **DAG**.

**Conceptos.**
- **Nodo compuesto:** tiene hijos; su estado se deriva del de sus hijos. No se ejecuta directamente.
- **Tarea hoja:** sin hijos; ejecutable por un agente; tiene contrato (§4).
- **Dependencia transversal:** arista productor→consumidor entre nodos de distintas ramas (p.ej. una hoja crea un tipo que otra consume).
- **Readiness:** una hoja está `ready` si todos sus prerequisitos (padres no, sino dependencias) están `done/merged` y no está bloqueada por conflicto.
- **Propagación:** un nodo compuesto pasa a `done` cuando todos sus hijos están `done`; a `failed` si alguno falla irrecuperablemente; a `conflict` si una predicción/realidad lo marca.

**Criterios de atomicidad** (una hoja debe cumplir TODOS):
1. Objetivo único explicable en 1–3 frases.
2. Alcance de pocos archivos / un módulo claro.
3. Límites negativos explícitos (qué no tocar).
4. Criterios de aceptación verificables (test, tipo exportado, comando).
5. Sin decisiones arquitectónicas.
6. Contexto mínimo local.
7. Salida integrable sin romper contratos de otras hojas.

**Validaciones estructurales:** aciclicidad del DAG; toda hoja tiene contrato; todo `scope` declarado no vacío; no hay dependencia a un nodo inexistente; profundidad ≤ límite configurable.

### Interfaces TypeScript

```ts
export type TaskNodeStatus =
  | 'planned'      // generado por el decomposer, no validado por humano
  | 'ready'        // listo para ejecutar (deps satisfechas, no bloqueado)
  | 'blocked'      // deps pendientes
  | 'running'      // agente en ejecución
  | 'validating'   // corriendo validación local
  | 'done'         // validado OK, commit hecho
  | 'conflict'     // riesgo o conflicto real detectado
  | 'failed'       // falló y no se pudo recuperar
  | 'merged';      // integrado en la rama padre/feature

export type TaskGranularityLevel = 'coarse' | 'medium' | 'fine'; // para experimento

export type TaskKind = 'composite' | 'leaf';

export type DependencyType =
  | 'contractual'  // consume tipo/interfaz que produce otra
  | 'structural'   // modifica archivo que otra crea
  | 'logical';     // necesita el comportamiento de otra para validarse

export interface TaskDependency {
  fromTaskId: string;   // productor
  toTaskId: string;     // consumidor (depende de from)
  type: DependencyType;
  inferred: boolean;    // explícita (decomposer) vs inferida (análisis)
  rationale?: string;
}

export interface TaskReadiness {
  taskId: string;
  isReady: boolean;
  unmetDependencies: string[];
  blockingConflicts: string[]; // ids de ConflictPrediction nivel 'block'
}

export interface TaskValidationIssue {
  code:
    | 'cycle_detected'
    | 'leaf_without_contract'
    | 'empty_scope'
    | 'dangling_dependency'
    | 'max_depth_exceeded'
    | 'non_atomic_leaf';
  taskId?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TaskNode {
  id: string;
  parentId: string | null;
  kind: TaskKind;
  title: string;            // serif-friendly, corto
  intent: string;           // 1-3 frases
  status: TaskNodeStatus;
  granularity: TaskGranularityLevel;
  depth: number;
  childrenIds: string[];
  contract?: AgentTaskContract; // solo si kind === 'leaf'
  worktree?: string;
  agentId?: string;
  metrics?: {
    durationMs?: number;
    costUsd?: number;
    tokensIn?: number;
    tokensOut?: number;
    retries?: number;
  };
}

export interface TaskGraph {
  id: string;
  planId: string;
  repo: string;
  baseBranch: string;
  baseCommit: string;
  featureRequest: string;
  nodes: Record<string, TaskNode>;
  dependencies: TaskDependency[];
  rootId: string;
  createdAt: string;
  // helpers (implementados como funciones puras sobre el grafo):
  // topologicalOrder(): string[]
  // readyLeaves(): TaskNode[]
  // validate(): TaskValidationIssue[]
}
```

**Edición humana:** el grafo es editable antes y durante la ejecución (renombrar, dividir, re-subdividir, agregar/quitar dependencias). Toda edición humana se registra en el trace store con autor `human`.

---

## 4. Agent Task Contract

Cada hoja se transforma en un contrato preciso que se pasa al subagente. Es la base tanto del prompt del agente como del análisis de conflictos.

```ts
export interface AllowedScope {
  paths: string[];          // globs permitidos, p.ej. ["src/lib/tokens/**"]
  maxFilesTouched?: number;
}

export interface ForbiddenScope {
  paths: string[];          // globs prohibidos, p.ej. ["src/ui/**","**/*.config.*"]
  reasons?: Record<string, string>;
}

export interface ContextPack {
  // contexto MÍNIMO necesario; no el repo entero
  typeSignatures: string[];     // firmas/interfaces relevantes (texto)
  referenceSnippets: { path: string; content: string }[];
  conventions?: string[];       // naming, estilo, etc.
  upstreamArtifacts?: string[]; // ids de tareas productoras y qué exportan
}

export interface AcceptanceCriterion {
  kind: 'test' | 'typecheck' | 'exports_symbol' | 'command' | 'custom';
  description: string;
  // verificable automáticamente cuando sea posible:
  command?: string;             // p.ej. "pnpm test src/lib/tokens"
  expectedSymbol?: string;      // p.ej. "RateLimiter"
}

export interface ExpectedOutput {
  changedFiles: string[];       // archivos que se espera tocar
  producedSymbols?: string[];   // símbolos/tipos que esta hoja exporta
  consumedSymbols?: string[];   // símbolos/tipos que esta hoja usa de otras
  diffShapeHint?: string;       // descripción breve del cambio esperado
}

export interface AgentTaskContract {
  taskId: string;
  objective: string;            // qué código escribir, claro y acotado
  context: ContextPack;
  allowed: AllowedScope;
  forbidden: ForbiddenScope;
  relevantSymbols: string[];    // símbolos que leerá/escribirá (clave para conflictos)
  dependencies: string[];       // taskIds de los que depende
  acceptance: AcceptanceCriterion[];
  validationCommands: string[]; // typecheck/lint/test a correr en el worktree
  expectedOutput: ExpectedOutput;
  limits: { maxDurationMs: number; maxCostUsd: number };
  knownRisks?: string[];
  definitionOfDone: string;     // condición textual de completitud
}

export interface AgentRunResult {
  taskId: string;
  worktree: string;
  branch: string;
  success: boolean;
  diff: string;                 // unified diff
  changedFiles: string[];
  validation: ValidationResult; // ver §8
  scopeViolations: string[];    // archivos tocados fuera de AllowedScope
  stdout: string;
  stderr: string;
  metrics: { durationMs: number; costUsd: number; tokensIn: number; tokensOut: number };
  commitHash?: string;
}
```

**Regla [DECISIÓN]:** si `AgentRunResult.scopeViolations` no está vacío → la hoja se marca `failed` (violación de contrato), independientemente de si los tests pasan. Esto hace el contrato vinculante.

---

## 5. Recursive Decomposer

Convierte la feature en el DAG. Es el componente más dependiente del LLM → diseñarlo defensivo (validación de esquema + edición humana).

**Pipeline.**
1. **Input:** `featureRequest` + metadata del repo (lenguaje, estructura de carpetas, convenciones).
2. **Análisis inicial:** identificar capas/áreas (datos, API, UI, tests, infra).
3. **Generación de esqueleto:** árbol de nodos compuestos de primer y segundo nivel (LLM → JSON validado por Zod).
4. **Refinamiento recursivo por nodo:** para cada nodo no atómico, generar hijos; repetir.
5. **Stop conditions:** nodo cumple criterios de atomicidad (§3) **o** se alcanzó `maxDepth` **o** el nodo toca ≤ N archivos y un solo objetivo.
6. **Inferencia de dependencias:** a partir de `producedSymbols`/`consumedSymbols` declarados, crear aristas `contractual`/`structural`.
7. **Validación de esquema** (Zod) **+ validación estructural** (§3) **+ validación semántica básica** (no dos hojas con `objective` idéntico; scopes no idénticos entre hermanas sin dependencia).
8. **Human-in-the-loop:** presentar el grafo; permitir editar/aprobar.
9. **Re-subdivisión bajo demanda:** acción `splitNode(taskId)` re-corre el refinamiento sobre un nodo.

**Riesgos de descomposiciones malas + mitigación.** Hojas no atómicas (mitigar con criterios explícitos en el prompt + validador `non_atomic_leaf`); dependencias omitidas (mitigar con inferencia por símbolos + detección posterior en integración); sobre-descomposición (mitigar con `maxDepth` y métrica de overhead).

### Pseudocódigo

```
function decompose(feature, repoMeta, config):
    skeleton = LLM_skeleton(feature, repoMeta)          # nodos nivel 1-2
    graph = buildGraph(skeleton)
    queue = nonAtomicNodes(graph)
    while queue not empty and graph.maxDepth() < config.maxDepth:
        node = queue.pop()
        if isAtomic(node, config): 
            node.kind = 'leaf'
            node.contract = buildContract(node, graph, repoMeta)   # §4
            continue
        children = LLM_refine(node, graph.context(node))
        attach(graph, node, children)
        queue.push(nonAtomic(children))
    inferDependencies(graph)        # por símbolos producidos/consumidos
    issues = graph.validate()
    return { graph, issues }        # issues != [] => requiere atención humana

function isAtomic(node, config):
    return node.touchesFewFiles(config.maxFiles)
       and node.singleObjective()
       and node.hasVerifiableAcceptance()
       and not node.requiresArchitecturalDecision()
```

**Prompts sugeridos (plantillas, no finales).**
- *Skeleton:* "Sos un planificador de tareas de software. Dada la feature `{feature}` y la estructura de repo `{repoTree}`, devolvé SOLO JSON conforme a `{schema}`: un árbol de áreas y sub-tareas. No escribas código. Cada nodo: title, intent (1-3 frases), area, expectedFiles. No más de {fanout} hijos por nodo."
- *Refine:* "Subdividí la sub-tarea `{node.intent}` en tareas hoja atómicas. Una hoja toca pocos archivos, tiene un objetivo único, criterios de aceptación verificables y no toma decisiones de arquitectura. Devolvé SOLO JSON conforme a `{schema}`, declarando para cada hoja: producedSymbols, consumedSymbols, allowed.paths, forbidden.paths."

**[ABIERTO]** Si el decomposer LLM resulta inestable, evaluar un modo "decomposer asistido" donde el humano define el esqueleto y el LLM solo refina hojas. Dejar la interfaz lista para ambos modos.

---

## 6. Conflict Taxonomy

| Tipo | Definición | Ejemplo | Señales detectables | ¿Pre-ejecución? | ¿Post-ejecución? | Reacción del sistema | Métrica |
|---|---|---|---|---|---|---|---|
| **Textual** | Dos ramas editan las mismas líneas/archivo | Dos hojas editan `login.ts` líneas contiguas | Overlap de `allowed.paths` / `changedFiles` | Sí (parcial, por scope) | Sí (git merge) | Serializar o merge manual | `git_conflicts` |
| **Estructural** | Dos ramas modifican el mismo símbolo | Ambas cambian `class RateLimiter` | Overlap de `relevantSymbols` | Sí | Sí (AST diff) | Serializar | `struct_conflicts` |
| **Contractual** | Cambios incompatibles en interfaz/tipo público | Una cambia firma de `withRateLimit()`, otra la consume | Productor/consumidor sobre símbolo + cambio de firma | Sí (TS Compiler API) | Sí (typecheck global) | Bloquear hasta orden correcto | `contract_conflicts` |
| **Integración** | El merge compila pero rompe build/tests al combinar | Dos features OK por separado, falla `tsc`/tests juntas | — | No (difícil) | Sí (build/test global) | Marcar, delegar | `integration_failures` |
| **Semántico** | Lógica de negocio incompatible no capturada por tipos/tests | Dos interpretaciones distintas de "sesión válida" | — | No | Parcial (tests específicos) | Delegar a humano | `semantic_flags` (fuera de alcance medir bien) |
| **De alcance** | Una hoja toca archivos fuera de su `AllowedScope` | Hoja de UI modifica `schema.prisma` | `scopeViolations` | No | Sí | Fallar la hoja | `scope_violations` |
| **Dependencia omitida** | Consumidor corre antes que productor por dep no declarada | UI usa tipo aún no creado | `consumedSymbols` sin productor `done` | Sí (inferencia) | Sí (typecheck) | Re-ordenar / bloquear | `missing_dep_conflicts` |
| **Cambio de tipo/API** | Caso particular de contractual sobre tipos exportados | Cambia `type User` usado por 3 hojas | Símbolo en `producedSymbols` con muchos consumidores | Sí (TS Compiler API) | Sí | Serializar consumidores | `api_change_conflicts` |
| **Tests/fixtures compartidos** | Dos hojas tocan el mismo fixture/setup de tests | Ambas editan `tests/setup.ts` | Overlap de paths en `tests/**` | Sí | Sí | Serializar | `test_fixture_conflicts` |
| **Migraciones/schema/config** | Dos hojas tocan migraciones, schema o config | Dos migraciones con mismo timestamp | Overlap de paths críticos (`*.prisma`, `migrations/**`, `*.config.*`) | Sí | Sí | Serializar siempre | `critical_path_conflicts` |

**[DECISIÓN]** El MVP **predice** (pre-ejecución) los tipos: textual, estructural, contractual, cambio-de-tipo/API, dependencia-omitida, tests/fixtures, migraciones/config. **Detecta** (post-ejecución) además: integración y alcance. El **semántico** se marca pero no se promete medir su detección con rigor (queda fuera de alcance, ver §16).

---

## 7. Risk Model / Conflict Predictor

Modelo pragmático que estima el riesgo de ejecutar dos hojas en paralelo, combinando señales estáticas. **[DECISIÓN]** Score lineal ponderado + umbrales → nivel; toda predicción es **auditable** (lista de evidencias).

```ts
export type ConflictRiskLevel = 'safe' | 'warn' | 'block';

export interface ConflictEvidence {
  signal:
    | 'file_overlap'
    | 'symbol_overlap'
    | 'producer_consumer'
    | 'public_contract_change'
    | 'critical_path'          // config/migraciones/schema
    | 'shared_test_fixture'
    | 'graph_proximity'
    | 'explicit_dependency'
    | 'inferred_dependency'
    | 'shared_type_change';
  detail: string;              // p.ej. "ambas tocan src/lib/email/templates.ts"
  weight: number;              // contribución al score
}

export interface ConflictRiskScore {
  taskA: string;
  taskB: string;
  score: number;               // 0..1
  evidence: ConflictEvidence[];
}

export interface ConflictPrediction {
  taskA: string;
  taskB: string;
  level: ConflictRiskLevel;
  score: number;
  sharedFiles: string[];
  sharedSymbols: string[];
  predictedConflictTypes: string[]; // de la taxonomía §6
  explanation: string;              // auditable, legible
  recommendation:
    | 'run_parallel'
    | 'serialize'
    | 'run_after'
    | 'request_human_review'
    | 'split_task';
}

export type RiskMatrix = ConflictPrediction[]; // pares del batch candidato
```

**Cálculo (pesos iniciales, a calibrar empíricamente) [ABIERTO los pesos]:**

```
function riskScore(a, b, repoIndex):
    ev = []
    fileOv = overlap(a.allowed.paths ∪ a.expectedOutput.changedFiles,
                     b.allowed.paths ∪ b.expectedOutput.changedFiles)
    if fileOv: ev += {file_overlap, w=0.30}
    symOv = overlap(a.relevantSymbols, b.relevantSymbols)
    if symOv: ev += {symbol_overlap, w=0.25}
    if producesConsumes(a, b): ev += {producer_consumer, w=0.20}
    if changesPublicContract(a) or changesPublicContract(b):
        # usar TS Compiler API: ¿el símbolo cambiado es consumido por la otra rama?
        if affectsTypecheck(a, b, repoIndex): ev += {public_contract_change, w=0.30}
    if touchesCriticalPath(a) and touchesCriticalPath(b): ev += {critical_path, w=0.35}
    if sharedTestFixture(a, b): ev += {shared_test_fixture, w=0.15}
    ev += {graph_proximity, w = 0.05 * proximity(a, b)}
    score = clamp(sum(w for ev), 0, 1)
    level = score >= 0.6 ? 'block' : score >= 0.3 ? 'warn' : 'safe'
    return ConflictPrediction(a, b, level, score, ev, recommend(level, ev))
```

**Baseline obligatorio para el experimento:** un predictor trivial que use **solo `file_overlap`**. La tesis debe mostrar si agregar símbolos/contratos/TS-types mejora precisión/recall sobre ese baseline (§11).

**Uso del TS Compiler API [DECISIÓN, pieza distintiva]:** indexar símbolos exportados/consumidos del repo base; cuando una hoja declara cambiar la firma de un símbolo exportado, marcar como `public_contract_change` a todas las hojas que lo consumen. Esto es lo que diferencia la predicción semántica del overlap textual.

---

## 8. Risk-Aware Scheduler

Decide qué hojas `ready` corren juntas. **[DECISIÓN]** Implementar las políticas como estrategias intercambiables (patrón Strategy) para poder compararlas en el experimento.

```ts
export type SchedulingPolicy =
  | 'single_agent'   // B0: ignora el grafo, una sola ejecución con la feature entera
  | 'sequential_dag' // B1: orden topológico, 1 hoja por vez
  | 'parallel_naive' // B2: todas las ready en paralelo (respeta solo deps)
  | 'risk_aware'     // B3: ready filtradas por RiskMatrix
  | 'human_gated';   // B4: como risk_aware pero pide aprobación en warn/block

export interface SchedulerConfig {
  policy: SchedulingPolicy;
  maxParallelism: number;       // tamaño del worktree pool
  retryLimit: number;
  blockThreshold: number;       // score a partir del cual nunca paraleliza
}

export interface Batch {
  taskIds: string[];
  rationale: string;            // por qué este conjunto es seguro
}

export interface SchedulerDecision {
  batch: Batch;
  deferred: { taskId: string; reason: string }[]; // serializadas/bloqueadas
}
```

**Lógica.**
- Calcular `ready = graph.readyLeaves()` (deps satisfechas).
- `sequential_dag`: emitir batch de tamaño 1 (primera ready en orden topológico).
- `parallel_naive`: batch = todas las ready (hasta `maxParallelism`).
- `risk_aware`: del conjunto ready, elegir el subconjunto máximo donde todo par sea `safe` (o `warn` según umbral); las que tengan `block` con alguna del batch se difieren. Greedy: ordenar por prioridad topológica, agregar una a una si no introduce un par `block`.
- `human_gated`: igual que risk_aware, pero los pares `warn`/`block` generan una solicitud de aprobación (evento `human_review_requested`); no avanza hasta respuesta.
- **Fallos:** si una hoja `failed` y `retries < retryLimit` → reintentar (opcionalmente con contexto ampliado); si supera el límite → marcar `failed`, bloquear dependientes, registrar.

### Pseudocódigo (risk_aware)

```
function nextBatch(graph, risk, config):
    ready = sortTopo(graph.readyLeaves())
    batch = []
    for t in ready:
        if size(batch) >= config.maxParallelism: break
        if all(risk.level(t, b) != 'block' for b in batch):
            batch.append(t)
        else:
            defer(t, reason="block-conflict with batch")
    return SchedulerDecision(batch, deferred)
```

---

## 9. Worktree Execution Layer

Ejecuta cada hoja en un worktree aislado.

```ts
export interface WorktreeSession {
  taskId: string;
  branch: string;          // mh/<taskId>
  path: string;            // .manyhands/<taskId>
  baseCommit: string;
  createdAt: string;
  cleanedUp: boolean;
}

export interface AgentInvocation {
  contract: AgentTaskContract;
  worktree: WorktreeSession;
  model: string;
  promptPreview: string;   // el prompt efectivamente enviado (se loguea)
}

export interface ExecutionTrace {
  taskId: string;
  events: {
    ts: string;
    type: 'tool_call' | 'stdout' | 'stderr' | 'validation' | 'commit' | 'error';
    payload: unknown;
  }[];
}

export interface AgentRunner {
  // abstracción multi-backend; Claude Code CLI es la primera implementación
  run(invocation: AgentInvocation): Promise<AgentRunResult>;
}
```

**Flujo.**
1. `git worktree add -b mh/<id> .manyhands/<id> <baseCommit>`.
2. Preparar contexto: materializar `ContextPack` (no exponer secretos; nunca pasar `.env` real).
3. Invocar agente (Claude Code CLI) con el contrato como prompt, dentro del worktree, con `maxDurationMs`/`maxCostUsd`.
4. Capturar stdout/stderr y tool-calls → `ExecutionTrace`.
5. `git diff` → `changedFiles`; verificar `scopeViolations` contra `AllowedScope`/`ForbiddenScope`.
6. Correr `validationCommands` (§8) → `ValidationResult`.
7. Si OK y sin violaciones → `git commit` (autor `manyhands`); si no → `failed`.
8. Registrar `AgentRunResult` + métricas.

**Seguridad mínima [DECISIÓN]:** lista blanca de comandos de validación; nunca ejecutar comandos arbitrarios fuera de `validationCommands`; nunca volcar secretos en logs/prompts; cada worktree con `.env` de scratch y puertos asignados por rango; cleanup de worktrees al finalizar o reciclado controlado.

---

## 10. Validation Layer

Distingue **validación local de hoja** (en su worktree) de **validación global final** (tras integrar).

```ts
export interface ValidationCheck {
  kind: 'typecheck' | 'lint' | 'unit' | 'integration' | 'build' | 'scope' | 'acceptance';
  passed: boolean;
  command?: string;
  summary: string;
  durationMs: number;
}

export interface ValidationResult {
  taskId?: string;          // ausente si es validación global
  checks: ValidationCheck[];
  passed: boolean;          // AND de checks bloqueantes
}
```

**Local (por hoja):** typecheck (`tsc --noEmit`), lint, unit tests del módulo, validación de scope (archivos tocados ⊆ allowed, ∉ forbidden), verificación de `AcceptanceCriterion`.
**Global (final):** build completo, typecheck global (clave para conflictos contractuales/tipos), integration tests, e2e si existen.

---

## 11. Bottom-Up Integration Engine

```ts
export interface IntegrationStep {
  order: number;
  taskId: string;
  branch: string;
  status: 'queued' | 'merging' | 'merged' | 'needs_rebase' | 'conflict' | 'failed';
  diffStat: { additions: number; deletions: number; files: number };
  commitHash?: string;
  conflictReport?: ConflictPrediction[]; // si surge en el merge real
}

export interface PullRequestDraft {
  title: string;
  summary: string;
  changes: string[];
  testPlan: string[];
  risks: string[];
  diffStat: { additions: number; deletions: number; files: number; commits: number };
}
```

**Flujo.**
1. Para cada nodo compuesto cuyos hijos están todos `done`: crear rama de integración del subtree, mergear commits hijos en **orden topológico** (por batches), correr validación del módulo. Si pasa → nodo `merged`.
2. Detectar conflictos en el merge real: textual/estructural (git), contractual/tipos (typecheck global), integración (build/tests).
3. **Conflicto no resoluble automáticamente → bloquear y delegar al humano** con `conflictReport` y diffs afectados; registrar la decisión humana.
4. Repetir hacia la raíz → diff final + `PullRequestDraft` (resumen autogenerado a partir de contratos e intents).

**[DECISIÓN]** El MVP no resuelve conflictos complejos automáticamente: detecta, explica y delega. Sí puede sugerir estrategias simples (reordenar, rebase).

---

## 12. Trace Store / Observability

**[DECISIÓN]** SQLite con esquema relacional + blobs de diffs/logs en filesystem. Todo run debe ser **reproducible**: se guarda feature, grafo, contratos, prompts, modelo, comandos, outputs, diffs, predicciones, conflictos reales, decisiones de scheduling, intervención humana y resultado.

**Esquema (tablas principales).**
```
plans(id, repo, base_branch, base_commit, feature_request, created_at, mode)            -- mode: demo|benchmark|real
task_graphs(id, plan_id, root_id, json_snapshot, created_at)
tasks(id, graph_id, parent_id, kind, title, intent, status, granularity, depth)
task_contracts(task_id, json)                                                            -- AgentTaskContract serializado
dependencies(id, graph_id, from_task, to_task, type, inferred, rationale)
agent_runs(id, task_id, model, prompt_preview, branch, worktree, success,
           duration_ms, cost_usd, tokens_in, tokens_out, retries, commit_hash, started_at)
run_diffs(run_id, diff_blob_path, changed_files_json, scope_violations_json)
traces(id, task_id, ts, type, payload_json)
validations(id, task_id_or_null, kind, passed, command, summary, duration_ms, scope)     -- scope: local|global
conflict_predictions(id, plan_id, task_a, task_b, level, score, evidence_json,
                     predicted_types_json, recommendation)
conflicts_real(id, plan_id, task_a, task_b, type, detected_phase, detail_json)           -- detected_phase: pre|merge|post
scheduling_decisions(id, plan_id, policy, batch_json, deferred_json, ts)
human_actions(id, plan_id, action, target_task, detail_json, ts)
integration_steps(id, plan_id, order_idx, task_id, status, additions, deletions, files, commit_hash)
runs_eval(id, plan_id, config, metrics_json, seed, model_version, created_at)            -- config: B0..B4
```
La tabla `conflict_predictions` vs `conflicts_real` es la **fuente del cálculo de precisión/recall del predictor** (§11/§7).

---

## 13. Evaluation Protocol

**Configuraciones.**

| Config | Descripción |
|---|---|
| B0 | Single agent: la feature completa a un agente |
| B1 | DAG secuencial: descompuesto pero sin paralelismo |
| B2 | DAG paralelo naive: todo lo posible en paralelo según deps |
| B3 | ManyHands risk-aware: DAG + predictor + scheduler consciente de riesgo |
| B4 (opcional) | Human-gated: B3 + aprobación humana en nodos riesgosos |

Para la **pregunta central** (granularidad↔calidad), además variar la granularidad de la descomposición (coarse/medium/fine) en las configuraciones con DAG.

**Métricas.**
- *Funcionales (principal):* tests pass rate, build pass rate, éxito de integración.
- *Conflictos:* git_conflicts, integration_failures, conflictos semánticos marcados.
- *Predictor:* **precisión, recall, F1** de `conflict_predictions` vs `conflicts_real`, comparado contra baseline file-overlap; matriz de confusión; PR-curve.
- *Costo/eficiencia:* reintentos, duración total, costo USD, tokens (reportar con cautela; confundidos por infra).
- *Calidad/proceso:* cambios fuera de scope, trazabilidad cambio→tarea, overhead de coordinación, profundidad del DAG, nº de hojas, granularidad efectiva.

**Recolección e interpretación.** ≥3 repeticiones por celda (config × granularidad) con seeds variados; versiones de modelo fijas; repos en commits fijos; entornos aislados; todo en `runs_eval`. Reportar **varianza** y **tamaños de efecto**. Encuadre **exploratorio**: conclusiones matizadas (mejora en ciertos casos) son válidas. Gráficos: curva granularidad↔pass-rate con bandas; barras de conflictos/tiempo por config; matriz de confusión + PR-curve del predictor vs baseline.

**Dataset [DECISIÓN parcial / ABIERTO la lista final]:** 3 features TS de complejidad moderada **con suite de tests existente** (los tests son el ground truth). Candidatas: auth passwordless con magic links; filtrado/orden en vista de usuarios; descuentos + persistencia en carrito. Seleccionar y congelar en Fase 0/9.

---

## 14. UI/UX del MVP

Modos/pantallas: Home / Project setup · Feature input · **Plan** · **Decompose** (graph editor) · **Conflict preview** (pre-flight) · **Execution dashboard** · Worktree/subagent run details · **Integration view** · Final PR draft · **Evaluation dashboard**.

La UI debe hacer visible: grafo de tareas; estado de cada nodo; contratos; tareas listas/bloqueadas; batches paralelos; riesgo entre tareas; conflictos anticipados y reales; trazas; diffs; validaciones; métricas. **Principio:** ManyHands potencia al ingeniero; el usuario aprueba el plan, supervisa ejecución e integración.

**[DECISIÓN]** Stack UI: Next.js + React + React Flow (canvas DAG) + Tailwind. Estética técnica densa (referencia: los mockups ya diseñados del proyecto — grafo por fases, inspector lateral con Diff/Tool calls/Logs/Spec, conflict predictor como panel acoplable, merge sequencer con PR preview). Reutilizar esos diseños como referencia visual.

---

## 15. Arquitectura de repositorio (monorepo)

```
manyhands/
├─ apps/
│  ├─ web/                 # Next.js UI (React Flow, dashboards)
│  └─ api/                 # Node/TS: orquestación, WebSocket, REST
├─ packages/
│  ├─ shared/              # tipos comunes, utilidades, Zod schemas base
│  ├─ task-graph/          # TaskGraph, TaskNode, DAG, validaciones, readiness
│  ├─ contracts/           # AgentTaskContract, ContextPack, builders
│  ├─ decomposer/          # recursive decomposer + prompts + validación
│  ├─ conflict-risk/       # taxonomía, RiskModel, ConflictPredictor, TS Compiler API
│  ├─ scheduler/           # políticas B0..B4 (Strategy), batching
│  ├─ worktree-runner/     # WorktreeSession, AgentRunner, Claude Code adapter
│  ├─ integration-engine/  # merge bottom-up, conflicto real, PR draft
│  ├─ trace-store/         # SQLite, esquema, repos de persistencia
│  ├─ evaluator/           # protocolo experimental, métricas, export
│  └─ core/                # orquestador: une graph+scheduler+runner+integration
├─ docs/                   # este KB, ADRs, prompts, esquema de datos
├─ examples/               # repos TS de prueba (o submódulos/fixtures)
└─ benchmarks/             # configs B0..B4, datasets, resultados, scripts
```

**Responsabilidades, I/O y dependencias permitidas.**
- `shared`: tipos/Zod. No depende de nada.
- `task-graph`: depende de `shared`. I/O: featureRequest+nodos → TaskGraph validado.
- `contracts`: depende de `shared`, `task-graph`. I/O: TaskNode → AgentTaskContract.
- `decomposer`: depende de `shared`, `task-graph`, `contracts`. I/O: featureRequest+repoMeta → {graph, issues}. Llama al LLM.
- `conflict-risk`: depende de `shared`, `task-graph`, `contracts`. I/O: pares de hojas + índice del repo (TS Compiler API) → RiskMatrix.
- `scheduler`: depende de `shared`, `task-graph`, `conflict-risk`. I/O: graph+riskMatrix+config → SchedulerDecision.
- `worktree-runner`: depende de `shared`, `contracts`. I/O: AgentInvocation → AgentRunResult. Efecto: git + subprocess.
- `integration-engine`: depende de `shared`, `task-graph`, `worktree-runner`. I/O: ramas done → IntegrationStep[] + PullRequestDraft.
- `trace-store`: depende de `shared`. I/O: eventos → SQLite.
- `evaluator`: depende de casi todos. I/O: configs → runs_eval + métricas.
- `core`: orquestador que compone todo; lo consumen `apps/api`.
- `apps/api`: expone REST + WebSocket a `apps/web`. No contiene lógica de dominio (delega en `core`).

**Regla de dependencias [DECISIÓN]:** las dependencias van de `apps` → `core` → `packages` de dominio → `shared`. Ningún `package` de dominio importa de `apps`.

---

## 16. Decisiones técnicas iniciales (ADRs resumidos)

Formato: decisión · justificación · tradeoffs · riesgos · alternativa descartada.

1. **TypeScript end-to-end.** *Just.:* el activo distintivo (verificación de tipos entre ramas) usa el TS Compiler API, natural en Node/TS; unificar stack reduce costo de contexto para un solo dev en 3 meses. *Tradeoff:* menos ecosistema de análisis estático general que Python. *Riesgo:* performance del TS Compiler API en repos grandes. *Alt. descartada:* backend Python (mejor análisis estático general, pero cruza lenguajes y complica el acceso al compilador TS).
2. **Next.js (UI).** *Just.:* React Flow para el DAG, ecosistema maduro, portfolio-worthy. *Tradeoff:* peso de framework para una app interna. *Alt.:* Vite SPA (más liviano, menos baterías incluidas).
3. **Node/TS (orquestación).** *Just.:* unificación; async para subprocess. *Riesgo:* concurrencia CPU-bound limitada (irrelevante, el trabajo es I/O-bound). *Alt.:* servicio Python aparte.
4. **SQLite (trazas), migrable a Postgres.** *Just.:* cero fricción, reproducible, portable. *Tradeoff:* concurrencia de escritura limitada (irrelevante a esta escala). *Alt.:* Postgres desde el inicio (overkill para MVP).
5. **git worktree.** *Just.:* aislamiento real por rama, estándar. *Riesgo:* colisiones de runtime (puertos/.env) — mitigado con asignación por worktree. *Alt.:* clones completos (más caros en disco/tiempo).
6. **Claude Code CLI como backend inicial.** *Just.:* agente de código maduro vía subprocess. *Riesgo:* acoplamiento a una CLI/proveedor. *Mitigación:* interfaz `AgentRunner` con adapter; dejar lista la abstracción para Codex u otros. *Alt.:* Aider (segundo adapter opcional).
7. **Abstracción `AgentRunner` multi-backend.** *Just.:* portabilidad y comparabilidad. *Tradeoff:* capa extra. Recomendado igual.
8. **Validación por tests/build/lint/typecheck.** *Just.:* criterio objetivo y reproducible. *Alt. descartada:* LLM-as-judge como criterio principal (menos defendible).
9. **Zod para esquemas.** *Just.:* validación runtime del JSON del LLM (clave para robustez del decomposer) + tipos inferidos. *Alt.:* validación manual (frágil).
10. **Grafo: implementación propia liviana inicial.** *Just.:* control total sobre estados/readiness; el DAG es chico. *Alt.:* librería de grafos (graphlib) si crece la complejidad — dejar el punto de extensión.
11. **Runs reproducibles.** *Just.:* requisito experimental. Seeds, versiones pinneadas, commits fijos, todo en `trace-store`.
12. **Tres modos: demo · benchmark · real.** *Just.:* la demo prioriza vistosidad; benchmark prioriza métricas/reproducibilidad; real opera sobre un repo del usuario. Campo `mode` en `plans`.

**[ABIERTO]:** pesos del risk model (§7); lista final de features de evaluación; si el decomposer corre full-auto o asistido; segundo backend de agente.

---

## 17. Relación con SOTA / bibliografía

> No inventar resultados. Las referencias marcadas **(revisar)** deben verificarse antes de citarse en el informe. Se separan hechos, inferencias, hipótesis y decisiones.

- **ReAct** (Yao et al., arXiv:2210.03629) **[HECHO]**: razonamiento + acción + trazas interpretables. *Relación:* el patrón tool-call + trace de cada subagente se inspira en ReAct; ManyHands lo registra en `traces`.
- **Reflexion** (Shinn et al., arXiv:2303.11366) **[HECHO]**: feedback textual para auto-mejora. *Relación:* inspiración para reintentos con contexto ampliado; **no** requerido en el MVP.
- **SWE-bench / SWE-bench Verified** (Jimenez et al., arXiv:2310.06770; Verified con OpenAI) **[HECHO]**: evaluación realista sobre issues/repos con tests como oráculo. *Relación:* fundamenta usar tests como ground truth (§13).
- **SWE-agent** (Yang et al., arXiv:2405.15793) **[HECHO]**: el diseño de la interfaz agente-entorno (ACI) impacta fuertemente el rendimiento. *Relación:* justifica invertir en el diseño del contrato y del contexto entregado al agente (§4).
- **MetaGPT** (arXiv:2308.00352), **ChatDev** (arXiv:2307.07924), **AgentOrchestra** (arXiv:2506.12508) **[HECHO]**: sistemas multi-agente role-based / jerárquicos. *Relación:* antecedentes de coordinación; ManyHands se diferencia por descomposición a hojas atómicas + worktrees + predicción de conflictos.
- **TDAG** (arXiv:2402.10178) **[HECHO]**: descomposición dinámica + subagente por sub-tarea. *Relación:* antecedente directo del decomposer; diferencia: TDAG no usa worktrees ni mide granularidad en código real.
- **Guided Code Generation with LLMs** (arXiv:2501.06625) **[HECHO]**: descomposición recursiva a hojas atómicas; +23.79% Pass@1 en HumanEval. *Relación:* antecedente más cercano; diferencia: HumanEval (funciones aisladas) vs repos reales con paralelismo e integración.
- **Compositional Hardness of Code in LLMs** (arXiv:2409.18028) **[HECHO]**: respaldo teórico a por qué descomponer ayuda.
- **Herramientas industriales** — Conductor, Vibe Kanban, Crystal, **Symphony** (OpenAI, 2026, verificado) **[HECHO]**: orquestación con worktrees en paralelo. *Relación:* ManyHands añade descomposición automática + predicción de conflictos + control human-in-the-loop. (Detalles de features específicas de cada herramienta: **(revisar)** antes de afirmar en el informe.)
- **Evaluación empírica en ingeniería de software** **[INFERENCIA]**: metodología de comparación con repeticiones, control de variables y tamaños de efecto; verificar guías concretas **(revisar)**.

**Hipótesis propias del proyecto [HIPÓTESIS]:** existe granularidad óptima; la predicción semántica supera al overlap de archivos; el paralelismo risk-aware reduce fallos de integración vs naive. Ninguna debe asumirse verdadera en el código ni en el informe sin evidencia.

---

## 18. Alcance y límites

**Dentro:** TypeScript; repositorios acotados con suite de tests; worktrees; descomposición recursiva; contratos de tarea; DAG; scheduler (B0–B4); predictor inicial por señales estáticas (+ TS Compiler API); UI visual; evaluación empírica.

**Fuera:** entrenar/ajustar modelos; resolver automáticamente todos los conflictos complejos (en particular semánticos); soporte multi-lenguaje completo; multiusuario; despliegue productivo robusto; garantías formales de optimalidad; reemplazar al desarrollador humano.

---

## 19. Roadmap de implementación para Codex

Cada fase: objetivo · entregables · archivos esperados · tests mínimos · criterios de done. Todo detrás de interfaces; mock antes que real.

### Fase 0 — Setup
- **Objetivo:** monorepo operativo.
- **Entregables:** workspace (pnpm), TS configurado, lint/test/build, CI local, esquemas base Zod, docs (este KB).
- **Archivos:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/shared/src/index.ts`, `docs/`.
- **Tests mínimos:** `pnpm build` y `pnpm test` verdes en vacío.
- **Done:** monorepo compila; `shared` exporta tipos base.

### Fase 1 — Core models
- **Objetivo:** modelo de grafo y contratos.
- **Entregables:** `task-graph` (TaskNode, TaskGraph, validate, readyLeaves, topologicalOrder), `contracts` (AgentTaskContract + builder), validadores.
- **Tests:** construcción de grafo; detección de ciclo; readiness con deps; validación de hoja sin contrato.
- **Done:** se puede construir y validar un DAG a mano y obtener `readyLeaves`.

### Fase 2 — Decomposer mock
- **Objetivo:** generar un DAG determinístico (sin LLM) para una feature de ejemplo.
- **Entregables:** `decomposer` con un generador fijo (fixture del caso "magic links"); validación de esquema; render del grafo en `apps/web`.
- **Tests:** el DAG fixture pasa `validate()`; el render muestra nodos/edges.
- **Done:** se ve el grafo del caso de ejemplo en la UI.

### Fase 3 — Worktree runner mock
- **Objetivo:** ejecutar un "agente" dummy en un worktree real.
- **Entregables:** `worktree-runner` (crear worktree, ejecutar comando dummy que escribe un archivo, capturar diff, cleanup), `AgentRunner` mock.
- **Tests:** se crea worktree, se obtiene diff de un cambio conocido, se limpia.
- **Done:** lazo crear→ejecutar→diff→cleanup funciona en un repo de prueba.

### Fase 4 — Scheduler
- **Objetivo:** políticas de scheduling.
- **Entregables:** `scheduler` con `sequential_dag`, `parallel_naive`, `risk_aware` (con riesgo mock), `single_agent`; batching respetando deps y `maxParallelism`.
- **Tests:** orden topológico correcto; naive paraleliza ready; risk_aware difiere pares `block`.
- **Done:** dadas hojas ready, cada política emite el batch esperado.

### Fase 5 — Conflict risk
- **Objetivo:** predictor inicial auditable.
- **Entregables:** `conflict-risk`: overlap por archivos y símbolos, productor/consumidor, critical paths, matriz de riesgo, explicación; baseline file-overlap.
- **Tests:** dos hojas mismo archivo → `block`; hojas disjuntas → `safe`; evidencia presente y legible.
- **Done:** `RiskMatrix` correcta sobre fixtures; baseline comparable.

### Fase 6 — Agent integration (real)
- **Objetivo:** Claude Code CLI como `AgentRunner` real.
- **Entregables:** adapter de Claude Code; contrato → prompt; captura de tool-calls/costos; verificación de scope.
- **Tests:** ejecución real sobre una hoja simple produce diff válido y respeta scope (test de integración, puede requerir credenciales — marcar como opcional en CI).
- **Done:** una hoja real se ejecuta end-to-end y valida.

### Fase 7 — Integration engine
- **Objetivo:** merge bottom-up + PR draft.
- **Entregables:** `integration-engine`: merge por orden topológico, detección de conflicto real (git + typecheck global), `PullRequestDraft`, bloqueo+delegación en conflicto.
- **Tests:** merge de ramas disjuntas OK; merge de ramas en conflicto → reporte + bloqueo; PR draft generado.
- **Done:** una feature completa de ejemplo llega a PR draft.

### Fase 8 — Trace store
- **Objetivo:** persistencia y reproducibilidad.
- **Entregables:** `trace-store` (esquema SQLite §12), repos de persistencia, visualización básica de un run, export de run.
- **Tests:** un run completo se persiste y se puede re-cargar; `conflict_predictions` y `conflicts_real` quedan registrados.
- **Done:** un run es reproducible desde lo persistido.

### Fase 9 — Evaluation
- **Objetivo:** comparar B0/B1/B2/B3 (+granularidad).
- **Entregables:** `evaluator`: escenarios benchmark, runner de configs, cálculo de métricas (incl. precisión/recall del predictor vs baseline), export CSV/JSON; dataset de 3 features congelado.
- **Tests:** corrida sintética produce métricas coherentes; precisión/recall calculadas desde el trace store.
- **Done:** tabla comparativa B0–B3 generada sobre al menos una feature real, con repeticiones.

### Fase 10 — Dashboard final
- **Objetivo:** vistas de demo y evaluación.
- **Entregables:** `apps/web`: DAG canvas (estados, batches, riesgo), conflict preview, execution dashboard (vivo), integration view + PR draft, evaluation dashboard (comparación, curva granularidad↔calidad, métricas del predictor).
- **Tests:** render con datos de un run real; estados y conflictos visibles.
- **Done:** demo end-to-end navegable + dashboard de resultados experimentales.

---

## 20. Invariantes y reglas que Codex debe respetar siempre

1. **Todo detrás de interfaces; mock antes que real** (decomposer, agent runner, risk model). Permite avanzar sin depender de credenciales ni de LLMs.
2. **El contrato es vinculante:** violación de scope → hoja `failed`, aunque pasen los tests.
3. **Toda predicción de conflicto es auditable:** siempre incluir `evidence`/`explanation`.
4. **Reproducibilidad primero en modo benchmark:** seeds, versiones pinneadas, commits fijos, todo persistido.
5. **Human-in-the-loop:** el sistema nunca mergea automáticamente un conflicto no resuelto; delega.
6. **Métrica principal = tests/build pass rate**, no tiempo ni juicio subjetivo.
7. **No exponer secretos** en prompts, logs ni worktrees; lista blanca de comandos.
8. **Dependencias del monorepo** solo en la dirección `apps → core → dominio → shared`.
9. **No prometer ni codear** lo que está en "Fuera de alcance" (§18) salvo como punto de extensión documentado.
10. **Separar siempre** hecho / inferencia / hipótesis / decisión en docs y ADRs nuevos.
