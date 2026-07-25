# Planning repair feedback buried the actionable issue

Clasificación: **defecto productivo de diagnosticabilidad en planning**.

## Observación

W1 de `series-4` (run `e66585be-747a-4c68-96f2-b4b6dc479904`, executor Claude
Code `sonnet`) agotó sus tres intentos de planning sin emitir un candidate. El
primer intento lo rechazó correctamente la regla de fidelidad contractual. Los
dos siguientes fallaron con un `reason` que repetía cuatro veces el mismo bloque

    schemaVersion: Invalid literal value, expected 2; breakdownId: Required;
    ... root: Unrecognized key(s) in object: 'type', 'unit'

y cerraba con una única causa real y distinta:

    candidateSeams.1.consumerUnitKeys: Array must contain at least 1 element(s)

## Causa

Son dos defectos superpuestos.

1. **Clasificación de la salida del modelo.** `normalizeModelOutputs` separaba
   envelopes de progreso de documentos preguntando si el envelope validaba
   *completo* contra `WorkBreakdownProgressLineSchema`, que es `.strict()` y
   exige `siblingIndex`/`siblingCount`. Un envelope imperfecto caía entre los
   candidatos a documento. Cuando algún documento validaba esto era inocuo —hay
   un test previo que lo cubre—, pero cuando ninguno validaba sus errores de
   esquema se reportaban junto al real. El modelo recibía como feedback de
   reparación cuatro copias de un error sobre un objeto que nunca pretendió ser
   un WorkBreakdown, y una sola línea sobre lo que de verdad debía corregir.

2. **La restricción violada estaba enunciada de forma blanda.** El prompt pedía
   que productor y consumidores fueran "explícitos", cosa que un array vacío
   satisface formalmente, mientras el esquema exige `.min(1)`.

Ninguno de los dos es específico de Claude Code. El primero es una asimetría
entre cómo se clasifica y cómo se reporta; el segundo, una diferencia entre lo
que el prompt pide y lo que el esquema acepta.

## Corrección TDD

- Rojo: un envelope `planning.node` sin `siblingCount`, con `siblingIndex`
  fuera de rango, con un campo extra, o sin `unit`, más el caso en que el modelo
  sólo emite progreso y ningún documento.
- Verde: `type` es el discriminador. Un envelope `planning.node` nunca es un
  documento, sin importar qué tan malformado esté su `unit`, así que sus errores
  no entran nunca al feedback de reparación. Cuando sólo hubo progreso, el error
  vuelve a ser "no complete WorkBreakdown JSON".
- El prompt declara ahora que todo artifact y seam candidato debe nombrar al
  menos un consumer unit key, y que un candidato sin consumidor se omite en vez
  de emitirse con el array vacío.
- Verificación: 23 tests de WorkBreakdown y 38 del grupo de planning PASS;
  typecheck de `decomposer` PASS.

No se adoptó ninguna entrega: W1 no produjo commit. El resultado acumulado del
piloto sigue siendo **0/8 incrementos verificados**.
