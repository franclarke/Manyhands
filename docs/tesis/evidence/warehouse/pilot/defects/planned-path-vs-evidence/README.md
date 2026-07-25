# Existing files declared as planned paths

Clasificación: **defecto de estímulo productivo (prompt del Planner)**.

## Observación

W1 de `series-5` (run `1f6965d7-cde8-481e-a524-9783c4d9736f`) produjo por primera
vez un WorkBreakdown completo: cinco `planning.node_discovered`, sin errores de
esquema y sin ruido de envelopes. El fix anterior funcionó.

Falló después, en la revisión del plan compilado:

    planned_path_already_exists: Planned path package.json already exists in the
    repository snapshot

El primer intento de ese mismo run había fallado antes con `No JSON object found
in response`, un modo distinto que no volvió a aparecer.

## Causa

El prompt trae dos reglas adyacentes sobre el mismo archivo:

- "Existing repository paths must be cited through path evidence. Files that a
  unit will create must be declared in plannedPaths."
- "If an outcome adds or changes a package script … cite the relevant package
  manifest path evidence … so that configuration is inside its executable
  scope."

La segunda regla existe por el defecto `validation-stub-command-surface`: sin
ella el `package.json` quedaba fuera de scope y la validación corría los stubs
del seed. Pero ninguna de las dos dice cuál es el criterio cuando el archivo
existe *y* el agente va a escribir en él. El modelo resolvió la ambigüedad por
intención —"voy a crear el script `study:probe`, luego creo `package.json`"— en
vez de por existencia, y el review lo rechazó correctamente.

## Corrección TDD

- Rojo: aserciones sobre el prompt del Planner por la regla ausente.
- Verde: el criterio se declara explícito — decide la existencia en el snapshot,
  no la intención de escritura. Un archivo que se modifica, extiende o reescribe
  ya existe y se cita como evidencia; `plannedPaths` es sólo para paths ausentes
  del snapshot. Se nombran `package.json`, `tsconfig` y lockfile como los casos
  concretos donde la confusión aparece.
- Verificación: 36 tests de planning PASS; typecheck de `decomposer` PASS;
  símbolo presente en `dist`.

No se adoptó ninguna entrega. Resultado acumulado del piloto: **0/8**.
