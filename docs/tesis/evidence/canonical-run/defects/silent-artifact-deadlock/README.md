# Defecto: deadlock silencioso por artefacto declarado no adoptado

> **Run:** `0c0f066a-1795-4ea4-9ded-fdddc207a7fe` (2026-07-24, serie G4)
> **Estado alcanzado:** `running`, sin avance, sin fallo y sin decisión.
> **Corrección:** commit `c227205`.

## Qué se observó

El grafo compilado tuvo cuatro nodos: la raíz y tres hojas. La primera hoja
(`domain-category-totals:web-category-breakdown`) ejecutó, validó y adoptó su
artefacto. Inmediatamente después:

```
10:44:34 validation.completed   ... outcome verified
10:44:34 artifact.adopted       ... artifact-contract-domain-...-ou-0deb9a97c0
10:44:34 readiness.observed     {"readyNodeIds": [], "pendingDecisionIds": []}
```

Y nada más. Las dos hojas restantes nunca se volvieron elegibles, la raíz nunca
integró, y **no se emitió ningún `attempt.failed`, ninguna `failure.classified`
ni ninguna `decision.raised`**. El run quedó indistinguible de uno que sigue
trabajando.

## Causa raíz

El planificador declaró un artefacto entre hermanos. El compilador lo convirtió
en un `ArtifactRequirement` de fase `execution`:

| Requisito (fase `execution`) | Contrato exigido |
|---|---|
| `domain-...` → `api-category-totals` | `artifact-contract-artifact-category-set-116f3342c1` |
| `domain-...` → `category-regression-tests` | `artifact-contract-artifact-category-set-116f3342c1` |

Pero al completarse, el nodo adoptaba **un solo** artefacto: el de su propio
resultado (`...-output`).

| Adoptado realmente | `artifact-contract-domain-category-totals:web-category-breakdown-ou-0deb9a97c0` |
|---|---|

Ningún evento satisfizo jamás `artifact-category-set`, de modo que sus
consumidores no pudieron volverse elegibles. La condición de readiness era
insatisfacible por construcción y el sistema no tenía forma de detectarlo.

## Por qué no había aparecido antes

Los runs canónicos anteriores produjeron grafos cuyos planificadores **no**
declararon artefactos entre hermanos: solo hubo restricciones de conflicto, que
sí se resuelven correctamente. El defecto estaba **latente, no ausente**, y
dependía de una decisión del planificador que varía entre ejecuciones.

Esto es en sí un dato sobre la evaluación: la variabilidad del planificador no
solo cambia la topología, también **cambia qué caminos del orquestador se
ejercitan**. Un solo run exitoso no cubre el espacio de grafos que el
planificador puede producir.

## Corrección

Un nodo adopta ahora **todos** los contratos de artefacto de los que es
productor, no solo el de su resultado. El candidato verificado es la evidencia
de todos ellos, así que comparten su digest y su ubicación.

Regresión previa al fix: `tests/execution-driver-produced-artifacts.test.ts`.
Falla exactamente por la causa correcta —solo se ejecutan `node-domain` y
`node-ui`; el consumidor y la raíz nunca corren— y pasa con la corrección.

## Consecuencia sobre el gate

Por tratarse de un **defecto sistémico**, la serie de G4 se reinició por
completo sobre el commit corregido, conforme al criterio del roadmap. Los runs
previos a `c227205` no cuentan para las dos ejecuciones válidas consecutivas.

## Limitación que este defecto deja expuesta

El orquestador **no detecta un requisito insatisfacible**. Hoy la única defensa
es el límite de reloj del driver externo. Una condición de readiness que ningún
evento futuro puede satisfacer debería clasificarse como fallo con su causa, no
esperar. Queda registrado como trabajo futuro; no se implementó aquí porque
excede la corrección del defecto observado.
