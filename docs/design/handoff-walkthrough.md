# ManyHands — Handoff Walkthrough & Consistency Audit

Este documento sirve como guía rápida de navegación y auditoría de consistencia para el siguiente agente de desarrollo (o modelo de lenguaje agéntico) encargado de implementar la refactorización del orquestador con **LangGraph.js** y su integración con el nuevo frontend.

---

## 1. Mapa de Documentación (File Map)

Toda la documentación técnica se ha actualizado y se encuentra 100% sincronizada con las decisiones tomadas. Los archivos clave y sus roles en el handoff son:

| Documento | Ubicación Absoluta | Rol en la Implementación |
| :--- | :--- | :--- |
| **Diseño del Orquestador** | [langgraph-orchestrator-design.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/langgraph-orchestrator-design.md) | **Especificación Técnica Primaria.** Contiene la definición del esquema del estado (`RunStateAnnotation`), las funciones de los nodos del grafo, las interrupciones (HITL), la arquitectura del Checkpointer JSON en disco y la estrategia de Forking para time-travel. |
| **Guía de Handoff / PRs** | [HANDOFF-codex.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/HANDOFF-codex.md) | **Guía de Ejecución Paso a Paso.** Detalla los objetivos, enfoques de código y criterios de aceptación para cada una de las 4 unidades de trabajo de LangGraph (`PR-LG1` a `PR-LG4`). |
| **Plan de Trabajo Global** | [implementation-plan.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/implementation-plan.md) | **Plan Incremental del Monorepo.** Integra la fase de LangGraph (Fase 12) como parte del ciclo de vida general del rediseño agent-first del monorepo. |
| **Estado de Implementación** | [implementation-status.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/implementation-status.md) | **Bitácora del Estado del Proyecto.** Registra el cierre de las tareas previas de frontend y documenta los objetivos de transición hacia el backend de LangGraph. |
| **Modelos y Componentes** | [run-operative-model.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/run-operative-model.md) y [system-components.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/system-components.md) | **Definición Conceptual.** Mapean el historial de checkpoints e interrupciones al modelo de datos del run y a las proyecciones visuales de la UI. |
| **Análisis de Hipótesis** | [langgraph-analysis.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/langgraph-analysis.md) | **Validación Académica para la Tesis.** Detalla las hipótesis de investigación evaluables (descomposición, ruteo de modelos, auto-repair y auto-consistencia). |

---

## 2. Auditoría de Consistencia (Consistency Check)

Se ha verificado la compatibilidad cruzada de los diseños propuestos, confirmando que:
1.  **Checkpoints como logs de eventos**: El motor del reductor del frontend (`reducer.ts`) lee el mismo array de eventos `RunEvent[]` que el checkpointer JSON (`JsonFileCheckpointSaver`) almacena en disco.
2.  **Cero doble fuente de verdad**: La carga inicial en Next.js Server Components lee directamente el estado del checkpoint de LangGraph, evitando recalcular en memoria logs históricos pesados.
3.  **Seguridad en el Forking**: Al rebobinar con time-travel, el endpoint `/api/runs/[id]/fork` crea un run completamente nuevo (`newRunId`) con worktrees aislados (`mh-{newRunId}-{nodeId}`), evitando colisiones de git en el mismo directorio.
4.  **Interrupciones no invasivas**: Las llamadas a `interrupt()` detienen únicamente los subárboles dependientes del grafo de control, permitiendo que tareas paralelas e independientes en batches concurrentes sigan ejecutándose.

---

## 3. Instrucciones de Arranque para el Siguiente Agente

Al abrir la nueva sesión, debes seguir exactamente este protocolo de 5 pasos para comenzar el desarrollo de forma segura:

1.  **Carga de Contexto**: Leer el archivo [langgraph-orchestrator-design.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/langgraph-orchestrator-design.md) para asimilar la estructura del grafo de LangGraph.
2.  **Verificación del Baseline**: Correr la suite de pruebas completa en local para asegurar que inicias desde un estado verde:
    ```bash
    pnpm web:typecheck
    pnpm test
    ```
    *(Esperar 803 pruebas pasando y 3 saltadas)*.
3.  **Inicio de Codificación**: Comenzar con la **Fase A (PR-LG1)** detallada en [HANDOFF-codex.md](file:///c:/Users/franc/Documents/Manyhands/docs/design/HANDOFF-codex.md#pr-lg1--paquete-de-grafos-e-infraestructura-de-checkpoint).
4.  **Enfoque de Construcción**: Todos los desarrollos en `@manyhands/orchestrator-graph` deben ser modulares y no alterar la lógica interna de git ni del Gemini CLI, actuando LangGraph puramente como el orquestador de estado.
5.  **Alineación**: Ninguna directriz del sistema debe violar las invariants del proyecto (D1–D10) descritas en [AGENTS.md](file:///c:/Users/franc/Documents/Manyhands/AGENTS.md).
