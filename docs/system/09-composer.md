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

## Interfaces

**Recibe:** composite, resultados de hijos, worktree de integración, interfaces
compartidas y comandos de validación.

**Produce:** `IntegrationResult` con estado, commit de integración, detalles de
conflicto, resultado de repair y validación padre.

## Decisiones De Diseño

Cherry-pick mantiene commits individuales trazables y evita merge commits
ruidosos. El repair usa contexto semántico porque los conflictos relevantes en
este sistema suelen ser desacuerdos de contrato, no solo choques textuales.

