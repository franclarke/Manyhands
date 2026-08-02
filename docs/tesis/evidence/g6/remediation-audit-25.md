# G6 rem25 — auditoría de fallo pre-candidate y remediación

Fecha: 2026-08-02
Celda: `g6-03-T1-B-r1`
Planning-only run: `4d613305-b9ba-476b-a0e1-08353c2f9a0f`
Full run: `fa6b0e73-de95-4e35-9f63-5429e743b59f`

## Resultado observado

La corrida stop-after planning terminó con un breakdown válido y sin pedir
aclaraciones. La corrida completa, usando la misma celda congelada, terminó
pre-candidate después de un único intento de planning. El journal registró:

`WorkBreakdown planning failed after 1 attempts: root: unit domain-order-priority-backorders references unknown evidence path-8`

No se ejecutó ninguna hoja, no hubo candidato, no hubo costo de ejecución ni
oracle. El resultado se conserva como `failed` y no se reintenta esa misma
invocación.

## Causa raíz

El snapshot canónico sí contenía la evidencia `path-8`, pero la respuesta del
modelo la usó en `evidenceIds` de una unidad y omitió la entrada correspondiente
de su propio array `repositoryEvidence`. El schema rechazó correctamente la
referencia interna inconsistente; el problema estaba en la serialización del
breakdown, no en la ausencia de ese path del repositorio.

La diferencia entre planning-only y full es una variación de la salida del
modelo: el primer documento incluyó todas sus definiciones y el segundo omitió
una definición usada. La regla de un intento por celda se respetó: rem25 queda
preservado y no se trata como una medición válida.

## Fix aplicado con TDD

Se agregó `restoreCanonicalEvidenceDefinitions` al planner. Antes de validar el
documento, la función:

- recoge todos los IDs referenciados en `evidenceIds`;
- agrega sólo las definiciones con el mismo ID presentes en el snapshot
  canónico;
- deja intactas las referencias no presentes, que siguen provocando rechazo
  del schema.

Así se corrige una omisión de serialización sin inventar grounding ni relajar
la validación de referencias desconocidas.

La regresión primero falló por la razón correcta: 1 test falló y 27 pasaron,
porque el planner no podía validar un documento que omitía `route-evidence`.
Después del fix:

- `pnpm build`: pasó en 233,4 s;
- `pnpm test -- tests/decomposer-work-breakdown.test.ts`: 28/28 pasaron.

El servidor debe reiniciarse con este build antes de la siguiente corrida. Los
runs rem24 y rem25 y todos sus journals permanecen intactos.

## Qué no se concluye

- No se concluye que rem25 haya producido un plan aceptable para medir G6.
- No se concluye nada sobre la capacidad de Codex para ejecutar hojas, porque
  rem25 no llegó a candidate.
- No se concluye que la hipótesis de granularidad haya sido confirmada o
  falsada por rem25.
- No se concluye que la reparación resuelva otros errores de planning; las
  referencias inexistentes seguirán fallando y toda nueva celda debe demostrar
  el comportamiento en el camino real.
