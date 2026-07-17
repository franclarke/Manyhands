# Boundary del motor de orquestación

## Decisión

LangGraph puede seguir siendo el motor del control plane, pero no es el modelo
del producto ni el `TaskGraph` que se muestra al usuario.

```text
TaskGraph       = trabajo de software planificado
Control graph   = flujo interno para coordinar casos de uso
RunEventLog     = historia de dominio durable
Checkpoint      = mecanismo de recuperación del motor
```

Ninguno sustituye automáticamente a otro.

## Responsabilidad permitida de LangGraph

- encadenar planning, scheduling, ejecución, integración y delivery;
- pausar y reanudar casos de uso;
- fan-out/fan-in controlado;
- checkpoint de estado interno;
- transportar comandos hacia servicios de dominio.

## Responsabilidad prohibida

- definir estados persistidos de producto sin eventos de dominio;
- representar las relaciones del TaskGraph mediante edges del control graph;
- convertir un checkpoint en event log por conveniencia;
- mutar artefactos, git o RunRecord desde nodos sin puertos y leases;
- usar `interrupt()` como única representación de decisiones humanas;
- exponer tipos de LangGraph en contratos compartidos o UI.

## Adapter objetivo

`RunCoordinator` expone casos de uso independientes del framework. Un adapter de
LangGraph llama esos casos y persiste su propio checkpoint. Los servicios
devuelven eventos/outputs explícitos; el adapter no infiere éxito de que un nodo
del control graph terminó.

## Resume y fork

- Resume recupera el checkpoint del motor y reconcilia contra el event log y las
  leases vigentes.
- Fork crea un nuevo run con target, graph revision y artefactos elegibles
  referenciados explícitamente.
- Un checkpoint viejo nunca recupera autoridad sobre una lease reemplazada.

## Criterio para conservar o reemplazar LangGraph

Se conserva si simplifica fan-out, resume y testing sin duplicar lifecycle. Se
reemplaza si obliga a traducir tombstones, estado mutable o interrupts en una
semántica que el dominio ya expresa mejor.

La transición debe evaluar costo de migración y corrección; no reemplazar el
framework por preferencia estética.
