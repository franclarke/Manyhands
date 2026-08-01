# G6 · celda `g6-01-T1-A-r1`

Primera celda de G6, condición **A** (hoja única forzada), repetición 1. Es
además el chequeo de piso de capacidad declarado en el pre-registro.

## Resultado

**Entregada y verificada.**

| | |
|---|---|
| run | `5a5cb4e7-398d-4981-86db-391d68a524fe` |
| lifecycle | `completed` |
| SHA final | `cba28d817b3753ac8dea7d6975cbda8f093a5c6f` |
| receipt | `delivery:5a5cb4e7…:delivery`, manifest `final-cefedb76b1912a1c` |
| **criterios externos** | **10/10** |
| duración | 03:01:07 → 03:14:52 = **13,7 min** |
| intentos de planning | 1 |
| hojas ejecutadas | 1 |
| reparaciones | 0 |
| consumo | 6.375.736 tokens · **USD 3,01** |

El veredicto externo está en `external-verdict.json`, producido por
`run-g6-evaluator.mjs` sobre un clon limpio del SHA exacto: los cuatro gates del
repositorio, la integridad de los tests del baseline, las tres capacidades
ejercitadas **importando** los módulos entregados, y los dos criterios del probe.

## Chequeo de piso de capacidad: superado

El pre-registro declaró que si esta celda no satisfacía **ningún** criterio
externo, G6 se declararía no informativo sobre granularidad. Satisfizo los diez.
El ejecutor alcanza el objetivo, así que la serie mide lo que se propuso medir.

## Qué no se concluye

- **Una celda no es una comparación.** Esto no dice nada todavía sobre la
  política de granularidad: es el punto de partida contra el que se van a leer
  las condiciones B y C.
- No se concluye que la condición A sea mejor. Se concluye que **es viable** en
  este régimen, que es distinto y es lo que el chequeo de piso preguntaba.
- La validación interna aceptó nueve criterios respaldados por **un solo archivo
  de test**, porque es el único path de test que el planner declaró. El binding
  lo registra como evidencia compartida en vez de disimularlo, pero es evidencia
  débil y conviene no leerla como nueve pruebas independientes. Los criterios
  externos, que son los que miden el estudio, no dependen de eso.

## Historia previa preservada

`runs/discarded-c52f823e/` conserva la primera corrida de esta misma celda, que
quedó `not_attributable`: el compilador de contratos no vinculaba evidencia a una
unidad con varios criterios, de modo que la condición A no podía entregar nunca.
Su candidato ya satisfacía los diez criterios externos, y esa medición se
conserva ahí como diagnóstico.

`runs/clarify-check/` conserva el chequeo planning-only que expuso una ambigüedad
del enunciado, y `runs/binding-check/` el que confirmó el arreglo del compilador
antes de gastar una celda entera.
