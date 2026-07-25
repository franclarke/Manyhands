# Oracle contract underspecified

Clasificación: **defecto del instrumento Pilot**.

## Observación

El prompt W1 original exigía «schema 1, `stateHash`, `layout` e `inventory`»,
pero no publicaba la envoltura ni la forma escalar exactas. La entrega produjo
razonablemente `{ schema, phase, scenarioId, stateHash, layout, inventory }`;
el oráculo esperaba `{ schemaVersion, increment, scenario, stateHash,
capabilities }`. Aun si el package script hubiera existido, ambas interfaces
eran incompatibles.

## Causa

Parte del criterio de aceptación sólo existía en `oracle-core.mjs`. Eso convertía
los nombres y el anidamiento en conocimiento oculto del evaluador, no en un
requisito observable entregado al sistema bajo estudio.

## Corrección TDD

- Rojo: 8 regresiones exigieron que cada prompt declare la envoltura y todas las
  capacidades acumulativas con nombres exactos.
- Verde: W1–W8 publican campos, tipos, mínimos y booleanos requeridos; el
  protocolo declara que esa forma es parte del estímulo; los hashes de prompts
  quedaron actualizados en `assets-manifest.json`.
- Verificación: 18 tests de assets Warehouse PASS.

El oráculo no se debilitó y sus invariantes no cambiaron. La corrección elimina
ambigüedad entre prompt y oráculo antes de volver a ejecutar el Pilot.
