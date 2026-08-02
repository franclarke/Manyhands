# Etapa 10 — Reviews independientes

Fecha: 2026-08-02
Delta revisado: `4f64258..HEAD`
Alcance: revisión read-only de estándares y revisión read-only de conformidad
con `GOAL-PLAN.md` y `g6-preregistration.md`. Ningún reviewer implementó
cambios durante la inspección.

## Review A — Standards

### P1 físico: auditoría fail-open

La implementación anterior podía conservar un diff vacío cuando fallaba
`revParse` o `diffRange` y luego permitir una reparación. Se corrigió con
TDD:

- `packages/execution-core/src/integration/agent.ts` ahora aborta el
  cherry-pick y devuelve `internal_error` cuando no puede materializar el diff
  físico de un hijo sintético.
- `packages/execution-core/src/v2/node-executor.ts` rechaza la reparación si
  no puede leer el diff de un artifact consumido; ya no entrega un texto
  sentinela al agente.
- Las regresiones están en
  `tests/execution-core-integration.test.ts` y
  `tests/execution-core-v2-node-executor.test.ts`.

La prueba roja inicial observó `executor_repair_success` y una llamada al
agente con el diff ausente. Después del fix, los tests dirigidos pasan `70/70`.

### P2 físico: cambios eliminados

La auditoría comparaba sólo líneas agregadas. Se amplió a todas las líneas
cambiadas no vacías —adiciones y eliminaciones— en `agent.ts`,
`node-executor.ts` e `integration/manifest.ts`. La regresión de una reparación
que elimina una línea del hijo queda en
`tests/execution-core-v2-node-executor.test.ts`.

### P1 de reproducibilidad

El derivador dependía de raw runs locales no versionados. Se agregó la
instantánea mínima versionada en `g6/canonical-runs/`, con hashes SHA-256 de
bytes sin normalización en `canonical-runs/manifest.json`. El derivador usa esa
instantánea por defecto y conserva `--runs` para auditorías alternativas.

La prueba `derive-g6-results.test.mjs` valida que la instantánea produce las
seis celdas y las seis coberturas canónicas. Una derivación independiente
confirmó igualdad byte a byte de los cuatro outputs versionados.

### Higiene

`git diff --check HEAD` pasa para el delta de esta etapa. El delta histórico
completo `4f64258..HEAD` contiene whitespace final en documentos y patches
agregados por commits anteriores; no se reescribió esa historia ni se tocaron
los raw artifacts para corregirlo.

## Review B — Spec/G6

Pasan las siguientes comprobaciones:

- `minimumAdvantage = 0.15` permanece intacto.
- La fórmula `splitAdvantage = benefit - cost` y el estímulo no fueron
  modificados.
- El oracle externo y los diez criterios G6 no fueron modificados.
- El cambio en `warehouse/wide-graph/oracle-freeze-v2.json` pertenece al
  estudio Warehouse ancho y no al oracle G6.
- `results.csv` coincide con los seis veredictos externos/oracle de las filas
  canónicas.
- `verdict.md` deriva sus números de `results.md` y aplica el veredicto
  inconcluso preregistrado: A supera a C en r1 y empata en r2.
- Los intentos pre-candidate, `waiting_for_input`, de lanzamiento y
  planning-only siguen preservados en `g6/runs/`; no se convierten en cero.
- `freeze.json` explicita que sus hashes son hashes SHA-256 de bytes de los
  descriptores congelados, mientras `canonical-runs/manifest.json` identifica
  por separado los hashes de los manifests de ejecución usados para derivar
  resultados.
- No hay p-valores ni inferencia estadística en los resultados ni el
  veredicto.

## Hallazgo histórico abierto

El delta revisado contiene los commits `a430a57` y `1a68d48`, que modificaron
`docs/tesis/main.tex` y `docs/tesis/presentacion.tex`. Esto viola la regla
operativa actual de no tocar la tesis. No se revierte ni edita aquí: esos
commits son históricos, y revertirlos sería una mutación destructiva sobre
cambios existentes y no resolvería un defecto de la evidencia G6. Queda como
limitación declarada para la conformidad estricta del delta; desde el inicio
de esta ejecución no se tocaron esos archivos.

## Verificación de la etapa

| Verificación | Resultado |
|---|---|
| `pnpm build` antes de tests | PASS |
| Tests físicos dirigidos | PASS — 70/70 |
| Derivador TDD | PASS — 2/2 |
| Hashes de `canonical-runs/manifest.json` | PASS |
| Outputs derivados desde snapshot vs. outputs versionados | PASS — 4/4 iguales |
| Cambios de protocolo G6 | PASS — ninguno detectado |

## Qué no se concluye

- No se concluye conformidad histórica estricta del delta completo porque
  `main.tex` y `presentacion.tex` fueron modificados por commits anteriores.
- No se concluye que la instantánea canónica sustituya journals, patches,
  worktrees o raw runs; sólo hace reproducible la derivación agregada.
- No se concluye que una auditoría de líneas cambiadas pruebe equivalencia
  semántica completa: prueba retención física de las líneas no vacías del
  patch.
- No se concluye PASS científico de H-G6; el veredicto de la etapa 9 permanece
  inconcluso.
