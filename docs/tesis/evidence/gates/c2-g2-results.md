# C-G2 — ruta productiva, replay y estabilidad

> **Fecha:** 2026-07-24/25 · **Commit ejecutado:** `5584602` · **Resultado:** PASS.

## Checks de implementación

| Check | Resultado |
|---|---|
| tests enfocados | PASS — 50 tests |
| `pnpm test` | PASS — 199 files, 1153 tests, 2 skips declarados |
| typecheck de 12 packages | PASS |
| typecheck web | PASS |
| `pnpm build` | PASS |
| `pnpm web:build` | PASS — Next.js production build |
| marker C2 en `dist/index.js` | PASS |
| `git diff --check` | PASS |

Los skips no corresponden a C: son gates condicionados por entorno ya
declarados por la suite. Entre el commit de código verificado `cf6db65` y el
commit ejecutado `5584602` sólo se incorporaron documentación y resultados de
preflight; el binario C no cambió.

## Runs productivos

| Run | Misma base | Lifecycle | Receipt | Matriz | Clon limpio |
|---|---:|---|---|---|---|
| `820d370e-b6fd-4f6e-bcd6-5c809494dd02` | sí | completed | confirmed | 5/5 satisfied | 9 tests + typecheck PASS |
| `4b7c75b8-8cb6-46c9-bca4-3a999ad18783` | sí | completed | confirmed | 5/5 satisfied | 10 tests + typecheck PASS |

Ambos targets partieron de
`1da878de6edd38cefb1ea4d8ceecdceea0bb6acc`, usaron el mismo objetivo,
configuración y modelo, y fueron ejecutados secuencialmente. No hubo eventos de
fallo ni reparación. Los journals completos, snapshots, diffs, métricas,
receipts y verificaciones externas están en `evidence/c2-stability/run-1` y
`run-2`.

## Decisión de granularidad

La planificación viva produjo candidate tree hashes diferentes, lo cual está
permitido por el gate. C evaluó cuatro unidades en cada repetición y eligió la
misma frontera observable: una hoja. Para el composite raíz, la ventaja de
dividir fue negativa (`-0.2005` y `-0.2271`) frente al mínimo `0.15`. La
explicación persistida identifica beneficio, costo, rasgos, evidencia y razón de
descarte.

## Disposición

C-G2 es PASS: la ruta productiva entrega, valida, persiste y reproduce la
decisión C en dos ejecuciones reales verificadas. El gate no se interpreta como
ventaja comparativa; esa afirmación exige Warehouse Final y el protocolo A/B/C.
