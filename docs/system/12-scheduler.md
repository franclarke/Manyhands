# Scheduler y Selección de Waves

**Archivos fuente:** `packages/scheduler/src/index.ts`

---

## Qué Es

El `scheduler` convierte un plan aprobado en una secuencia de **waves**: grupos de
tareas que pueden ejecutarse en paralelo sin pisarse. Es el puente entre "tengo un
DAG válido" y "puedo lanzar agentes en simultáneo con seguridad".

## Responsabilidad

Decidir *qué tareas del frontier pueden correr juntas* respetando tres
restricciones: dependencias, scope de archivos y riesgo de conflicto. No ejecuta
tareas ni habla con agentes — solo selecciona y ordena.

## Cómo Funciona

### El frontier

En cada paso de la ejecución, el *frontier* es el conjunto de tareas ejecutables
(hojas e integradores) cuyas dependencias ya están resueltas. El scheduler opera
sobre ese conjunto dinámico.

### `selectScopeAwareWave` (el corazón)

Del frontier, elige el subconjunto seguro para paralelizar aplicando dos filtros
contra las tareas ya seleccionadas:

1. **Riesgo:** nunca coagenda un par con predicción `high` o `blocking` (lo dice la
   matriz de `conflict-risk`).
2. **Scope de archivos:** serializa pares cuyos scopes declarados (`executionScope`)
   se **solapan**. El solapamiento se calcula sobre los *segmentos literales* del
   path antes del primer glob: si uno prefija al otro, se serializan. Solo cuentan
   `implementationPaths` y `testPaths`: los `configPaths` (manifests compartidos
   como `package.json`/`tsconfig.json`) se **excluyen** a propósito — como todas
   las hojas parten del mismo commit de esqueleto, serializar por ellos nunca evita
   el conflicto de integración (lo resuelve el composer), solo colapsa la wave a una
   tarea.

El cálculo es deliberadamente **conservador hacia serializar, nunca hacia
colisión**: ante la duda, prefiere no paralelizar. Y el frontier nunca se
*starvea* — si ninguna tarea es compatible con las ya elegidas, igual emite la
primera para garantizar progreso.

### Políticas (`scheduleTasks`)

Para flujos no adaptativos hay tres políticas:

- **`sequential_dag`:** una tarea por wave (orden topológico).
- **`parallel_naive`:** agrupa hasta `maxParallel`, ignorando el riesgo.
- **`risk_aware`:** agrupa tareas listas sin pares `high`/`blocking`.

### Gates humanos (`applyHumanGateToSchedule`)

Aplica una política determinista de intervención: los conflictos `high` se
**serializan**; los `blocking` **requieren revisión humana** antes de poder
ejecutarse.

## Interfaces

**Recibe:** el `TaskGraph`, la matriz de riesgo de `conflict-risk`, y un
`maxParallel` opcional (sin él, paralelismo no acotado — D9).

**Produce:** un `SchedulerPlan` (waves/`ExecutionBatch`) o, en el camino
adaptativo, la wave seleccionada para el frontier actual.

## Cómo Encaja

El `executionGraph` (en `orchestrator-graph`) calcula el frontier y consulta al
scheduler para decidir la próxima wave; la matriz de riesgo proviene de
[`conflict-risk`](13-conflict-risk.md), que a su vez se apoya en el
[`repository-index`](14-repository-index.md).
