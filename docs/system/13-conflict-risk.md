# Conflict-risk: Predicción de Conflictos

**Archivos fuente:** `packages/conflict-risk/src/index.ts`

---

## Qué Es

El `conflict-risk` predice, **antes** de ejecutar, qué pares de tareas tienen
riesgo de chocar entre sí. Es la señal que permite al `scheduler` paralelizar con
criterio en vez de a ciegas.

## Responsabilidad

Mirar dos contratos de tarea y estimar cuán probable es que, al ejecutarse en
paralelo, produzcan un conflicto (textual, estructural o de dependencia faltante).
No decide el scheduling — solo aporta evidencia y una recomendación.

## Cómo Funciona

### `predictConflict(taskA, taskB)`

Junta **evidencia ponderada** entre los dos contratos:

- `file_overlap` — esperan cambiar el mismo archivo (peso alto);
- `path_overlap` — sus paths permitidos se solapan;
- `symbol_overlap` — mencionan los mismos símbolos;
- `producer_consumer` — uno produce un símbolo que el otro consume;
- `critical_path` — ambos tocan archivos críticos (config, schema, tipos);
- `shared_test_fixture` — comparten fixtures de test.

Los pesos se suman a un `score` clampeado a `[0,1]`, que se mapea a un nivel:

- `low` (`< 0.3`), `medium`, `high` (`≥ 0.75`);
- `blocking` si hay una señal estática `blocking` o una dependencia explícita.

Cada predicción incluye una **recomendación accionable**: `run_parallel`,
`serialize`, `add_dependency` o `requires_human_review`.

### Señales estáticas v0

`buildStaticConflictSignals` enriquece la predicción cruzando los contratos con el
[`repository-index`](14-repository-index.md): mismo archivo de símbolos declarados,
producer-consumer real, dependencia de schema compartido, solapamiento de fixtures
o de API pública, y archivos/símbolos esperados que faltan. Estas señales elevan el
score y pueden marcar un par como `blocking` (ver `ADR-0008`).

### La matriz

`buildTaskPairRiskMatrix` corre `predictConflict` sobre **todos los pares** del
plan, produciendo la `TaskPairRiskMatrix` que consume el scheduler.

## Interfaces

**Recibe:** los `AgentTaskContract` del plan (y opcionalmente un `RepositoryIndex`
para las señales estáticas).

**Produce:** una `TaskPairRiskMatrix` (lista de `ConflictPrediction`).

## Cómo Encaja

Es una señal de *grounding* para el [`scheduler`](12-scheduler.md): la
recomendación y el nivel de riesgo determinan qué pares pueden compartir wave.
