# G6 — Veredicto pre-registrado

Fecha: 2026-08-02

## Metrica primaria

La tabla se transcribe de `results.md`, producido por el derivador versionado
de la etapa 8. La metrica es la proporcion de criterios externos satisfechos.

| Condicion | Repeticion 1 | Repeticion 2 | Media derivada |
|---|---:|---:|---:|
| A | 0.9 | 0.9 | 0.9 |
| B | 0.9 | 0.8 | 0.85 |
| C | 0.7 | 0.9 | 0.8 |

## Evaluacion de H-G6 y del falsador

En la repeticion 1, A supera a C (`0.9 > 0.7`). En la repeticion 2, A y C
empatan (`0.9 = 0.9`). La direccion no se mantiene en ambas repeticiones.

**Veredicto: inconclusa.**

H-G6 no queda sostenida porque C no alcanza a A ni a B en la primera
repeticion. Tampoco queda falsada por el falsador pre-registrado, porque A no
supera a C con la misma direccion en ambas repeticiones. La regla de
inconclusion se aplica sin agregar una tercera repeticion.

## Celdas no atribuibles

No hay celdas `not_attributable` entre las seis filas canónicas de `results.md`:
las seis tienen candidate entregado y veredicto externo u oracle atribuible.
Los intentos pre-candidate, de lanzamiento o de aclaracion preservados en
`runs/` siguen fuera de la metrica primaria y no se convierten en cero.

## Qué no se concluye

- Con dos observaciones por condicion no se hace inferencia estadistica ni se obtiene un p-valor.
- No se concluye que la granularidad cause la diferencia observada: G6 describe direccion, viabilidad y modos de falla.
- G6 no es comparable con G5 porque el ejecutor cambio; la serie G6 es homogenea internamente con Codex.
- No se concluye que A, B o C sea globalmente superior fuera de este estimulo, este oraculo y estas seis celdas.
- No se reinterpreta como cero ninguna corrida no atribuible ni se agrega una tercera repeticion.
