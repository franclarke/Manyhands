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

El camino productivo usa `risk_aware` por default. `parallel_naive` no es un
fallback implícito: si se usa, debe venir seleccionado de forma explícita y deja
warning auditable.

### Contexto de seguridad

`buildSchedulingSafetyContext` normaliza los inputs del scheduler:

- toma contratos desde el `TaskGraph` cuando no se pasan por separado;
- genera o completa la `riskMatrix` desde contratos, scopes y, cuando existen,
  señales estáticas del `repository-index`;
- agrega riesgo conservador para scope solapado, contrato faltante, scope vacío,
  símbolos producer/consumer concretos o declaraciones incompatibles del mismo
  seam;
- emite warnings/fallbacks (`missing_contract`, `empty_scope`,
  `missing_repository_index`, `risk_matrix_missing`, `risk_matrix_incomplete`,
  `parallel_naive_explicit`).

La regla de degradación es serializar antes que paralelizar sin evidencia. Un
`InterfaceContract` canónico producido y consumido con la misma identidad,
firma, kind y origen sí es evidencia positiva de compatibilidad: ese seam no se
promueve a riesgo por sí solo. Los agentes pueden compartir wave si tampoco hay
riesgo físico de scopes, archivos, símbolos o imports. Esto preserva el objetivo
del grounding: construir en paralelo contra una interfaz congelada.

### Señales estructurales del repo

El scheduler no recorre el filesystem. Consume evidencia ya construida por
`conflict-risk`:

- `static_import_dependency`: una tarea toca un módulo exportador y otra toca un
  archivo que lo importa;
- `static_producer_consumer_symbol`: una tarea produce un símbolo concreto que
  otra consume;
- `static_shared_schema_dependency`, `static_public_api_surface_overlap`,
  `static_critical_file_overlap` y señales similares derivadas de `files`,
  `symbols`, `imports` y `exports`.

En el camino web, planning persiste `staticConflictSignals` compactas junto con
la `riskMatrix`; `execution-host` las reusa en cada wave. En uso directo,
`RunExecutor.run` puede recibir `repositoryIndex` y pasarla al contexto de
scheduling. Si no hay índice ni señales, se mantiene el predictor heurístico de
contratos/scopes y se emite `missing_repository_index`.

### Evento durable de wave

El package `scheduler` no persiste eventos. En el camino web, `execution-host`
usa el helper `selectAndPersistSchedulingWave`, que selecciona la wave con
`selectScopeAwareWave` y persiste `run.scheduling.wave_selected` como evento
required antes de devolver los task ids para dispatch. Si el append falla, esa
wave no se ejecuta silenciosamente.

Payload mínimo:

- `source`, `waveIndex`, `policy`;
- `readyTaskIds`, `selectedTaskIds`, `blockedTaskIds`;
- `blockedReasons`;
- `riskSummary`;
- `fallbacks` y `warnings`.

Las razones no incluyen el índice completo. Persisten solo el resumen compacto
del riesgo elegido, por ejemplo que `consumer` fue bloqueada porque toca un
archivo que importa `src/api.ts` tocado por `exporter`.

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
