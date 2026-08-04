# G7 — Reporte final del experimento compacto

Fecha: 2026-08-03  
Estado: **PARTIAL / no apto para confirmar la hipótesis nueva**

## Veredicto ejecutivo

El experimento compacto no permite afirmar que la nueva política de granularidad
funciona. La celda principal T1-C no produjo un conjunto de candidatos viable:
los candidatos fueron rechazados por invariantes de ownership, seams y snapshot.
T2-C fue detenida por el límite de pared sin producir un artefacto evaluable; los
controles A/B no se ejecutaron. Por el veredicto pre-registrado, H1 y H2 quedan
en **FAIL** para G7.

Esto no invalida la evidencia previa de que ManyHands puede ejecutar y entregar
cambios: G6 tiene seis filas canónicas atribuibles, con cobertura externa de
7/10 a 9/10, y sus compuertas amplias pasaron. Sí significa que G7 no agrega
evidencia positiva sobre la política `adaptive-utility/3.1.0-pilot` y no debe
usarse para escribir que la política quedó validada.

## Protocolo congelado

| Elemento | Valor |
|---|---|
| Baseline Warehouse | `5da60192cc788032c59c7e7be27696ca0e0a30d7` |
| Runtime ManyHands | `6b339446efe8880c8e7c6380aeaa2243d139ff6d` |
| Política | `adaptive-utility/3.1.0-pilot` |
| Ejecutor/modelo | `codex-cli / gpt-5.4-mini` |
| Esfuerzo | `medium` |
| Candidatos por celda | 2 |
| Planning attempts / retries | 1 / 0 |
| Presupuesto | USD 8 por celda; USD 32 serie; 1M tokens |
| Preregistro | `docs/tesis/evidence/g7-preregistration.md` |

La configuración, prompts y hashes están en `manifest.json`. No se cambiaron
tareas, criterios ni umbrales después de observar los rechazos.

## Celdas y evidencia

| Celda | Resultado | Evidencia |
|---|---|---|
| G7-01 T1-C | **FAIL**: sin plan viable; lifecycle final `timeout` | `runs/g7-01-T1-C-closure/result.json`; run `4fdc41da-c6c1-4206-b5f0-2c84a53430df` |
| G7-02 T1-A | No ejecutada | protocolo detenido al aislar el fallo de C |
| G7-03 T2-C | No evaluable: detenida antes de persistir un run | `runs/g7-03-T2-C/` sin journal final |
| G7-04 T2-B | No ejecutada | protocolo detenido |

T1-C tuvo una corrida inicial fallida por infraestructura/timeout y luego
reintentos acotados para aislar causas del protocolo. Los runs se conservaron:

- `4a57d8ce-2785-45b5-92c8-323d98952942`: fallo de planning/CLI.
- `51ea1c3b-dd5d-4720-b67e-756cd368ee16`: wrapper corregido; el segundo
  candidato no cumplió el esquema.
- `82e23422-5926-4d67-b36e-e81bcfd8e77f`: mismo defecto estructural.
- `429c7825-c4f1-4f94-a2b2-20b4e8982c7c`: se detectó que el driver no pasaba
  `candidateCount`; se corrigió y se volvió a ejecutar.
- `7238db09-9331-4f41-9ad3-c656fc1e5b2c`: presupuesto de dos candidatos ya
  aplicado; cero planes viables.
- `277d8ed8-4bd4-4113-a5dc-2cd5e17dd45b`: el modelo puso el snapshot en
  `breakdown.root`; rechazo fail-closed.
- `4fdc41da-c6c1-4206-b5f0-2c84a53430df`: último intento; dos candidatos
  rechazados por los diagnósticos descritos abajo.

## Diagnóstico causal

El último journal `runs/g7-01-T1-C-closure/run.events.v2.jsonl` termina en
`planning.candidates_evaluated` con `replan_required`, no en ejecución. Los
rechazos fueron:

- hojas sin ownership local de aceptación;
- seams sin especificación completa de compatibilidad y validación;
- especificaciones de seams huérfanas, sin seam candidato;
- snapshot del candidato distinto del snapshot inspeccionado por un carácter;
- cero planes viables frente al mínimo contractual de dos.

Se corrigieron durante el diagnóstico tres defectos de protocolo/implementación:

1. el prompt ahora exige explícitamente el wrapper `CandidatePlan`;
2. el snapshot sólo puede aparecer en `breakdown.repositorySnapshotId`;
3. `candidateCount` viaja desde la celda hasta el planning envelope.

Después de esas correcciones el rechazo continuó por invariantes semánticos del
candidato generado. Por eso el resultado es un defecto observado de la ruta de
planning/política, no una razón para seguir reintentando el mismo estímulo.

## Hipótesis

### H1 — ManyHands funciona en este alcance

**G7: FAIL.** El preregistro exige que T1-C y T2-C terminen con SHA entregado y
oráculo externo satisfecho; ninguna de las dos produjo ese resultado.

**Evidencia global acotada:** G6 sí documenta capacidad funcional previa: seis
filas atribuibles, cobertura 0.7–0.9, y PASS en build, suite, typechecks y
web build. Esa evidencia sostiene la frase limitada “ManyHands funciona en el
alcance probado por G6”, no “G7 validó la nueva política”.

### H2 — La política elige granularidad adecuada

**G7: FAIL.** La decisión esperada no llegó a ser compilable: T1-C terminó en
`replan_required` antes de ejecutar; T2-C no dejó decisión observable.

No se puede concluir que la política divida correctamente T1 ni que conserve T2
como una unidad cohesiva.

## Gates finales del runtime aislado

| Gate | Resultado |
|---|---|
| `pnpm.exe build` | PASS |
| `pnpm.exe -r --filter "./packages/*" typecheck` | PASS, 12 paquetes |
| `pnpm.exe --filter @manyhands/web exec tsc --noEmit` | PASS |
| `pnpm.exe test` | FAIL: `tests/wide-graph-oracle-contract.test.ts`, hash de `dist` congelado no coincide |
| `pnpm.exe web:build` | FAIL: binding nativo opcional ausente en `@tailwindcss/oxide` |

El fallo del contrato congelado no se convirtió en PASS actualizando el oráculo
después del resultado. El fallo de `web:build` es ambiental/dependencias
opcionales y quedó separado de la evidencia del experimento.

## Conclusión para la tesis

El texto defendible hoy es: “ManyHands demostró capacidad de planificación,
ejecución y entrega en el estudio G6, pero el estudio G6 fue inconcluso sobre
superioridad de granularidad. El estudio compacto G7 encontró que la política
revisada todavía no genera candidatos semánticamente viables bajo sus propios
gates; por tanto, la hipótesis de una buena política de granularidad no queda
validada”.

Para poder cerrar con un veredicto positivo no hace falta una serie grande, pero
sí una última corrida corta después de resolver la causa raíz: el planner debe
producir metadatos de ownership/seams coherentes con el snapshot en ambos
candidatos, y T1-C/T2-C deben completar con sus oráculos congelados. No es
defendible declarar ese resultado antes de observarlo.

