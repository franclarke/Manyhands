# Instantánea canónica de entrada para G6

Esta carpeta contiene la instantánea mínima versionada que necesita
`derive-g6-results.mjs` para reproducir las seis filas canónicas desde un clone
limpio. Se copiaron sin reinterpretar los archivos de los runs originales; los
raw runs completos permanecen preservados en `../runs/` y no se reemplazan por
esta instantánea.

El derivador usa esta carpeta por defecto. Para inspeccionar explícitamente
otra colección de runs se puede pasar `--runs <directorio>`.

Se conserva por run `cell.json`, `result.json`, `run.json`,
`run.events.v2.jsonl`, `run.granularity-metrics.json` y el veredicto disponible
(`external-verdict.json` o `oracle-result.json`). Los hashes SHA-256 de cada
archivo están en `manifest.json`; no se normalizan finales de línea ni se
reserializa JSON antes de hashear.

## Qué no se concluye

- Esta instantánea no reemplaza los raw runs, journals, patches ni worktrees.
- No demuestra que el candidate sea correcto más allá del veredicto externo
  conservado en cada carpeta.
- No convierte los intentos no atribuibles en filas métricas ni en cero.
