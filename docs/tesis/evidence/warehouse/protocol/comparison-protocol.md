# Protocolo de comparación A/B/C

Estado: **pre-registrado antes de Warehouse Pilot**.

## Objetivo

Comparar costo y entrega verificada de tres fronteras sobre bloques Warehouse
seleccionados después del freeze, sin convertir la comparación en una búsqueda
de un resultado favorable.

## Condiciones

- A: raíz como hoja si es viable.
- B: frontera semántica válida más fina del candidate tree.
- C: frontera de máxima utilidad esperada con configuración congelada.

El Planner se ejecuta una vez por bloque para producir un candidate tree
versionado. A/B/C reciben exactamente ese tree, goal, aceptación, base,
snapshot, modelo y límites. Candidate replay queda autorizado sólo cuando sus
hashes de goal, snapshot, aceptación y tree coinciden.

## Bloques y repeticiones

Los bloques se elegirán antes de Final entre incrementos que representen baja,
media y alta presión de coordinación. Diseño mínimo: 3 bloques × 3 condiciones
× 2 repeticiones. El orden será balanceado y se generará antes de ejecutar la
primera celda. No se seleccionan sólo incrementos donde C dividió.

## Outcomes

Primario: entrega cuyo commit pasa el mismo oráculo externo. Secundarios:
reloj, tokens no censurados, attempts, repairs, hojas, profundidad, conflictos,
duplicación de validación y costo de coordinación. Los criterios del usuario se
mantienen idénticos; obligaciones técnicas internas no se cuentan como una vara
de éxito adicional.

## Interpretación

Es evidencia a favor de C si preserva entrega y evita costo innecesario de A o
B en al menos un régimen explicable. Es evidencia negativa si no entrega más o
si su costo no se compensa. No se hará inferencia poblacional ni se recalibrará
C después de observar estas celdas.

## Invalidación

Cambio de versión, asset, modelo, base u oráculo invalida la serie completa. Un
fallo consume su tiempo y tokens; no se descarta salvo causa externa declarada
que afecte la validez de la celda antes de que el agente actúe.
