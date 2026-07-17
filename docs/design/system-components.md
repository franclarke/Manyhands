# Componentes conceptuales

## Intake y comprensión

### Goal Intake

Captura objetivo, restricciones, workspace, executor y preferencias. Valida
input y crea un `RunTargetContext` inmutable. No diseña el grafo.

### Repository Inspector

Produce modelo estructural, convenciones, paquetes, tests, comandos confiables,
estado git y riesgos. No decide tareas; entrega evidencia al planner y a la
validación.

## Planning

### Planner

Propone objetivos parciales, fronteras de integración y preguntas relevantes.
Su salida es semántica y explicable, todavía no ejecutable.

### Graph Compiler

Materializa nodos, parentage, requirements, seams, constraints, contratos,
scopes y validaciones. Es determinista respecto de la propuesta y las políticas
explícitas siempre que sea posible.

### Plan Critics

Evalúan completitud, atomicidad, contratos, DAG, scope, riesgo y cobertura de
evidencia. Producen findings accionables. No reparan silenciosamente una
arquitectura ambigua.

### Contract Baseline Builder

Materializa tipos, schemas, stubs o adaptadores mínimos que permiten implementar
seams en paralelo. Produce un commit/manifest identificable; no desarrolla las
features.

## Coordinación

### Run Coordinator

Recibe comandos, mantiene leases, invoca casos de uso y registra eventos. Es el
único componente autorizado a adoptar resultados y avanzar outcomes.

### Scheduler

Calcula readiness y selecciona waves según artefactos, contratos, decisiones,
recursos, riesgo y presupuesto. Registra la selección antes del dispatch.

### Decision Service

Crea y resuelve decisiones con CAS, impacto y evidencia. No pausa globalmente el
run salvo que no exista trabajo independiente.

## Ejecución

### Execution Base Builder

Construye una base exacta desde el commit del run, baseline de contratos y
artefactos requeridos. Produce manifest e `InputFingerprint`.

### Node Executor

Prepara worktree, contexto y prompt; invoca `AgentExecutor`; captura diagnóstico
y diff. No adopta el resultado ni decide que está verificado.

### Scope Enforcer

Clasifica paths cambiados, aplica deny-wins y detecta commits inesperados. Un
incumplimiento descarta el intento.

### Validation Service

Compila recetas, ejecuta baseline y candidato, construye Evidence Matrix y
decide elegibilidad. Valida commits exactos en sandboxes limpios.

## Composición

### Artifact Registry

Registra candidatos, outputs lógicos, commits, digests, evidencia, producers,
consumers y freshness. No almacena un segundo DAG.

### Composite Integrator

Compone artefactos hijos, clasifica conflictos, intenta una reparación semántica
acotada y valida el contrato del composite. Produce un artefacto nuevo; no marca
el run completo.

### Delivery Service

Prepara el candidato final, valida ese candidato, publica en el destino y crea
`FinalArtifactManifest`. No entrega un árbol distinto del validado.

## Persistencia y observabilidad

### Run Event Store

Append-only, orden durable, idempotencia y replay. Almacena eventos de dominio,
no stdout.

### Snapshot Store

Materializa una proyección con cursor y schema version. Permite recuperación,
pero puede reconstruirse.

### Trace Store

Guarda prompts, logs, timings y diagnósticos. Es opt-in para la UI y no decide
estados.

### Process Supervisor y leases

Controlan procesos, cancelación, takeover y fencing. Un proceso vivo sin lease
vigente no puede persistir resultados.

## Proyección de producto

### Run Model

Reducer y selectores puros que convierten eventos en un modelo consumible.

### Graph Workspace

Representa topología, actividad y relaciones. Conserva viewport y selección.

### Decision UI

Tarjeta contextual, popup accesible y cola global. No inventa bloqueos.

### Result Workspace

Presenta Evidence Matrix, cambios, candidato y entrega cuando `result_ready`.
