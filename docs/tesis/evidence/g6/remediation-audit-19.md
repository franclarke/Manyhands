# Auditoría retrospectiva de G6-B antes de reanudar

Fecha: 2026-08-01

## Alcance y método

Se revisaron, en modo sólo lectura, los journals, snapshots, resultados,
veredictos externos y commits asociados a la corrida original y a las
remediaciones numeradas hasta la 19. Tres revisiones independientes cubrieron
la cronología de corridas, la causalidad de los fixes y el protocolo
experimental. Un cuarto dictamen contrastó esos hallazgos contra el código
actual y decidió el gate previo a una nueva celda.

## Hechos verificados

- El inventario contiene una corrida original y etiquetas de remediación 1 a
  19; la remediación 8 no tiene artefactos canónicos y remediación 19 no tiene
  `result.json` de una ejecución completa.
- Sólo cuatro ejecuciones B llegaron a candidato con oracle externo:
  remediación 7 (7/10), 9 (7/10), 11 (8/10) y 17 (8/10). Ninguna fue PASS.
- Remediación 17 pasó build, typecheck, tests y probe, pero el oracle encontró
  `rush` en lugar de `express` y `quantity` en lugar de `missing`.
- Remediación 18 preserva una integración que perdió adiciones de hijos. El
  fix `e5eabd1` agrega los patches físicos de hijos al contexto de reparación,
  pero todavía no tenía una corrida completa que lo verificara.
- La corrida remediación 19 fue detenida y preservada después de observar en
  el journal un timeout pre-candidate de la hoja API seguido por intentos
  automáticos adicionales. Eso viola la regla congelada de una ejecución por
  celda y no se considera dato atribuible.
- La política anterior tenía presupuestos automáticos por clase de fallo,
  incluido `transient: 2`. El nuevo contrato experimental persiste
  `automaticRetryBudget: 0` y `maxPlanningAttempts: 1` en la configuración de
  cada celda G6.

## Evaluación de los fixes

Los fixes de worktrees, locks, creación canónica de runs y materialización
transitiva atacaron fallas mecánicas reales y tienen regresiones unitarias. En
cambio, varios fixes posteriores endurecieron prompts o compararon líneas de
diff: son defensas útiles, pero no sustituyen una frontera de código que
rechace una salida con literales o estado equivocados. La secuencia observada
fue repetidamente: contrato incompleto, instrucción adicional al agente, test
del prompt y una nueva variante del mismo incumplimiento en la siguiente
corrida.

## Mejora aplicada antes del próximo run

El runner ahora exige un `g6Protocol` explícito en cada celda comparativa y
envía `executionConfig` sin mutarlo. El gate comprueba:

- un máximo de una llamada de planning;
- `automaticRetryBudget: 0`;
- tope de USD 8 por celda;
- topes declarados de USD 40 y 2.000.000 de tokens para la serie.

El host de planning usa el máximo persistido en lugar del hardcode de tres
intentos. El driver usa el presupuesto persistido para decidir retries
automáticos, preservando los defaults históricos cuando el campo está ausente
en runs no experimentales. Las regresiones cubren rechazo por configuración
ausente o divergente, todas las seis celdas G6 y el timeout transient sin
segundo intento.

## Decisión

G6 queda bloqueado hasta que el gate de protocolo y el oracle externo estén
verdes sobre una celda nueva. Un delivery exitoso sin oracle no se contará como
éxito experimental. La siguiente ejecución, cuando se autorice, deberá partir
de un commit limpio que incluya este gate y conservar su journal aunque falle
antes de candidate.

## Qué no se concluye

Esta auditoría no demuestra que el candidato siguiente vaya a satisfacer el
oracle, ni que la integración semántica ya esté resuelta. Tampoco convierte las
cuatro entregas parciales en observaciones comparables de la condición B, ni
valida retrospectivamente el costo real de planning, cuyos eventos históricos
no registran `usage` completo.
