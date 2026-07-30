# Qué hace implementable a una hoja

Análisis derivado de los journals preservados con
`docs/tesis/evidence/scripts/derive-leaf-outcomes.mjs`. Ninguna cifra de este
documento fue transcrita a mano: todas salen de `summary.json`, que el script
reescribe en cada corrida.

## Por qué existe

La política decide **si** dividir; el Architect propone **cómo**. El criterio
operativo para detenerse —«esta unidad ya es lo bastante chica y concreta para
que un agente la implemente»— se apoya en dos proxies: las rutas planificadas de
la unidad y el tamaño de su contrato de alcance. **Ninguno de los dos estaba
anclado contra resultados reales.**

Ya se sabía que el tope de rutas planificadas no discrimina: W1 entregó con diez
y W2 falló con seis. Esta tabla pregunta lo mismo sobre todo el corpus.

## Qué hay

| | |
|---|---:|
| Journals con intentos de hoja | 37 |
| Intentos de hoja con hecho de inicio | 84 |
| Candidato producido | 70 |
| Fallo clasificado | 10 |
| Sin hecho terminal | 4 |

Los cuatro sin hecho terminal son la clase que dejó celdas sin resultado
atribuible; se conservan en la tabla en vez de descartarse.

## Tamaño declarado contra resultado

Rutas permitidas en el contrato de alcance:

| Resultado | n | mín | mediana | máx |
|---|---:|---:|---:|---:|
| candidato | 70 | 2 | 5 | 17 |
| fallo | 10 | 1 | 15 | 19 |
| sin hecho terminal | 4 | 3 | 20 | 20 |

A primera vista separa. **No lo hace**, y la razón está en las causas.

## La separación se cae al mirar las causas

De los diez fallos:

| Clase | n | ¿podría explicarlo el tamaño de la unidad? |
|---|---:|---|
| infraestructura (pool de worktrees, `git worktree add`) | 3 | no |
| ejecutor salió sin causa reconocible | 2 | no |
| defecto de producto (diff vacío mal leído) | 1 | no |
| vencimiento de tiempo | 3 | sí |
| violación de alcance tras reparación | 1 | sí |

**Seis de los diez fallos le habrían ocurrido a una hoja de cualquier tamaño.**
Contarlos junto a los demás es lo que produce la separación aparente: las hojas
de alcance grande vienen del repositorio Warehouse y las chicas del repositorio
del caso canónico, de modo que la diferencia de medianas mide de qué serie viene
la hoja, no cuán implementable era.

De los cuatro fallos que sí admiten una lectura por tamaño:

- los tres vencimientos de tiempo ocurrieron con alcances de **3, 15 y 18**
  rutas: cubren casi todo el rango observado;
- la única violación de alcance ocurrió con un alcance de **1** ruta —la hoja más
  chica del corpus—, en una condición de división fina forzada que había dedicado
  una hoja entera a pruebas.

## Qué se concluye

**Ningún proxy de tamaño de hoja separa entrega de fallo en el corpus
preservado.** El tope de rutas planificadas y el tamaño del contrato de alcance
siguen sin anclar, ahora con datos y no sólo por afirmación.

Y el único fallo genuinamente atribuible a la granularidad ocurrió en la unidad
**más chica**, no en la más grande. Es coherente con el resultado negativo
central de este trabajo: una división más fina no produce unidades más fáciles,
produce unidades incoherentes cuando el corte no es semántico.

## Qué no se concluye

- **No se concluye que el tamaño sea irrelevante.** Se concluye que estos datos
  no lo separan, que es distinto.
- No se concluye nada por inferencia. Las 84 filas provienen de series con
  estímulos, ejecutores, repositorios y versiones distintas; el corpus no
  controla ninguna de esas variables y no admite un contraste estadístico.
- Los 70 candidatos fueron todos validados como `verified`, así que la tabla no
  distingue calidad entre candidatos: distingue producir un candidato de no
  producirlo.
- No se propone un valor nuevo para el tope. Elegir uno con estos datos sería
  ajustar un umbral a una observación, que es exactamente lo que este trabajo se
  prohibió.
