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
2. Aplica cada commit hijo con `git cherry-pick` en orden topológico.
3. Ejecuta `parentValidationCommands` si existen.
4. Registra un commit de integración.

## Repair Semántico

Cuando hay conflicto, Gemini recibe:

- goal y acceptance criteria del composite padre;
- `sharedInterface` canónico relevante;
- intención de cada hijo;
- diff y salida del cherry-pick;
- hallazgos pre-merge cuando existen.

El objetivo del repair no es reconciliar texto a ciegas, sino producir código que
honre el contrato del composite.

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
conflicto, resultado de repair y validación padre.

## Decisiones De Diseño

Cherry-pick mantiene commits individuales trazables y evita merge commits
ruidosos. El repair usa contexto semántico porque los conflictos relevantes en
este sistema suelen ser desacuerdos de contrato, no solo choques textuales.

