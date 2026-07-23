# ADR 0011 — Índice exacto de repositorio y pool de worktrees con fencing

## Estado

Aceptado.

## Contexto

El primer corte de Native Fast Indexing enumeraba archivos desde el working
tree con Ripgrep, pero extraía exports desde `HEAD` con `git grep`. Esa mezcla
podía producir snapshots internamente incoherentes y guardarlos bajo una clave
que sólo identificaba el commit. Además exponía `FastRepositoryIndex` en
paralelo al `RepositoryIndex` canónico.

El primer `WorktreePool` protegía slots sólo con estado en memoria. Dos procesos
podían inicializar o entregar el mismo path, `git clean -fd` conservaba residuos
ignorados, y un fallo de saneamiento no tenía un estado durable de quarantine.
El pool tampoco era la implementación productiva usada por
`ExecutionBaseBuilder`.

## Decisión

### Índice de repositorio

- `RepositorySnapshot.baseCommit` identifica el contenido exacto del snapshot.
- Un índice cacheado por commit nunca incluye cambios staged, unstaged,
  untracked o ignored del working tree.
- El indexador rápido implementa el port `RepositoryIndexer` y produce
  `RepositoryIndex`; no existe otra representación pública del repositorio.
- Ripgrep enumera una vista limpia del commit exacto usando salida delimitada
  por NUL. Los mismos bytes enumerados alimentan el extractor AST de
  TypeScript.
- La caché sigue direccionada por
  `.manyhands/cache/index-<baseCommit>.json`, pero su envelope incluye versión,
  perfil y checksum. Es reconstruible, no autoridad del dominio.
- `cacheHit` y timings son telemetría y no forman parte del snapshot
  determinista.
- Un snapshot del working tree es un modo distinto, efímero y direccionado por
  un fingerprint de workspace. No puede reutilizar la clave de un commit.

### Pool de worktrees

- `ExecutionBaseBuilder` depende de un port `ExecutionWorkspaceProvider`.
  `WorktreeManager` y `WorktreePool` son adapters de ese port.
- Cada slot tiene una lease durable con token aleatorio y generación monótona.
  Todo reset, clean, entrega, release, takeover y eliminación verifica fencing.
- Una lease vencida sólo permite reutilizar el mismo path cuando el proceso
  dueño ya no existe. El token impide publicar tarde, pero no puede impedir que
  un proceso pausado reanude escrituras físicas.
- `git worktree add/remove/prune` se ejecuta bajo una lease de mutación del
  repositorio; dos slots ya creados pueden ejecutar trabajo en paralelo.
- El estado físico sigue
  `available → preparing → leased → sanitizing → available`; cualquier fallo de
  preparación o limpieza lleva el slot a `quarantined` antes de recrearlo.
- El saneamiento ejecuta `git reset --hard <baseCommit>` y `git clean -fd`, y
  elimina además residuos ignorados no administrados con `git clean -fdx`.
  El pool no enlaza `node_modules` ni otros árboles externos dentro del slot.
  No se preservan paths ignorados entre leases.
- Un commit candidato debe quedar anclado por una ref durable e inmutable antes
  de reciclar su slot. El mismo attempt sólo puede volver a publicar el mismo
  SHA; una ref existente nunca se sobrescribe con otro candidato.
- El estado de control vive fuera del worktree, asociado a la identidad física
  del repositorio. Los paths reutilizan las reglas de segmentos seguros y
  presupuesto de longitud de `WorktreeManager`.
- Recovery adopta sólo slots cuyo worktree, metadata y lease puedan validarse.
  Los residuos ambiguos se ponen en quarantine; nunca se entregan.

## Presupuestos de rendimiento

- Indexación cold de 300 archivos fuente: p95 menor a 750 ms en el workstation
  Windows de referencia. Es un presupuesto de regresión, no un SLA portable.
- Cache hit desde disco: p95 menor a 25 ms.
- El lookup de la clave por commit es O(1); deserializar un payload de tamaño N
  sigue siendo O(N).
- Reciclar un slot no ejecuta `git worktree add/remove` en el camino normal.

## Alternativas

- **Cachear el working tree bajo HEAD:** descartada porque la clave no describe
  el contenido.
- **Mantener un DTO rápido paralelo:** descartada porque obliga a adapters y
  permite divergencia semántica.
- **Usar solamente locks en memoria:** descartada porque no protege reinicios,
  múltiples procesos ni takeovers.
- **Enlazar dependencias del checkout fuente:** descartada porque un junction o
  symlink convierte el cleanup recursivo en una operación peligrosa y permite
  que un intento modifique dependencias compartidas.

## Consecuencias

- Grounding necesita una vista exacta del commit cuando el checkout principal
  está dirty.
- La integración productiva requiere cambios pequeños en los composition roots
  de web y execution core.
- El pool mantiene metadata durable y pruebas cross-process adicionales.
- La caché y los slots pueden reconstruirse después de corrupción sin cambiar
  la autoridad del run, los attempts ni los artifacts.
