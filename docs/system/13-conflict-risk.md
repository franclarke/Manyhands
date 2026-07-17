# Conflict risk y resource constraints

## Propósito

Predecir cuándo dos intentos podrían interferir para que el scheduler decida
serializar o ejecutar con cautela. No prueba corrección y no crea dependencias
funcionales.

## Señales

- overlap de paths/scope;
- mismo símbolo, export o schema público;
- import producer/consumer no cubierto por seam;
- migraciones, lockfiles y configuración compartida;
- fixtures/tests globales;
- recursos externos exclusivos;
- historial de conflictos comparable;
- incertidumbre del repository index.

Cada señal conserva source, freshness, confidence y rationale.

## Salida

`ConflictConstraint` puede ser:

- advisory: ejecutar en paralelo y observar;
- serialize: no compartir wave;
- resource_lock: adquirir recurso nombrado;
- compiler_finding: el grafo/contrato está mal y debe corregirse.

El risk scorer no inventa ArtifactRequirements. Si detecta un flujo real de
datos, emite finding para el Graph Compiler.

## Seams

Dos nodos que consumen/producen un seam compatible están diseñados para correr
en paralelo. Solo elevan riesgo si también comparten superficie física no
aislada o sus declaraciones son incompatibles.

## Limitaciones

- El análisis estático no ve semántica completa.
- Un score bajo no elimina validación/integración.
- Un score alto no implica error; puede indicar costo de repair.
- Missing index nunca se mapea a low risk.
