# Conflict-risk: Predicción de Conflictos

**Archivos fuente:** `packages/conflict-risk/src/index.ts`

---

## Qué Es

El `conflict-risk` predice, antes de ejecutar, qué pares de tareas tienen riesgo
de chocar entre sí. Es la señal que permite al `scheduler` paralelizar con
criterio en vez de a ciegas.

## Responsabilidad

Mirar dos contratos de tarea y estimar cuán probable es que, al ejecutarse en
paralelo, produzcan un conflicto textual, estructural o de dependencia faltante.
No decide el scheduling; solo aporta evidencia y una recomendación.

## Cómo Funciona

### `predictConflict(taskA, taskB)`

Junta evidencia ponderada entre los dos contratos:

- `file_overlap`: esperan cambiar el mismo archivo. Esto por sí solo es riesgo
  `high`.
- `path_overlap`: sus paths permitidos o esperados se solapan.
- `symbol_overlap`: mencionan los mismos símbolos.
- `producer_consumer`: uno produce un símbolo que el otro consume.
- `critical_path`: ambos tocan archivos críticos como config, schema o tipos.
- `shared_test_fixture`: comparten fixtures de test.

Los pesos se suman a un `score` clampeado a `[0,1]`, que se mapea a `low`,
`medium`, `high` o `blocking`. Cada predicción incluye una recomendación:
`run_parallel`, `serialize`, `add_dependency` o `requires_human_review`.

### Señales Estáticas Desde Repository-Index

`buildStaticConflictSignals` cruza los contratos con
[`repository-index`](14-repository-index.md): archivos, símbolos, imports,
exports y `kind` de archivo. Señales actuales:

- `static_import_dependency`: un contrato espera tocar un módulo y otro contrato
  espera tocar un archivo que lo importa.
- `static_producer_consumer_symbol`: un símbolo producido por una tarea es
  consumido por otra.
- `static_same_declared_symbol_file`: ambos contratos referencian símbolos
  declarados en el mismo archivo.
- `static_shared_schema_dependency`, `static_critical_file_overlap`,
  `static_test_fixture_overlap`, `static_public_api_surface_overlap`.
- `static_missing_expected_file` y `static_missing_expected_symbol`, que indican
  que el contrato menciona algo ausente del índice.

`buildRepositoryAwareRiskMatrix` es el wrapper para el caso común: recibe
contratos + `RepositoryIndex`, deriva señales estáticas y construye la
`TaskPairRiskMatrix`.

## Interfaces

**Recibe:** `AgentTaskContract` por tarea y, opcionalmente, `RepositoryIndex` o
`staticSignals` ya derivadas.

**Produce:** una `TaskPairRiskMatrix` con `ConflictPrediction`: level, score,
evidence, sharedFiles/sharedSymbols, recommendation y explanation compacta.

## Fallback

Si no hay índice, `conflict-risk` puede seguir prediciendo con contratos. El
`scheduler` marca ese caso con `missing_repository_index` y usa el fallback
conservador de contracts/scopes; ausencia de índice no significa bajo riesgo.

## Cómo Encaja

Planning puede persistir `staticConflictSignals` junto con `riskMatrix`.
`execution-host` reusa esas señales para seleccionar waves y persistir
`run.scheduling.wave_selected` con razones compactas. `RunExecutor.run` también
acepta un `repositoryIndex` opcional para ejecuciones directas.

El predictor sigue siendo heurístico: no prueba equivalencia semántica, no
detecta todos los conflictos lógicos y no reemplaza validación ni integración
bottom-up.
