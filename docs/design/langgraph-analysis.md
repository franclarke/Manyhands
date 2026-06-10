# ManyHands — Análisis de Viabilidad, Rediseño de Backend y Alineación de Tesis con LangGraph

Este documento analiza la propuesta de refactorizar y rediseñar el backend de orquestación de ManyHands utilizando **LangGraph** (específicamente en su versión de TypeScript: `LangGraph.js`). El análisis se divide en la evaluación del flujo actual, las ventajas y desventajas de la migración, la arquitectura de referencia propuesta y una recomendación final, teniendo en cuenta tanto la tesis de ingeniería como el nuevo brief de rediseño del frontend.

---

## 1. Análisis de la Implementación Actual

El backend de ManyHands opera actualmente en dos fases bien definidas a través de `apps/web/src/lib/server/runs/runner.ts` y `@manyhands/execution-core` (`RunExecutor`):

### A. Core Loop de Planificación (Task Planning / Decomposition)
1. **Grounded Ingestion**: El workspace local se indexa para proveer una estructura topológica de símbolos (`buildRepositoryGrounding`).
2. **Recursive Decomposition**: Se delega en `GeminiRecursiveDecomposer`. Este realiza un recorrido descendente (top-down), llamando a Gemini para decidir si cada nodo del plan debe subdividirse (`decompose`), quedar como tarea atómica (`leaf`) o si requiere aclaración del usuario (`question`).
3. **Suspended State (HITL)**: Cuando el LLM decide hacer una pregunta, el decomposer lanza un error `DecomposerQuestionError`. El pipeline de planificación captura este error, almacena la traza del progreso en `planningStepCache`, guarda las preguntas pendientes y pausa el run (`status = "paused"`). Al responder el usuario, el pipeline vuelve a ejecutarse desde cero usando el caché (`planningStepCache` y `questionAnswers`) para simular la continuación (patrón de repetición/replay).
4. **Critic & Approval**: Al completarse el DAG, los validadores determinan si las interfaces (seams) y comandos son coherentes, y el run pasa a `needs_review` esperando la aprobación del usuario en el frontend.

### B. Core Loop de Ejecución (Task Execution)
1. **Scheduling**: Se ordenan y agrupan las tareas en lotes (batches) paralelos naives o conscientes del riesgo (`scheduleTasks`).
2. **Leaf Execution**: Para cada tarea hoja en un lote:
   - Se crea un worktree de git aislado.
   - Se empaqueta el contexto (`FileSystemContextPacker`) y se escriben las instrucciones en un archivo temporal.
   - Se invoca a **Gemini CLI** (`gemini`, headless) con approvals en `bypassApprovals: true`.
   - Se valida el resultado mediante los tests del nodo (`leafValidationCommands`).
   - Se genera el diff (`git diff HEAD`) y el orchestrador realiza el commit correspondiente en la rama de la tarea.
3. **Composite Integration**: Siguiendo el DAG de abajo hacia arriba:
   - Los nodos padre integran las ramas de sus hijos mediante `git cherry-pick`.
   - Si ocurre un conflicto textual, el `IntegrationAgent` (Composer) ejecuta un intento de reparación semántica con Gemini.
   - Se ejecutan los comandos de validación del nodo padre.
4. **Final Patch**: Una vez integrado todo el DAG, se corre la validación a nivel de run completo (`runRunValidation`) en el worktree raíz, y se aplica el diff final a la rama principal del workspace para que el usuario la apruebe y mezcle.

---

## 2. ¿Qué aporta LangGraph a ManyHands?

**LangGraph** está diseñado específicamente para modelar flujos de control complejos, persistentes y multi-agente. A diferencia de las cadenas lineales tradicionales, permite estructurar la ejecución del sistema como un grafo de estados (`Nodes` y `Edges`) con memoria.

A continuación, se evalúa cómo puede ayudar (o dificultar) a la arquitectura de ManyHands:

### Ventajas (Pros)

1. **Simplificación Drástica del Human-in-the-Loop (HITL)**
   - **Actualidad**: Pausar y reanudar la planificación requiere lanzar excepciones (`DecomposerQuestionError`), guardar caches intermedios en base de datos (`planningStepCache`), y volver a instanciar/reproducir todo el recorrido desde cero al recibir la respuesta.
   - **Con LangGraph**: El soporte para **interrupciones (`interrupt`)** es nativo. LangGraph detiene el grafo antes o después de la ejecución de cualquier nodo (`decomposeNode`), guarda el estado exacto en un checkpointer, y permite al usuario proveer feedback. Al reanudar, el motor de LangGraph continúa la ejecución exactamente en el mismo paso sin necesidad de recalcular pasos previos ni recurrir a un mecanismo manual de replay cache.

