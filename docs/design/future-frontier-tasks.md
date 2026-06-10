# Tareas de Calidad de la Frontera (Roadmap de Rediseño de Backend y Arquitectura)

> **Instrucción Crítica para Claude Fable 5**: Este archivo contiene el roadmap propuesto para el rediseño y optimización profunda del backend y frontend de ManyHands. 
> **Tú tienes la soberanía y propiedad absoluta sobre este documento**. No te limites a las tareas aquí descritas. Tu primera acción en la sesión de alto esfuerzo debe ser auditar el repositorio, pensar de forma crítica y **reescribir, expandir o reemplazar este archivo** con tus propias propuestas justificadas para llevar el backend (orquestación, LangGraph, Scheduler, Composer y paralelismo) al estado del arte. Una vez definidos tus propios objetivos de frontera en este archivo, impleméntalos con total autonomía.

---

## 1. Type Extractor Pleno para el GroundingAgent

### Contexto Actual
El `GroundingAgent` (`packages/execution-core/src/run/grounding-agent.ts`) genera un walking skeleton básico (archivos vacíos, imports mínimos y firmas vacías) a partir de los contratos del plan aprobado. Esto permite que el código compile, pero el scaffolding es ingenuo en cuanto a firmas complejas y dependencias de tipos externos.

### Objetivo de la Tarea
Desarrollar un **Extractor de Tipos Pleno (Type Extractor)** que:
- Analice el AST (Abstract Syntax Tree) de TypeScript del repositorio antes de generar el skeleton.
- Extraiga con precisión las dependencias de tipos externas, tipos exportados, interfaces y enums de los archivos que las hojas consumirán.
- Scaffoldee archivos con firmas TypeScript sintácticamente perfectas y tipos robustos (incluyendo generic parameters y type constraints) para garantizar que las implementaciones paralelas no tengan problemas de compilación mutua en strict mode.

---

## 2. Scheduler de Waves Adaptativo Basado en Scopes

### Contexto Actual
El programador en LangGraph se apoya en un scheduler que agrupa tareas de manera secuencial u horizontal en batches de tamaño fijo (maxParallel = 6), sin un entendimiento profundo del solapamiento de archivos o dependencias semánticas entre hojas del mismo nivel.

### Objetivo de la Tarea
Implementar un planificador adaptativo que:
- Analice el scope de archivos asignados a cada tarea hoja (`executionScope` y `producedInterfaces`).
- Calcule el solapamiento de archivos entre tareas candidatas a ejecutarse en paralelo (blast radius de colisiones).
- Agrupe las tareas en **Waves de Ejecución disjuntas**:
  - Hojas que tocan archivos o módulos completamente independientes se ejecutan simultáneamente.
  - Hojas con riesgos de solapamiento semántico o conflictos previstos en la matriz se programan secuencialmente en micro-batches o con prioridad dependiente.
- Optimice dinámicamente el paralelismo maximizando la concurrencia real y reduciendo los conflictos de cherry-pick a nivel de integración.

---

## 3. Composer Avanzado con Validación de AST

### Contexto Actual
El Composer (`IntegrationAgent` en `packages/execution-core/src/integration/agent.ts`) realiza cherry-picks recursivos de las ramas de hojas. Si ocurre un conflicto de fusion, ejecuta un repair semántico (1 intento con Gemini) usando el contrato y la interfaz como contexto, y luego corre la validación de comandos del composite.

### Objetivo de la Tarea
Fortalecer el Composer agregando:
- **Validación Sintáctica Post-Repair**: Analizar sintácticamente el código del archivo en conflicto reparado mediante un parser AST rápido (p.ej. `tsc` programático o un parser TS ligero) para certificar que el modelo no generó código malformado antes de intentar commitear.
- **Estrategia Multi-Intento con Feedback de Compilador**: Si la validación sintáctica o de tipos del repair falla, re-inyectar el error exacto del compilador de TS al Composer en un loop de hasta 2 intentos para que se auto-corrija, en lugar de rendirse de inmediato en HITL.

---

## 4. Refactorización Completa de Vistas Legacy de la Web App

### Contexto Actual
El frontend cuenta con la sala de control agent-first por defecto detrás del event-model reductor en la ruta `/runs/[runId]`, pero aún existen componentes legados (`DagCanvas` con React Flow, `TaskInspector` legacy, y polling ineficiente) que persisten detrás del flag de rollback `?model=legacy`.

### Objetivo de la Tarea
- **Eliminación del Código Muerto Legacy**: Borrar de forma segura todas las dependencias y archivos asociados con la UI vieja de canvas, kanban board y timelines, eliminando el hook `useLiveRun` acoplado y la dependencia ineficiente de `nodeStatusOverrides`.
- **Visor de Evidencia Enriquecido**: Reemplazar los enlaces lazy de solo-ref en el Panel de Foco por visores nativos interactivos (diffs colapsables, logs formateados de terminal con resaltado de sintaxis, trazas de invalidación dinámicas) consumiendo directamente los endpoints `/api/runs/[id]/artifacts?ref=...`.
