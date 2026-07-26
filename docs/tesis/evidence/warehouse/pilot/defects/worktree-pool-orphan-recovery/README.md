# El pool ocultaba un saneamiento incompleto como fallo de código

Clasificación: **defecto productivo de recuperación de infraestructura**.

## Observación

El segundo reintento de W2 de `series-12` (run
`69d2e719-150c-4dc3-a4bc-a65fac202e48`) no llegó a ejecutar su única hoja. El
journal registra que, durante la inicialización del pool, `git worktree add`
rechazó el path:

```text
fatal: '.../worktree-pool/1ef32c5c37a6/slot-000' already exists
```

El evento siguiente lo clasificó como `code_test` con `execution_failed`, lo
que propuso `repair_code` y una decisión `resolve_conflict`. No era una falla de
la hoja ni una decisión que sus opciones pre-registradas pudieran resolver.

## Causa verificable

El pool validaba el slot antes de recrearlo, pero para un slot inválido ignoraba
los errores de `git worktree remove`, de borrado recursivo y de `git worktree
prune`, y continuaba inmediatamente con `git worktree add`. Por lo tanto, un
borrado que no terminara dejaba como único diagnóstico durable el rechazo final
de Git, sin conservar el error de saneamiento que lo precedió.

La corrección cambia esa frontera: el borrado recursivo reintenta errores
transitorios de Windows, verifica que el path haya desaparecido y, si no puede
recuperarlo, aborta con el código explícito
`worktree_pool_unavailable`. Ese código se clasifica como
`shared_infrastructure`, cuya política no intenta reparar ni replanificar la
hoja. También cubre un fallo al recrear un slot ya saneado.

## Corrección TDD

- Rojo: un slot físico inválido cuyo borrado devuelve `EPERM` permitía que la
  inicialización continuara como si estuviera saneado.
- Verde: el pool rechaza ese slot antes de `git worktree add`, conserva la causa
  como infraestructura y no lo entrega al executor.
- Rojo: el prefijo de infraestructura se reducía a `execution_failed` y caía en
  `code_test`.
- Verde: `worktree_pool_unavailable` se preserva en la observación y queda en
  `shared_infrastructure`.

Verificación focal: 19 tests PASS en `worktree-recycling-pool` y
`execution-failure-cause-classification`, más los tres typechecks afectados.

## Reintento productivo

`series-14`, run `1543736b-7644-4455-9a44-648e94acd03f`, alcanzó planning,
aprobó el grafo y persistió la decisión de granularidad antes de intentar la
hoja. El pool rechazó el mismo `slot-000` como
`worktree_pool_unavailable`; el journal lo clasificó como
`shared_infrastructure` con `automaticRetryBudget: 0`. Por lo tanto la
reclasificación ya está observada en la ruta productiva, pero el slot físico no
quedó saneado por el proceso automático.

## Qué no se concluye

El journal de W2 no preservó el `errno` ni el proceso que impidió el borrado de
`slot-000`. Por eso no se concluye que un handle, permiso o proceso particular
de Windows haya sido la causa material del residuo. Sí se concluye que la ruta
productiva ocultaba cualquier fallo de saneamiento y lo reclasificaba como un
defecto de código, que es suficiente para corregir la recuperación y la
clasificación.
