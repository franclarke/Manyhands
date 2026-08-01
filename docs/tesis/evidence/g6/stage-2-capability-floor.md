# G6 — Etapa 2: chequeo de piso de capacidad

Fecha: 2026-08-01

## Resultado

El piso de capacidad quedó superado con la escalada única declarada en el
pre-registro: `codex-cli / gpt-5.4-mini / medium`. La primera selección
`low` se preserva como diagnóstico pre-candidate y no se reintentó. La nueva
ejecución `medium` produjo un candidato y satisfizo 9/10 criterios externos,
incluyendo cuatro de los cinco criterios de tarea que el baseline no satisface.
Por lo tanto, G6 puede continuar con las cinco celdas restantes.

La escalada no cambió `minimumAdvantage`, la fórmula, el estímulo, los
criterios externos ni el oráculo. El refreeze correspondiente es
`d6c788c`.

## Celda low preservada

- Run: `b3941357-010c-452d-9959-7e61b48b52e7`.
- Selección: `codex-cli / gpt-5.4-mini / low`.
- Resultado: `failed`, sin `finalSha`, sin candidato y sin evaluador externo.
- Causa terminal del planner: `root: unit application-warehouse-service
  references unknown evidence path-4; root: candidate artifact-study-g6-script
  cannot consume its own output`.
- Evidencia: `runs/g6-01-T1-A-r1-codex-low/`.

Este resultado pre-candidate se conserva íntegramente. No se mezclan sus
errores con una medición de granularidad ni se lo cuenta como 0/10.

## Celda medium evaluada

- Run: `ce677946-dee3-494d-af62-20baecbd267f`.
- Selección: `codex-cli / gpt-5.4-mini / medium`.
- Lifecycle: `completed`.
- Candidato entregado y evaluado: `3d6cdb15964891ee512817217d7cdabf254a6933`.
- Base: `5da60192cc788032c59c7e7be27696ca0e0a30d7`.
- Evaluador: `runs/g6-01-T1-A-r1-codex-medium/external-verdict.json`.
- Resultado externo: 9/10.
- Ejecución interna: una hoja, una reparación, `repairPasses=0`; métrica de
  granularidad en `run.granularity-metrics.json`.

| Criterio | Resultado |
|---|---|
| `gate-install` | satisfecho |
| `gate-test` | satisfecho |
| `gate-typecheck` | satisfecho |
| `gate-build` | satisfecho |
| `integrity-baseline-tests` | satisfecho |
| `behaviour-express-first` | satisfecho |
| `behaviour-backorder-recorded` | no satisfecho |
| `behaviour-invalid-priority-rejected` | satisfecho |
| `probe-single-json` | satisfecho |
| `probe-deterministic` | satisfecho |

El criterio de tarea que falló fue `behaviour-backorder-recorded`: el
evaluador observó que `listBackorders` devolvió una estructura con el order
completo en vez de la lista de backorders esperada. Esto es un resultado
adverso del candidato y se reporta sin reinterpretarlo.

## Consumo registrado

El journal registra `tokensTotal=146202` con fuente `reported` para el intento
que produjo el candidato. También registra una invocación de candidato, una
hoja y cero reparaciones. El intervalo del run fue
`2026-08-01T05:18:49.516Z`–`2026-08-01T05:37:40.281Z` (18m 50.765s).

El runtime no emitió `tokensIn`, `tokensOut` ni `costUsd`; por eso el costo en
dólares no se inventa ni se declara medido. No hay evidencia en el journal de
que se haya alcanzado el tope de USD 8 de esta celda ni el tope de tokens de la
serie, pero la verificación monetaria queda limitada por ese campo ausente.

## Archivos preservados

La carpeta `runs/g6-01-T1-A-r1-codex-low/` contiene el fallo pre-candidate,
su journal, snapshot, resultado y log. La carpeta
`runs/g6-01-T1-A-r1-codex-medium/` contiene el journal, snapshot, resultado,
diff, métrica de granularidad, log del driver y veredicto externo.

## Qué no se concluye

- No se concluye que la condición A sea superior o inferior a B o C: todavía
  no se ejecutaron las cinco celdas restantes.
- No se concluye que la hipótesis de granularidad esté confirmada por un único
  run.
- No se concluye que el candidato sea correcto en el criterio de backorders:
  el evaluador lo marcó como fallido.
- No se concluye un costo monetario exacto porque el journal no lo registró.
- El fallo `low` no se interpreta como evidencia de una condición G6 ni se
  usa para falsar o confirmar la hipótesis.
