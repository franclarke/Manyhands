# El primer oráculo N=4 omitió instalar dependencias del clon externo

Clasificación: **defecto de instrumentación del oráculo externo**, no defecto
del candidato N=4 ni observación de rendimiento.

## Observación

Después de publicar `b7a8838b1db9fa136103e5024df38697072ad3c9`, el primer
intento del oráculo se hizo desde un clon externo limpio. Ejecutó
`pnpm typecheck` sin haber materializado dependencias y falló con:

```text
pnpm typecheck failed: "tsc" no se reconoce como un comando interno o externo
```

Ese fallo precede a test, build, las comprobaciones de independencia y la
sonda; por ello no es admisible como veredicto del producto. El run y la
entrega permanecen en
`../../../wide-graph/retry-2/runs/warehouse-wide-n04/`.

## Corrección y repetición

Rojo primero: `wide-graph-oracle-plan.test.ts` exigió que el plan del oráculo
iniciara con `pnpm install --frozen-lockfile`; falló al no existir ese plan.
Verde: el oráculo ahora ejecuta esa instalación antes de los gates y conserva
su resultado con `--out`.

La repetición se realizó sobre el mismo clon externo, fijado al mismo SHA de
entrega, sin modificar el candidato. El resultado bruto es PASS en
`../../../wide-graph/retry-2/runs/warehouse-wide-n04/oracle-result.json`.

## Qué no se concluye

No se concluye que el primer fallo revele una falla de TypeScript, del grafo,
de la entrega o de la política C. Tampoco se infiere una medida de rendimiento:
el proceso no alcanzó ningún gate de producto. Sólo se concluye que un oráculo
que valida un clon limpio debe instalar el lockfile congelado antes de ejecutar
los comandos declarados.
