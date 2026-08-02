# G6 rem26 — auditoría de resultado adverso externo

Fecha: 2026-08-02
Celda: `g6-03-T1-B-r1`
Planning-only: `12fd7eb7-a958-451c-a308-ca16ee8a750e`
Full: `c7e47c17-c57d-41c4-a4a2-0e65857c929e`

## Investigación

La planificación compiló correctamente y el breakdown registró literalmente
que `Backorder` lleva `orderId`, `skuId` y `missing` positivo. La ejecución
produjo un candidate que pasó tests, typecheck, build y la matriz interna. El
evaluador externo, ejecutado sobre el SHA exacto entregado, encontró que
`listBackorders` devolvía `{ orderId, lines, priority }` en vez de una entrada
por línea con `{ orderId, skuId, missing }`.

La evidencia del candidate muestra además que su test local afirmó esa forma
incorrecta. Es decir, el agente creó una implementación y una regresión
internamente consistentes pero incompatibles con el contrato congelado. La
causa no es una referencia de repositorio faltante, un timeout, un problema de
delivery ni una relajación del oráculo.

## Decisión

Se clasifica como **fallo genuino de la condición** según GOAL-PLAN: el plan
compiló, la ejecución corrió y el resultado no satisfizo un criterio externo.
Se preservan el candidate, el diff, el journal, el resultado y el veredicto
9/10. No se modifica el candidate ni se repite la misma invocación para
transformar el resultado.

Los fallos pre-candidate anteriores de esta misma remediación quedaron
separados y preservados: rem24 documentó el timeout del API y rem25 la
referencia de evidencia omitida. Sus arreglos fueron verificados antes de
rem26; rem26 demuestra que el camino operacional ya puede completar una celda.

## Qué no se concluye

- No se concluye PASS de la celda: el resultado externo es 9/10.
- No se concluye que la hipótesis H-G6 esté confirmada o falsada.
- No se concluye que cambiar el oráculo, el estímulo, `minimumAdvantage` o la
  fórmula sea necesario o admisible.
- No se concluye que una corrección manual del candidate represente evidencia
  del agente; cualquier mejora posterior tendría que ser una nueva corrida
  separada y preservada.
