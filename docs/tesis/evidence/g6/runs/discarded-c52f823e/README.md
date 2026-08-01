# G6 · celda `g6-01-T1-A-r1`

Primera celda de G6, condición **A** (hoja única forzada), repetición 1. Es
además el chequeo de piso de capacidad declarado en el pre-registro.

## Resultado terminal

**Sin entrega.** El run quedó parkeado en `waiting_for_input` con una decisión
`resolve_conflict` sin responder, y el driver cerró la celda conforme al
protocolo: una celda pre-registrada sólo responde la aprobación del plan y la de
entrega.

- run `c52f823e-2979-4869-b5ec-9963e05d05d0`
- razón registrada: `run parked on resolve_conflict`
- SHA final: ninguno
- **Cobertura de criterios externos sobre el árbol entregado: `null`** — no hubo
  árbol entregado que evaluar.

## Qué pasó, en orden

1. Tres intentos de planning; los dos primeros fallaron, el segundo por un corte
   del proveedor a mitad de stream. El tercero compiló.
2. La condición A colapsó a **una sola hoja** un árbol candidato que el Architect
   había propuesto con **siete hijos, uno por capa**. Razón registrada:
   `Condition A keeps the complete goal as one leaf`.
3. El agente ejecutó esa hoja única en **8 minutos** y produjo el candidato
   `9ee89688cb1a079499220ae8b368f252fc9b0bdf`.
4. La validación terminó `unverified` y se levantó la decisión. La celda parkeó.

## Por qué la validación no verificó

El contrato de validación compilado tiene **ocho obligaciones, todas con
`evidenceBinding: null`** y `acceptableEvidence: ["test_result"]`. Cada una quedó
`uncovered` con la justificación *"No acceptable evidence is linked to this
obligation"*.

La validación falla cerrada ante una obligación sin evidencia pertinente, que es
el comportamiento que el ticket 19 introdujo a propósito. Lo que falta es el otro
lado: **el compilador no produjo ni un solo binding**, de modo que ninguna
obligación podía cubrirse.

Esto **no es un fallo de la condición A**. Es anterior a la condición y le
ocurriría igual a B y a C: ninguna celda de G6 puede entregar mientras esté
presente. Por eso la celda se clasifica `not_attributable` según la regla ya
pre-registrada, y la serie se detiene en vez de gastar cinco celdas más en
reproducir el mismo bloqueo.

## Diagnóstico: qué hizo el agente

`candidate-verdict-diagnostic.json` evalúa el commit candidato con el evaluador
externo. **Satisface los diez criterios**: los cuatro gates del repositorio, la
integridad de los tests del baseline, las tres capacidades ejercitadas por
importación —orden express, faltante registrado, prioridad inválida rechazada— y
los dos del probe.

> **Este número no es el resultado de la celda.** La métrica pre-registrada se
> mide sobre el árbol **entregado**, y acá no hubo entrega. Se registra como
> diagnóstico, y separa dos cosas que conviene no confundir: el agente hizo el
> trabajo; el sistema no pudo acreditarlo.

## Un defecto del propio evaluador, encontrado acá

La primera corrida del diagnóstico dio 8/10: los dos criterios del probe fallaban
porque el evaluador invocaba `pnpm` sin `--silent`, y el eco del comando
contaminaba la salida capturada. El script entregado era correcto
(`node src/probe/g6.ts`).

Corregido, con una regresión que fija la razón. La primera corrida se conserva en
la historia de Git: **el instrumento tenía un defecto que sólo una celda real
podía exponer**, y por eso se midió una antes de comprometer las seis.
