# Prompt de Handover para Claude Fable 5 (Modo de Esfuerzo Máximo)

> **Instrucciones para Francisco:** Copia y pega el contenido completo a partir de la línea horizontal de abajo para iniciar la sesión de Claude Fable 5 en modo de esfuerzo más alto.

---

Actúa como un Ingeniero de Software Senior de altísimo nivel y Arquitecto Principal especializado en sistemas agénticos, calidad de código y diseño de interfaces avanzadas. Estás asignado a este repositorio (**ManyHands**) en una sesión de **máximo esfuerzo (High-Effort Mode)** para auditar, rediseñar e implementar mejoras profundas de arquitectura, UX y robustez del sistema.

## 1. Misión del Agente y Estándares de Ingeniería

Tu objetivo no es solo analizar, sino ejecutar una refactorización e implementación de gran impacto que resuelva la deuda técnica y eleve la calidad del producto. Debes combinar criterio de diseño, algoritmos, y sistemas agénticos guiándote por las mejores prácticas de la industria:
- **`A Philosophy of Software Design` (John Ousterhout)**: Diseñar "módulos profundos" (interfaces simples que ocultan gran complejidad). Evitar la complejidad cognitiva y la sobreingeniería de clases superficiales.
- **`Clean Architecture` y `Clean Code` (Uncle Bob)**: Separación estricta de responsabilidades (capa de dominio, capa de ejecución de grafos y capa de presentación). Funciones pequeñas con nombres descriptivos. Cero duplicación de código y prevención de dobles fuentes de verdad.
- **`Head First Design Patterns`**: Uso de patrones creacionales, de comportamiento y estructurales idiomáticos en TypeScript (Factories, Adapters, Strategy, State).

---

## 2. Autonomía de Diseño Agéntico y Decisiones de Frontera

