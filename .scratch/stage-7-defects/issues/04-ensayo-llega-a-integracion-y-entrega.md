# 04 — Un ensayo llega a integración y entrega

**What to build:** evidencia de que el pipeline funciona más allá de las hojas.
Las tres pasadas del 2026-08-07 pararon antes, así que integración, candidato
final y entrega **no tienen ninguna observación**.

**Blocked by:** 01 — mientras el ejecutor herede la configuración del operador,
una hoja puede ser rechazada por un archivo que ManyHands nunca pidió, y el
ensayo vuelve a parar en el mismo lugar sin haber probado nada nuevo.

**Status:** closed

## Dónde paró cada pasada

| Pasada | Llegó hasta | Causa |
|---|---|---|
| 1 `1bb2b66b` | hoja 2 | artefacto vacío adoptado como verificado (corregido) |
| 2 `209c3e59` | hoja 1 | `MAX_PATH` al escribir el ref (ver 03) |
| 3 `dbb427ca` | hoja 2 | scope: archivo escrito por una skill del operador (ver 01) |

La hoja de dominio **sí** entregó verificado en la pasada 3, con su test
focalizado y dentro de su scope. Lo que no tiene evidencia es todo lo que viene
después de la segunda hoja.

## Qué tiene que establecer

No alcanza con «el run terminó». Cada punto es una afirmación que hoy nadie puede
sostener con un run persistido:

- [x] Las tres hojas producen candidatos verificados y sus artefactos se adoptan.
- [x] El composite de integración consume los tres artefactos hijos y produce un
      candidato raíz.
- [x] El candidato raíz se valida sobre su **commit exacto**.
- [x] La entrega deja el árbol validado donde el producto dice que lo deja.
- [x] El oráculo externo corre sobre el commit candidato exacto, con el
      procedimiento de §4.1.2 —worktree descartable, copia congelada del
      evaluador— y da un veredicto.
- [x] El instrumento de paralelismo lee las observaciones de un run que llegó
      hasta el final, no de uno truncado.

## Cierre verificado

El rehearsal `rehearsal-04w-v5` estableció el camino completo sin contar como
celda. Después, las dos celdas congeladas llegaron a `completed` y `delivered`:
`sp2-cell-01` y `sp2-cell-02`. Cada candidato fue validado sobre su SHA exacto,
el oráculo externo se ejecutó desde worktrees descartables y ambas celdas
produjeron las observaciones de paralelismo y entrega esperadas. La evidencia
está en [`sp2-result.json`](../sp2-result.json) y en los directorios de cada
run.

## Qué no es

**No es una celda.** Se declara ensayo y no se cuenta, pase lo que pase. Si el
oráculo da `PASS`, eso no es un resultado de la serie: es evidencia de que la
maquinaria llega hasta el final. Contar un ensayo como celda porque salió bien es
exactamente la forma de convertir una serie pre-registrada en una selección de
los runs que gustaron.

## Nota sobre el modelo

`haiku` produjo trabajo real en la pasada 3 —517k tokens de entrada, el cambio
más su test— después de no producir nada en la pasada 1 con 184k. Si vuelve a no
producir, eso **ya no queda oculto**: sale como `empty_diff` con su retry. Si
recurre, es un hallazgo sobre la capacidad del modelo y cambia la selección del
freeze, no un defecto del sistema. Distinguir las dos cosas es parte de este
ticket, y la evidencia es el journal, no la impresión.
