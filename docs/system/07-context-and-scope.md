# Contexto, grounding y scope

## Repository context

El contexto debe ser suficiente para resolver la tarea y pequeño para mantener
foco. Se construye desde el commit exacto de la execution base, no desde el
workspace mutable del usuario.

Fuentes:

- archivos y símbolos relacionados por índice;
- contratos consumidos/producidos;
- manifests de artifacts requeridos;
- convenciones y comandos del repo;
- tests cercanos y ejemplos internos;
- findings de intentos previos cuando es repair.

Cada context pack registra digest, paths y reglas de selección. Un agente puede
leer más dentro del worktree según política, pero la auditoría distingue contexto
provisto de contexto descubierto.

## ScopeContract

Categorías sugeridas:

- `implementationPaths`;
- `testPaths`;
- `configurationPaths`;
- `generatedPaths` no adoptables;
- `forbiddenPaths`.

Se soportan paths exactos y globs relativos normalizados. Deny wins. Symlinks,
path traversal y casing de Windows se resuelven antes de comparar.

## Políticas de enforcement

`forbiddenPaths` es un deny duro: un cambio que toca un path prohibido siempre
produce `scope_violation` y nunca se commitea, en cualquier política.

Para paths fuera del allow-list pero no prohibidos, la política efectiva decide
la disposición:

| Política | Disposición de un cambio fuera de scope |
|---|---|
| `strict` (default) | descarta el candidato (`scope_violation`, `disposition: failed`) |
| `gate` | retiene el candidato para decisión (`scope_gated`, `disposition: gated`) |
| `advisory` | commitea y registra el cambio en `scopeCheck.outOfScope` |

El default es `strict`: el scope es un límite de adopción y, sin una política
explícita, un cambio fuera de scope no se adopta. `advisory` existe para casos
donde el allow-list es una conjetura del planner y una glob errada no debe hacer
fallar el run, pero debe elegirse deliberadamente, no heredarse por omisión.

## Scope y vertical slices

Una hoja vertical puede tocar UI, API y tests. El scope debe reflejar la unidad
cohesiva en vez de prohibirla por pertenecer a capas distintas. Si el conjunto
es demasiado amplio o colisiona con siblings, el compiler debe descomponer o
serializar.

## Descubrimientos

Si el agente necesita un archivo/artifact fuera del contrato:

- puede leerlo si la política lo permite;
- no puede adoptar cambios fuera de scope;
- debe registrar `dependency_discovered` con evidencia;
- el coordinator decide enmienda, ampliación de scope o descarte.

Una ampliación material de scope crea nueva contract revision e invalida el
fingerprint.

## Datos sensibles

El context pack aplica redacción y deny lists para secretos, `.env`, claves y
directorios internos. Los logs no deben persistir tokens. La validación de
secret scanning ocurre antes de adoptar y antes de entregar.