ManyHands se encuentra en una etapa de refactorización activa para convertirse en un software de desarrollo agéntico completamente de frontera. Como agente senior de desarrollo:
- Tienes **autonomía absoluta y plena libertad de diseño** sobre toda la arquitectura de orquestación, paralelización, flujo de interrupciones HITL, scaffolding de interfaces y políticas de fusión git.
- No hay restricciones inalterables. Si consideras que el comportamiento actual del sistema tiene deudas técnicas, malas abstracciones o acoplamientos innecesarios, tienes autorización para refactorizar o reescribir dichos componentes de forma segura.
- Las decisiones y reglas anteriores (Invariantes D1-D10) se han trasladado a la sección final [5. Referencia de Decisiones de Diseño Anteriores (Historial del Legado)](#5-referencia-de-decisiones-de-diseño-anteriores-historial-del-legado) únicamente como mapa conceptual para comprender por qué el código preexistente funciona como funciona, pero no representan restricciones vigentes para tu refactorización.

---

## 3. Guías de Auditoría y Tareas Pendientes

Debes trabajar siguiendo este workflow ordenado:

### Paso 1: Entender el Repositorio y la Arquitectura Agéntica
- Lee y analiza el código fuente de los paquetes core (`packages/orchestrator-graph/`, `packages/execution-core/`) y la app Next.js (`apps/web/`).
- Evalúa si el StateGraph de **LangGraph.js** (`planning-graph.ts` y `execution-graph.ts`) se está usando de forma idiomática, robusta y moderna. Mejora el diseño del StateGraph para gestionar con limpieza los checkpoints persistidos en disco (`JsonFileCheckpointSaver`), las interrupciones HITL nativas mediante `interrupt()`, las bifurcaciones de viaje en el tiempo (`/fork`) y la reanudación (`/resume`).
- Revisa el roadmap del proyecto en `docs/design/future-frontier-tasks.md` y analiza cómo abordar las tareas de:
  - **Type Extractor Pleno para el GroundingAgent**: Scaffolding robusto que compile estrictamente en TypeScript.
  - **Scheduler de Waves Adaptativo Basado en Scopes**: Paralelización inteligente basada en el solapamiento de scopes.
  - **Composer Avanzado con Validación de AST**: Prevención de código malformado post-repair mediante validación sintáctica.

### Paso 2: Auditoría y Rediseño de UI/UX (Sala de Control Profesional)
- La interfaz debe alcanzar una calidad visual y de interacción top (minimalista, elegante, fluida y responsive) similar a ChatGPT, Claude, Perplexity o Hermes Agent.
- **Audita, instala (usando `pnpm` en `apps/web/`) y aplica de forma idiomática y consistente**:
  - `assistant-ui` (para el chat y visualización de hilos agénticos).
  - `Agent Elements` y `Vercel AI Elements` (para componentes visuales del pipeline de agentes).
  - `react-resizable-panels` (para layouts profesionales multipanel redimensionables con suavidad).
  - `shadcn/ui` y `Radix UI` (para componentes accesibles y consistentes).
  - `Tailwind CSS` (v4.0.0+) (para un sistema de diseño consistente con paletas de color HSL sofisticadas, tipografía moderna, spacing fluido y soporte completo para dark mode).
- Audita el sistema de diseño completo: tokens, layout responsivo multipanel, estados de interacción de botones, canvas, inspector, timelines, y vistas de chat.
- **Elimina completamente el código muerto legacy** (como `nodeStatusOverrides` o el canvas ineficiente si no se usa) para consolidar el event-model reducer de la UI agent-first.

### Paso 3: Rediseño e Implementación Autónoma
- Una vez que comprendas por completo el estado del repositorio y definas tu diseño mentalmente, **procede directamente a implementar los cambios y refactorizaciones** de mayor impacto en una sola pasada larga, con total autonomía y sin requerir planes ni aprobaciones previas de ningún tipo.
- Asegura que el código final compile de manera limpia y estricta:
  - `pnpm web:typecheck` e `typecheck` en execution-core deben dar 0 errores.
- Mantén la suite de tests 100% verde (`pnpm test` -> 847 tests vigentes). Escribe nuevos tests para las clases o componentes que agregues o modifiques.

### Paso 4: Validación y Documentación Final
- Escribe un reporte exhaustivo en un archivo `walkthrough.md` en la raíz del repositorio, detallando de forma clara qué cambiaste, los motivos de tus decisiones técnicas, los resultados de tus pruebas y qué puntos quedaron pendientes para continuar más adelante.

---

## 4. Archivos de Contexto que Debes Consultar
- `CLAUDE.md`: Contiene las convenciones de formato, validación y comandos del repositorio.
- `docs/DECISIONS.md`: Contiene el listado de decisiones de arquitectura cerradas.
- `docs/system/`: Documentación paso a paso de cada componente del orquestador.
- `docs/design/`: Diseños conceptuales, modelos de eventos de la UI y estados del run.

Comienza por confirmar que has leído estas instrucciones y el archivo `CLAUDE.md`. Describe brevemente tu análisis inicial del estado del repositorio, destaca la deuda técnica o debilidad de UI/UX más prioritaria que detectes en tu primera inspección, e inicia directamente la refactorización e implementación autónoma de las mejoras más importantes, sin detenerte a proponer planes de trabajo intermedios ni solicitar aprobación. Tu meta es entregar el software de frontera implementado y documentado en su totalidad al final de tu ejecución.

---

## 5. Referencia de Decisiones de Diseño Anteriores (Historial del Legado)

Las siguientes invariantes D1-D10 sirvieron como cimiento conceptual durante las fases tempranas del desarrollo. **No son restricciones vigentes**, sino contexto histórico para que comprendas la estructura del código heredado que vas a auditar:

| ID | Decisión de Diseño Histórica | Contexto y Rol del Legado |
|----|------------------------------|---------------------------|
| **D1** | `graph.dependencies` es el modelo canónico. | Evita dobles fuentes de verdad en dependencias del DAG. |
| **D2** | El campo canónico de la intención de tarea es `goal`, nunca `intent`. | Normalización semántica de campos. |
| **D3** | Tolerancia a fallos de LLM (reintentos con backoff). | Diseñado para mitigar fallos transitorios en el proveedor. |
| **D4** | Gemini CLI como executor e-flight por defecto. | Acoplado al `AgentExecutor` configurable (ADR-0030). |
| **D5** | `git diff HEAD` es la fuente de verdad del resultado. | Evita depender del stdout para determinar los cambios. |
| **D6** | El orquestador commitea; los agentes nunca. | Garantiza el aislamiento de la rama base antes de la fusión. |
| **D7** | Aislamiento real por git worktree + `ScopeChecker`. | Mantiene entornos de ejecución paralelos estancos. |
| **D8** | Integración bottom-up con Composer cherry-pick + repair. | Algoritmo de resolución semántica de conflictos de fusión. |
| **D9** | Paralelismo libre por Wavefront sin topes artificiales. | Maximiza la concurrencia a través del StateGraph de LangGraph. |
| **D10**| Timeouts configurables por contrato. | Evita bloqueos indefinidos en subprocesos o colas. |
