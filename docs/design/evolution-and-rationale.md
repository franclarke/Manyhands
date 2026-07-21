# Evolución y razones del nuevo diseño

## Problema del modelo anterior

El diseño anterior realizó avances importantes —event log, seams, worktrees,
integración bottom-up— pero acumuló superficies y conceptos con autoridad
superpuesta:

- DAG entendido a veces como jerarquía, a veces como ordering;
- checkpoints de LangGraph descritos como event log;
- fases de UX tratadas como estados del sistema;
- seams, interfaces, tareas e integración promovidos a superficies paralelas;
- retries definidos por conteo antes que por causa;
- validación asociada a comandos en vez de obligaciones/evidencia;
- fixtures presentando capacidades que el backend real podía no sostener.

## Hallazgos que se conservan

- El repositorio real debe fundamentar el plan.
- Los agentes trabajan mejor con contexto local y feedback verificable.
- Las fronteras explícitas habilitan paralelismo.
- Los worktrees permiten aislamiento y descarte.
- La integración bottom-up refleja ownership del grafo.
- La UI debe derivar estado de hechos durables.
- Las decisiones humanas deben incluir contexto e impacto.

## Correcciones principales

### De “dependencia” a relaciones con semántica

Separar ownership, artefactos, compatibilidad y riesgo permite responder qué
necesita realmente un nodo antes de ejecutarse. También hace posible descubrir
dependencias futuras sin fingir omnisciencia inicial.

### De tarea técnica o funcional a corte híbrido

Los composites siguen la arquitectura y las hojas pueden ser incrementos
verticales. Esto mejora la ejecutabilidad sin convertir el grafo en un diagrama
incomprensible para una presentación.

### De retry universal a recuperación causal

Un timeout, un test roto, una interfaz incorrecta y una credencial ausente no se
resuelven igual. La política ahora clasifica antes de reintentar.

### De “pasó tests” a evidencia trazable

La Evidence Matrix obliga a demostrar cada criterio sobre el commit exacto,
distinguiendo uncovered y flaky de verified.

### De cockpit con muchas superficies a un workspace

El grafo, el inspector, las decisiones y el resultado cubren el flujo completo.
La profundidad técnica permanece disponible, pero deja de competir por atención.

## Qué se retira

- fases Framing/Foundation/Supervision/Reconciliation/Disposition como contrato;
- `GranularityVector` como eje de producto;
- vistas board/timeline como modos equivalentes;
- canal de diagnóstico avanzado;
- recentrado automático del canvas;
- aprobación de fallos como forma de completion;
- documentos de benchmarks, Lab Mode y planes cerrados;
- decisiones D1–D19 como invariantes eternas.

## Resultado de la transición

La arquitectura nueva se implementó por capacidades verticales y con
compatibilidad explícita. El cierre retiró la ruta V1 productiva, dejó el event
journal como autoridad y respaldó los gates con tests, typechecks, builds y
escenarios E2E. Los planes se conservan como historia; los cambios nuevos parten
de la arquitectura V2 vigente.