2. **Checkpointing y Persistencia del Estado del Run**
   - El estado completo del run (el `TaskGraph`, variables de control, commits, e históricos de logs) se puede guardar automáticamente tras cada paso mediante checkpointers integrados (memoria, PostgreSQL, etc.).
   - Esto simplifica la base de datos de runs y previene estados inconsistentes si el servidor web se reinicia.

3. **Time-Travel Debugging (Depuración por Viaje en el Tiempo)**
   - Dado que LangGraph guarda un historial inmutable de checkpoints por cada transición de estado del grafo, el sistema permite de forma nativa **hacer "fork" de un run en un estado pasado**.
   - *Caso de uso en ManyHands*: Si una integración falló o el usuario no está conforme con cómo un subagente ejecutó una tarea hoja, el usuario podría, desde la UI, "volver atrás" en el tiempo del run, modificar la instrucción, y re-ejecutar solo esa rama del DAG sin perder el trabajo de las otras ramas que sí funcionaron. Esto es sumamente valioso para la tesis y la UX del producto.

4. **Sincronización con el Rediseño del Frontend (Conversational + Artifact)**
   - El nuevo frontend propuesto en el brief destaca un chat conversacional narrativo interactuando con un artifact visual (el DAG vivo).
   - LangGraph emite flujos de eventos de streaming nativos (`onNodeStart`, `onNodeEnd`, streaming de tokens). Estos se pueden canalizar de forma mucho más limpia a los SSE (Server-Sent Events) existentes, permitiendo que la UI refleje en tiempo real exactamente qué nodo del grafo de LangGraph está "pensando" o "ejecutando".

---

### Desafíos y Desventajas (Cons)

1. **Naturaleza Estática vs. DAG Dinámico**
   - **LangGraph** define el flujo de la aplicación (los pasos del sistema: planificar, planificar-nodo, agendar, ejecutar-lote, integrar, validar) como un grafo estático de control.
   - Sin embargo, ManyHands ejecuta un **TaskGraph de tareas de software dinámico** que se genera en tiempo de ejecución.
   - *Resolución*: No se debe intentar mapear cada nodo de tarea de software directamente como un nodo físico de LangGraph de manera estática. En su lugar, el grafo de LangGraph representa el **motor del core loop** (la máquina de estados del orquestador), y utiliza estructuras dinámicas como `Send` (para paralelizar de forma dinámica una lista de tareas de un batch) y bucles condicionales para recorrer el TaskGraph.

2. **Complejidad del Ecosistema de TypeScript (LangGraph.js)**
   - LangGraph se originó en Python. Aunque existe `LangGraph.js` y es mantenido activamente por el equipo de LangChain, tiene menos documentación y ejemplos en el mundo real en comparación con Python. Esto puede traducirse en una curva de aprendizaje inicial para solventar problemas de tipos o comportamiento del runtime.

3. **Restricción de Invariantes Existentes (D4 / D5 / D6)**
   - El uso de LangGraph no debe violar los invariantes de ManyHands. Por ejemplo:
     - El ejecutor de tareas hoja debe seguir siendo el Gemini CLI (`gemini`) invocado mediante subprocess (D4).
     - La fuente de verdad sobre lo que cambió debe seguir proviniendo de Git (`git diff HEAD`) y no del JSON del LLM (D5).
     - LangGraph simplemente actúa como el **coordinador del flujo de control**, pero no debe reemplazar a las clases de dominio que interactúan con Git o el CLI.

---

## 3. Decisiones de Diseño Clave

