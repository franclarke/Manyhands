# ManyHands - Guía de Estudio Rápido (1 Hora)

> **Propósito:** Comprender los fundamentos técnicos esenciales, la arquitectura y las garantías de ManyHands en un recorrido de lectura rápida (30-45 minutos) diseñado para la preparación técnica inmediata de la entrevista.

---

## 1. Resumen Ejecutivo (El "Elevator Pitch" en 1 Minuto)

> “ManyHands es un sistema de orquestación de múltiples agentes autónomos para desarrollo de software local-first. Mi tesis propone que una funcionalidad grande no puede resolverse de forma lineal y puramente probabilística (un agente chateando y editando). 
>
> Para resolverlo de forma segura, ManyHands divide la funcionalidad en un **DAG jerárquico de tareas con contratos explícitos**, ejecuta a los agentes en **entornos aislados (Git worktrees)**, valida los resultados sobre **commits exactos (Evidence Matrix)** y los recompone de abajo hacia arriba (**bottom-up integration**), garantizando que ningún cambio no verificado llegue a la rama principal.”

---

## 2. La Frontera Arquitectónica: Probabilístico vs. Determinista

El núcleo del diseño de ManyHands consiste en **separar la creatividad probabilística de los modelos de las garantías deterministas de la ingeniería de software**:

```
[ ZONA PROBABILÍSTICA ]           [ FRONTERA ]           [ ZONA DETERMINISTA ]
  LLM / Agentes                   Contratos              Validadores y Git
  - Propone tareas (Breakdown)    - Schemas (Zod)        - Graph Compiler (IDs)
  - Escribe código (Attempt)      - Scopes               - Sandboxing (Worktree)
  - Argumenta decisiones          - SHAs exactos         - Evidence Matrix
```

* **El agente propone, el sistema dispone:** El LLM nunca escribe directamente en el historial de producción, nunca decide el flujo de estados de una tarea, ni asigna IDs a los nodos. Todo lo que hace es proponer candidatos que el orquestador valida contra reglas estrictas.

---

## 3. El Recorrido de un "Run": Paso a Paso

Un **run** es la unidad de producto y el ciclo de vida de una ejecución. El dato fluye a través de las siguientes fases:

```
Goal ➔ Grounding ➔ Planning ➔ Compilación ➔ Scheduling ➔ Ejecución ➔ Validación ➔ Integración ➔ Delivery
```

1. **Goal:** El usuario ingresa un objetivo de desarrollo en lenguaje natural.
2. **Grounding:** Se construye un `RepositorySnapshot` (estructuras, dependencias y archivos reales) para que el plan no asuma archivos inexistentes.
3. **Planning (IA):** El planner descompone el objetivo en un `WorkBreakdown` (jerarquía de tareas y contratos de dependencias).
4. **Compilación (Determinista):** El `GraphCompiler` valida el breakdown con Zod, asigna identificadores inmutables a los nodos y compila la estructura en un `GraphRevision` (un DAG).
5. **Scheduling:** El `Scheduler` evalúa qué tareas están listas (**readiness**) basándose en el flujo de dependencias materiales (nodos padres/hijos) y de restricciones horizontales.
6. **Ejecución (Isolated Attempts):** Las hojas listas se despachan concorrentemente en **waves**. Cada intento se corre en un `Git worktree` aislado con su propia `ExecutionBase` (que sólo materializa los archivos que tiene permitido tocar según su **scope contract**).
7. **Validación:** El agente genera un *candidate commit*. Los validadores corren pruebas automáticas directamente sobre ese SHA del commit y construyen la `EvidenceMatrix` vinculando cada obligación contractual con su evidencia de ejecución real.
8. **Integración (Bottom-Up):** Los candidatos válidos y vigentes son adoptados en el `ArtifactRegistry`. Se integran de abajo hacia arriba utilizando un `IntegrationManifest` para mezclar las ramas y resolver seams de compatibilidad.
9. **Delivery:** El orquestador une el árbol completo validado, lo publica y genera un `DeliveryReceipt` inmutable que marca el run como `completed`.

---

## 4. Tabla de Conceptos Clave (Equivalencias e Invariantes)

Aprende esta tabla de memoria. Te permitirá mapear conceptos abstractos con su implementación real en el código:

