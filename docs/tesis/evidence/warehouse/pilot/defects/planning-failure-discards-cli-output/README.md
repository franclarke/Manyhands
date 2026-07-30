# Un planning fallido no conserva lo que dijo el CLI

## Hecho observado

La celda N=16 de `retry-12-measure` (run `6e1e5ed3-cfb7-4d55-8fa9-0ee1d80ae473`)
falló sus tres intentos de planning con el mismo texto:

```
claude-code-cli planning failed with exit code 1
(envelopes=assistant,rate_limit_event,result,system; stdoutBytes=14685)
```

Eso es todo lo que quedó. El host de planning
(`apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`) construye su
diagnóstico con `formatPlanningCliDiagnostics`, que registra **los tipos de
envelope, la cantidad de bytes de stdout y una cola de stderr** — pero no el
contenido de stdout ni el texto del envelope `result`. Con stderr vacío, como
acá, la salida real del modelo se pierde.

Consecuencia concreta: el CLI produjo 14.685 bytes de respuesta y no se puede
decir qué dijo. La celda queda sin evaluación de granularidad y su fallo **no es
atribuible**.

## Lo que sí quedó descartado

`rate_limit_event` aparece entre los envelopes, pero **no indica throttling**. El
propio host lo documenta: una sonda directa mostró ese envelope también en
llamadas exitosas, y por eso la capacidad se decide por el texto del CLI y no por
el tipo de envelope. Además, una llamada directa al mismo modelo `haiku`, pocos
minutos después del fallo, respondió normalmente con exit `0`.

## Evidencia primaria

- `docs/tesis/evidence/warehouse/wide-graph/retry-12-measure/runtime-runs/6e1e5ed3-*.events.v2.jsonl`
- `docs/tesis/evidence/warehouse/wide-graph/retry-12-measure/runs/warehouse-wide-n16/`
- `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`

## Qué no se concluye

- **No se concluye por qué falló el planner.** Las entradas que lo determinarían
  —el stdout del CLI o el texto de su envelope `result`— no se conservaron.
- No se concluye que el modelo sea incapaz de planificar 16 módulos: eso exigiría
  una observación que no existe.
- No se concluye que sea un throttling del proveedor, por lo dicho arriba.
- No se corrige el host en esta sesión. El arreglo es acotado —preservar una cola
  del `result` en la razón del fallo— pero cambia comportamiento, y hacerlo ahora
  invalidaría el freeze `5c48aba` bajo el que se midieron N=4 y N=8. Queda
  registrado como brecha de observabilidad, no reparada.
- La celda **no se reintenta**: el protocolo congelado admite un intento por
  celda, y el planner ya había reintentado tres veces internamente con el mismo
  resultado.