Para integrar LangGraph de manera coherente con la base del código y la UX conversacional propuesta en [manyhands_frontend_redesign_brief.md](file:///c:/Users/franc/Documents/Manyhands/manyhands_frontend_redesign_brief.md), se han adoptado las siguientes directrices arquitectónicas:

| Área de Diseño | Decisión Adoptada | Razón Técnica & Operativa |
| :--- | :--- | :--- |
| **Persistencia / Checkpointer** | **Checkpointer JSON personalizado en disco** | Guarda los checkpoints de LangGraph en el sistema de archivos junto a los runs en [store.ts](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/lib/server/runs/store.ts). Evita añadir dependencias de bases de datos pesadas y se integra de forma nativa con `JsonRunRecordStore`. |
| **Concurrencia Paralela** | **Patrón Send (Map-Reduce) de LangGraph** | Cada tarea hoja se ejecuta y controla en su propio nodo del grafo de LangGraph. Permite auditorías granulares por tarea y posibilita re-ejecutar o diagnosticar subagentes individuales. |
| **Sincronización de Eventos** | **Reutilización del adaptador de TraceStore** | Los nodos de LangGraph escriben directamente sus logs operacionales en el `LiveExecutionTraceStore` existente en [runner.ts](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/lib/server/runs/runner.ts). El bus de eventos SSE existente no requiere cambios. |
| **Resolución de Conflictos** | **Interrupt + Tarjeta interactiva en Chat** | Si el Composer no puede reparar un conflicto de merge automáticamente (D8), LangGraph se pausa y emite un evento de decisión. El frontend dibuja una interfaz interactiva donde el usuario guía la resolución del código. |
| **Viaje en el Tiempo (Time-Travel)** | **Creación de nueva ejecución (Fork)** | Al volver atrás en la historia de ejecución, se crea una nueva entidad de Run en la base de datos que clona el historial hasta el checkpoint deseado. Es no destructivo y permite comparar intentos paralelos para la tesis. |
| **Fallos de Validación** | **Auto-reparación (1 intento) -> HITL** | Si un test de tarea hoja falla, se realiza una reparación automática usando el reporte del test fallido. Si vuelve a fallar, se interrumpe el flujo y se le pide feedback al usuario en el chat. |
| **Carga de Página Inicial** | **Consulta del Checkpoint de LangGraph** | Durante la carga inicial de la página en Next.js (Server Components o API), se lee directamente el último checkpoint de LangGraph, asegurando un renderizado consistente del progreso del DAG sin depender de reconstrucciones dinámicas desde logs de eventos históricos. |

---

## 4. Alineación y Validación de Hipótesis para la Tesis de Ingeniería

La implementación propuesta con **LangGraph** se alinea directamente con los dos pilares de tu tesis (Planificación Recursiva Jerárquica y Ejecución con Integración Bottom-Up) y expande significativamente tus capacidades para recopilar métricas y validar tus hipótesis científicas.

### A. Soporte para el Modelo de Descomposición Jerárquica (Pilar 1)
- **Hipótesis del Nivel de Descomposición (`low`, `medium`, `high`)**:
  Tu tesis postula que el tamaño y granularidad de las tareas atómicas afecta la calidad de la implementación. 
  - *Cómo ayuda LangGraph*: El parámetro de granularidad seleccionado por el usuario en la home del frontend se inyecta en el canal de estado de LangGraph. Como LangGraph persiste la historia completa, puedes realizar **estudios comparativos exactos**. Puedes ingresar la misma especificación del sistema, ejecutarla bajo los niveles `low`, `medium` y `high`, y exportar sus tres checkpoints JSON de LangGraph resultantes para comparar:
    1. La profundidad y ancho máximo del TaskGraph generado.
    2. La cantidad total de tokens consumidos durante la planificación.
    3. La precisión de los límites de alcance (`executionScope`) deducidos por el decomposer.

### B. Control del Ciclo de Ejecución Bottom-Up (Pilar 2)
- **Topological Sorting y Concurrencia de Subagentes**:
  Tu tesis define que el orden jerárquico es clave para minimizar conflictos.
  - *Cómo ayuda LangGraph*: Modelar la ejecución a través de un grafo de control formalizado en LangGraph (utilizando `Send` para batches y dependencias topológicas) te permite medir cuantitativamente:
    1. **Tasa de Conflictos de Fusión**: ¿Genera la descomposición alta (`high`) más o menos conflictos semánticos en los nodos de integración (`integrateComposite`) en comparación con la descomposición baja (`low`)?
    2. **Sobrecarga (Overhead) de Integración**: ¿Cuánto tiempo y tokens de LLM requiere el Composer en reparar los conflictos conforme el árbol es más profundo?
    3. **Tasa de Aprobación de Tests**: ¿Tienen las tareas de nivel `high` (más pequeñas y atómicas) una tasa de éxito en validación automática (`leafValidationCommands`) significativamente mayor que las tareas más complejas de nivel `low`?

### C. Nuevas Hipótesis Viables de Evaluar en tu Tesis
El uso de LangGraph abre la puerta a evaluar variables académicas avanzadas que serían muy complejas de medir con un orquestador ad-hoc:
1.  **Heterogeneidad de Modelos (Model Routing)**: Puedes testear la hipótesis de si es más eficiente usar un modelo más pequeño y económico (ej. Gemini Flash) para ejecutar tareas hoja atómicas, y reservar un modelo de razonamiento superior (ej. Gemini Pro) únicamente para las fases críticas de planificación e integración semántica. Con LangGraph, puedes registrar los costos de API y evaluar si este esquema híbrido iguala la calidad reduciendo el coste en un X%.
2.  **Efectividad del Auto-Repair (Composer) frente a HITL**: Puedes extraer estadísticas sobre cuántas veces el nodo `integrateComposite` resolvió conflictos en el primer intento automatizado, frente a cuántas veces requirió una interrupción (`MergeConflictInterrupt`) para intervención humana.
3.  **Análisis de Desviación en Re-ejecuciones (Forks)**: Utilizando la funcionalidad de viaje en el tiempo (Forking), puedes medir el impacto de alterar una instrucción a mitad de camino y registrar cómo se desvía la calidad final del software producido, documentando la adaptabilidad del orquestador en tiempo real.

---

## 5. Arquitectura de Frontera: Extensiones Agénticas de Vanguardia para la Tesis

Si buscas elevar la calidad y proponer una tesis en la frontera del conocimiento actual sobre sistemas multi-agente, la flexibilidad del diseño con **LangGraph** te permite incorporar componentes avanzados de orquestación. Estos cuatro rediseños conceptuales posicionan a ManyHands como un sistema agéntico de última generación:

### A. Re-planificación Dinámica Activa (Adaptive Run-time Re-planning)
-   *Limitación del estado del arte básico*: La descomposición jerárquica ocurre al inicio y se asume estática durante la ejecución. Si un subagente descubre a mitad de camino que una interfaz debe cambiar, el plan se rompe.
-   *Extensión de Frontera en LangGraph*: Cuando un nodo en `executeLeafNode` detecta un impedimento estructural o una oportunidad de simplificación de código, puede emitir de forma autónoma una propuesta de enmienda (`amendment.proposed`). En lugar de detener el sistema, LangGraph rutea dinámicamente el control de regreso al nodo `decomposeNode` en caliente. El grafo de control modifica el `TaskGraph` restante, recalculando los contratos (`sharedInterface`) y límites de alcance de los nodos hermanos que aún están en la cola de ejecución.
-   *Aporte a la Tesis*: Evalúa cómo la tolerancia al cambio en vuelo y la plasticidad del DAG impactan la tasa de éxito general en comparación con ejecuciones de planes rígidos.

### B. Negociación Multi-Agente en Fusiones (Multi-Agent Conflict Reconciliation)
-   *Limitación del estado del arte básico*: Para resolver conflictos de merge, un único modelo (el Composer) evalúa de forma aislada los dos bloques de código en pugna e intenta unificarlos. Esto carece de perspectiva semántica sobre las intenciones de cada autor.
-   *Extensión de Frontera en LangGraph*: Al detectarse un conflicto en `integrateCompositeNode`, LangGraph inicializa un **subgrafo de negociación conversacional**. En este subgrafo, se instancian dos "agentes simulados" que asumen las identidades y objetivos de los dos subagentes desarrolladores originales. Estos agentes debaten en un chat de 2 o 3 turnos mediado por un tercer agente "Árbitro de Calidad" para resolver la discrepancia semántica y consolidar el código final de mutuo acuerdo.
-   *Aporte a la Tesis*: Introduce la comunicación multi-agente interactiva en el proceso de reconciliación de código, evaluando si el consenso reduce los fallos lógicos en el resultado final.

### C. Sistema de Memoria Episódica en el Workspace (Workspace Episodic Memory)
-   *Limitación del estado del arte básico*: Los subagentes de cada tarea hoja no comparten aprendizaje de fallos pasados en el mismo run. Si la tarea A falló por una mala configuración en un archivo base, la tarea B puede repetir el mismo error.
-   *Extensión de Frontera en LangGraph*: El canal `RunStateAnnotation` incorpora una clave `workspaceMemory` que funciona como almacén de aprendizaje corto y largo plazo. Si la validación de un nodo falla y es reparada (auto-reparación o manual), la lección aprendida ("*Recuerda importar la variable X al modificar el archivo Y*") se escribe en la memoria episódica del Run. Cuando el `FileSystemContextPacker` empaqueta el contexto para los siguientes nodos en cola, recupera y añade estas lecciones aprendidas directamente al prompt de los subagentes ejecutores.
-   *Aporte a la Tesis*: Estudia cómo la acumulación de experiencia a corto plazo mitiga la repetición de fallos de compilación o validación durante ondas paralelas de ejecución.

### D. Votación de Consenso en Hojas (Self-Consistency Code Voting)
-   *Limitación del estado del arte básico*: Se corre un único subagente de Gemini con temperatura 0 por tarea. Si el modelo comete un error sintáctico sutil, la tarea falla.
-   *Extensión de Frontera en LangGraph*: Para tareas marcadas como "críticas" (que tocan archivos con alto riesgo de conflicto o son nodos raíz de integración), el nodo `executeLeafNode` despacha $N$ (ej. 3) ejecuciones paralelas independientes con temperatura $T > 0.4$ en ramas de Git temporales. El orquestador evalúa los 3 candidatos candidatos contra los tests automatizados. Si más de uno pasa las pruebas, un agente de revisión crítica (Consensus Critic) los evalúa cualitativamente y selecciona el de mejor legibilidad.
-   *Aporte a la Tesis*: Implementa técnicas de auto-consistencia (Self-Consistency) y muestreo paralelo para garantizar resiliencia en nodos de alta importancia estructural.