| Concepto Abstracto | ¿Qué es en la práctica? | Invariante de Seguridad / Garantía |
| :--- | :--- | :--- |
| **Run** | Directorio persistido con un archivo de eventos (`.jsonl`). | Unidad de producto. Reconstruible en memoria mediante replay de eventos. |
| **RepositorySnapshot** | Representación en memoria de la estructura de archivos y tests del proyecto. | Grounding. Evita que el planner invente código en rutas inexistentes. |
| **WorkBreakdown** | JSON estructurado devuelto por el LLM. | Propuesta semántica. No tiene poder directo sobre el lifecycle de ejecución. |
| **GraphRevision** | Estructura en forma de DAG con IDs deterministas de tipo UUID. | Inmutabilidad del plan. No puede modificarse sin generar una nueva revisión. |
| **ArtifactRequirement** | Relación de dependencia entre un nodo que produce un archivo y otro que lo lee. | Flujo material de dependencias. Evita ejecutar tareas antes de que existan sus entradas. |
| **ExecutionBase** | Un commit sintético que sirve de punto de partida para el agente. | Aislamiento de entradas. El agente sólo ve los archivos que declara en su contrato. |
| **Git Worktree** | Un directorio temporal en el disco (`tmp/worktrees/...`) enlazado a la rama de Git. | Aislamiento físico de ejecución. Los agentes no se pisan entre sí al correr concurrentemente. |
| **InputFingerprint** | Un hash SHA-256 de todas las entradas (código base, dependencias, prompts). | Vigencia. Si el código base del que partió un agente cambió, el resultado queda *stale* (obsoleto). |
| **EvidenceMatrix** | Mapeo de criterios exigidos por contrato vs. resultados del comando de test ejecutado. | Evidencia sobre SHA exacto. No basta con que "los tests den verde", deben dar verde sobre el commit exacto. |
| **IntegrationManifest** | Archivo estructurado que guía el merge jerárquico de las ramas de Git. | Integración bottom-up ordenada. Protege las fronteras de integración. |
| **RunCoordinator** | Una máquina de estados lógica (en `packages/run-coordinator`). | Única autoridad del ciclo de vida. Evita carreras concurrentes y estados corruptos. |

---

## 5. Garantías de Concurrencia y Durabilidad (CAS, Leases y Fencing)

ManyHands está diseñado para correr en un host local-first pero su lógica está preparada para resistir fallos de concurrencia distribuidos. Utiliza tres invariantes:

* **Event Sourcing:** El estado no se actualiza in-place. Todo cambio genera un evento que se escribe al final del *journal* (`.jsonl`). El estado actual es simplemente el pliegue (*fold*) de toda la historia.
* **CAS (Compare-And-Swap):** Toda escritura al journal verifica que la versión actual coincida con la esperada. Evita que dos hilos agreguen eventos conflictivos simultáneamente.
* **Leases (Arrendamiento):** Un coordinator toma la autoridad de ejecución por un tiempo limitado. Debe renovar periódicamente el lease.
* **Fencing (Cercado):** Si un proceso de ejecución se queda trabado y un nuevo coordinator toma el mando (al vencerse el lease), este nuevo coordinador incrementa el token de fencing. El proceso viejo será bloqueado cuando intente escribir cualquier resultado usando su token obsoleto.

---

## 6. Q&A Relámpago (Preguntas de Examen de 30 Segundos)

### P1: ¿Por qué no usar LangGraph o frameworks similares para la orquestación?
> **Respuesta:** "LangGraph se utilizó históricamente en el prototipo para la exploración del plan, pero se reemplazó por completo por un `RunCoordinator` desacoplado y un compilador de grafos determinista en TypeScript. Los grafos de agentes y flujo de control del LLM no deben ser dueños de la persistencia, la concurrencia ni del lifecycle de una entrega de software. Mantenerlos detrás de un puerto (adapters) garantiza que la lógica de estados de negocio sea robusta y testeable de forma aislada."

### P2: ¿Por qué es tan crítico validar sobre el commit (SHA) exacto?
> **Respuesta:** "Porque en desarrollo de software con agentes concurrentes, validar otra copia, otra rama o el mismo código con cambios posteriores rompe el vínculo causal entre la afirmación de éxito y la evidencia real. Si evaluamos sobre un SHA diferente al candidato producido, la Evidence Matrix pierde toda autoridad y es posible integrar regresiones o estados intermedios inconsistentes."

### P3: ¿Cómo maneja el sistema la granularidad de las tareas en el plan?
> **Respuesta:** "El planner del sistema propone un `WorkBreakdown` que soporta diferentes niveles de granularidad (`coarse`, `balanced`, `fine`, `auto`). El modo `auto` busca un balance adaptativo basándose en la cohesión y tamaño de los módulos del repositorio, pero se presenta en el proyecto como una capacidad exploratoria. En la práctica, el tamaño de las tareas es un trade-off clásico de ingeniería de software: tareas muy finas aumentan el costo de integración, y tareas muy gruesas disminuyen el paralelismo y aumentan el riesgo de fallo en el agente."

### P4: ¿Qué pasa si un agente se cae o la computadora se apaga a mitad de un run?
> **Respuesta:** "El sistema tiene recuperación por causa. En caso de crash completo del sistema o caída del proceso host, el orquestador reconstruye el estado actual volviendo a leer el *journal* de eventos persistido (replay). Al retomar, se verifican las carpetas de los *worktrees* y los commits candidatos generados. Como los estados de ejecución de las waves están guardados en el diario, el planificador puede reiniciar o retomar únicamente las tareas interrumpidas, sin repetir el trabajo ya integrado."

### P5: ¿Cómo evitaría que un agente borre todo el disco o robe credenciales?
> **Respuesta:** "Es el principio del contrato de alcance o *scope contract*. ManyHands aplica un filtro prohibitivo absoluto (*deny-wins*). Al compilar el plan de un nodo, el orquestador materializa en el *Git worktree* únicamente los archivos declarados que la tarea necesita leer o escribir. Además, un proceso supervisor intercepta y compara el diff generado por el agente antes de crear el commit. Si el agente modificó archivos fuera de su scope autorizado, el commit candidato es descartado inmediatamente y la tarea se marca como fallida por violación de contrato."
