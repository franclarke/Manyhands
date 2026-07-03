# IntegrationAgent (Composer)

**Archivos fuente:** `packages/execution-core/src/integration/agent.ts`

---

## Qué Es

El `IntegrationAgent`, también llamado Composer, integra los resultados de hojas
o subárboles hijos en el composite padre. Usa cherry-pick como mecanismo git y
repair semántico cuando aparece un conflicto.

## Responsabilidad

El Composer combina trabajo que fue producido en paralelo. Debe preservar
trazabilidad, evitar merge commits innecesarios, respetar contratos de interfaz
y fallar de forma explícita cuando no puede producir un resultado confiable.

## Camino Limpio

1. Verifica que los hijos requeridos tengan resultado exitoso.
2. Verifica que cada hijo exitoso tenga un commit alcanzable y único.
3. Aplica cada commit hijo con `git cherry-pick` en orden topológico.
4. Registra `appliedCommits` en el orden real de aplicación.
5. Ejecuta `parentValidationCommands` si existen, siempre sobre el worktree
   integrado.
6. Registra un commit de integración.

Un hijo `success` sin `commitSha`, un commit no alcanzable o un SHA duplicado
falla antes del cherry-pick. El resultado usa `failureCode` estable y
`omittedChildCommits` para que el parent no pueda parecer exitoso después de
omitir trabajo hijo.

## Repair Semántico

Cuando hay conflicto, el executor de repair recibe:

- goal y acceptance criteria del composite padre;
- `sharedInterface` canónico relevante;
- intención de cada hijo;
- diff y salida del cherry-pick;
- hallazgos pre-merge cuando existen.

El objetivo del repair no es reconciliar texto a ciegas, sino producir código que
honre el contrato del composite.

Cada pasada queda resumida en `repairAttempts` (`started`,
`syntax_rejected`, `committed` o `failed`). Si el repair produce un commit pero
la validación parent falla, la integración sigue fallando con
`failureCode: "validation_failed"`; el commit reparado queda en `appliedCommits`,
pero no convierte el parent en success.

## Gate Sintáctico

Después del repair, el sistema revisa marcadores de conflicto y parsea archivos
TS/JS reparados. Código malformado no se commitea. El error exacto puede
reinyectarse para una segunda pasada según la política vigente.

## Estados De Salida

- `success`
- `executor_repair_success`
- `executor_repair_failed`
- `validation_failed`
- `child_failed`
- `internal_error`
- `retry_pending` (tombstone transitorio: solo existe dentro del Command del
  conflict gate; el reducer lo consume borrando la entrada — nunca se persiste)

`status` se mantiene compatible para UI y reducers existentes. `failureCode`
agrega la razón estable y machine-readable:

- `child_failed`
- `missing_child_commit`
- `invalid_child_commit`
- `cherry_pick_conflict`
- `repair_failed`
- `validation_failed`
- `internal_error`

## Clasificación De Fallos y Retry

Un fallo de integración no manejado pausa el run en el conflict gate. Para que
el gate no mienta (un `npm` ausente no es "conflictos que el Composer no pudo
resolver"), `classifyIntegrationFailure` deriva una clase del resultado:

- `merge_conflict`: cherry-pick con conflicto o repair fallido;
- `infra`: `validation_failed` con exit 124/126/127 de la validación parent
  (timeout, comando rechazado, binario ausente) — falló el entorno, no el código;
- `code_validation`: `validation_failed` con cualquier otro exit;
- `internal`: `child_failed` / `internal_error`.

La clase viaja en el interrupt (`failureClass`, `validationExitCode`) y decide
el copy y el orden de opciones del gate. La acción `retry_integration` emite el
tombstone `retry_pending`: el reducer borra el resultado fallido, el composite
vuelve al frontier de integración y se re-integra (el `WorktreeManager` recrea
worktrees/branches que el intento fallido dejó atrás). Cada retry es una
decisión humana — un fallo persistente re-gatea, nunca loopea solo.

## Interfaces

**Recibe:** composite, resultados de hijos, worktree de integración, interfaces
compartidas y comandos de validación.

**Produce:** `IntegrationResult` con estado, commit de integración, detalles de
conflicto, resultado de repair, validación padre, `failureCode`,
`appliedCommits`, `omittedChildCommits`, `validationWorktreePath` y
`repairAttempts`.

El evento/traza `integration_completed` incluye la misma evidencia compacta de
commits aplicados/omitidos y attempts de repair. No es una transacción durable
separada del git commit, pero sí evita que el replay/auditoría vea un parent
como exitoso sin saber qué hijos entraron realmente.

## Decisiones De Diseño

Cherry-pick mantiene commits individuales trazables y evita merge commits
ruidosos. El repair usa contexto semántico porque los conflictos relevantes en
este sistema suelen ser desacuerdos de contrato, no solo choques textuales.

La validación de commits hijo ocurre antes de mutar el worktree de integración:
es preferible fallar temprano con evidencia (`missing_child_commit`,
`invalid_child_commit`) que abrir una secuencia de cherry-picks donde el parent
podría terminar con un subconjunto silencioso de hijos.

