# Repository model e índice estructural

## Responsabilidad

Proveer grounding versionado al planning, context packing, risk y validation
recipe compilation.

## Snapshot

Se identifica por repository target + commit/tree + index schema version. Incluye:

- workspaces/packages y manifests;
- archivos y kinds;
- símbolos, exports/imports y referencias;
- APIs, schemas, migrations y entrypoints;
- tests y relación aproximada con código;
- scripts y herramientas;
- ownership/boundaries inferidos con evidencia;
- warnings por parseo incompleto.

## Freshness

El índice nunca se reutiliza solo por path del workspace. Debe coincidir commit y
schema. Puede actualizarse incrementalmente, pero el digest final identifica el
snapshot usado por el run.

## Uso por componente

- Planner: límites y ejemplos del repo.
- Graph Compiler: scopes, seams y outputs plausibles.
- Context Packer: archivos/símbolos relevantes.
- Risk: overlap y relaciones físicas.
- Validator: comandos, tests y baseline.

## Lenguajes

TypeScript/JavaScript es la prioridad de producto. El modelo debe declarar
capability y cobertura; no fingir un índice estructural completo para lenguajes
sin parser. El fallback textual se etiqueta con confidence menor.

## Seguridad y performance

- respetar ignores y límites de tamaño;
- no indexar secrets;
- evitar ejecutar código para indexar;
- cache por digest con writes atómicos;
- findings parciales no bloquean salvo que afecten una frontera obligatoria.
