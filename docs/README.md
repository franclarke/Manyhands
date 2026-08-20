# Hub Central de Arquitectura y Documentación: ManyHands

Bienvenido al centro neurálgico de arquitectura y navegación técnica de **ManyHands**. Este documento proporciona la visión global del sistema, el mapa del ciclo de vida de ejecución, la matriz de dependencias entre todos los componentes y el índice exhaustivo de guías técnicas para desarrolladores, investigadores y operadores.

---

## 1. Visión Global y Principios de Correctness-First

ManyHands es un sistema de ingeniería de software multi-agente diseñado bajo una premisa fundamental: **la corrección arquitectónica prima sobre la cantidad de agentes o el tamaño del árbol de tareas**.

> **Principio Rector**: ManyHands optimiza para incrementos de producto independientemente implementables y jerárquicamente verificables. El tamaño del grafo es una consecuencia observada de límites reales de software, nunca un objetivo ni una métrica de éxito.

### Pilares Fundamentales del Sistema

1. **La Corrida (`Run`) como Unidad de Producto**: Cada interacción de desarrollo se modela como una corrida formal, persistida como una secuencia append-only de eventos inmutables en un journal duradero (`.events.v2.jsonl`).
2. **Grafo Híbrido Semántico**: El trabajo se organiza en un grafo dirigido acíclico jerárquico (`GraphRevision`):
   - **Nodo Raíz**: Vinculado al `GoalContract` y a los criterios de aceptación del usuario.
   - **Nodos Composites**: Delimitan fronteras de subsistemas o módulos y poseen autoridad para integrar artefactos y resolver archivos compartidos.
   - **Nodos Hoja (*Leaves*)**: Unidades atómicas de implementación con responsabilidades y límites de alcance (*scope*) estrictos.
3. **Identidad Causal e Inmutabilidad**: Cada contrato, intento (*Attempt*) y artefacto se identifica mediante un digest SHA-256 sobre su serialización canónica (`canonicalJson`). Los intentos son inmutables y se identifican por su `InputFingerprint`.
4. **Matriz de Evidencia Jerárquica**: Los resultados no se aprueban por la simple ausencia de errores en un log. Cada criterio de aceptación exige pruebas reproducibles sobre candidatos exactos de Git, complementadas con **controles negativos** para demostrar sensibilidad y **validación estática de AST** para neutralizar la manipulación de pruebas.
5. **Monolito Modular Local y Desacoplamiento de Seguridad**: Un daemon duradero local (`apps/daemon`) custodia el estado y los procesos del sistema operativo. La interfaz web (`apps/web`) actúa como un cliente BFF (*Backend-for-Frontend*) que se comunica exclusivamente mediante IPC autenticado con HMAC-SHA256, protegiendo al operador contra ataques web (*DNS Rebinding* y *CSRF*).

---

## 2. Mapa Integral del Ciclo de Vida de una Corrida

El ciclo de vida de ManyHands transforma un requerimiento en lenguaje natural en un resultado de software integrado y verificado en Git a través de 7 fases estructuradas:

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 1. PLANIFICACIÓN Y GROUNDING                                                     │
 │    • repository-index: Inspecciona blobs Git y extrae RepositoryModel.           │
 │    • decomposer: PlanningEngine evalúa GranularityPolicy y verifyPlan.           │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ Emite SemanticPlan + GoalContract
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 2. DEFINICIÓN DE CONTRATOS Y GRAFO DE TAREAS                                     │
 │    • contracts: Construye TaskContractBundles (Scope, Seams, Artifacts).         │
 │    • task-graph: Compila GraphRevision inmutable y valida ResourceAuthority.     │
 │    • shared: Provee primitivas, modelo epistémico y registro de ejecutores.      │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ GraphRevision + Bundles
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 3. PLANIFICACIÓN DE EJECUCIÓN Y CONFLICTOS                                       │
 │    • scheduler: evaluateReadiness verifica precondiciones duras.                 │
 │    • conflict-risk: Estima riesgo consultivo en selectFrontier (olas continuas). │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ Olas de Nodos Listos para Despacho
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 4. AISLAMIENTO Y EJECUCIÓN EN SANDBOX                                            │
 │    • execution-core: ExecutionBaseBuilder materializa ChangeSets en Git.         │
 │    • windows-job-runner: Custodia procesos en Win32 Job Objects (sin leaks).     │
 │    • windows-ipc-acl: Aplica DACLs protegidas y custodia Named Pipes locales.    │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ ChangeSetManifests + Validation Evidence
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 5. PERSISTENCIA Y TELEMETRÍA CANÓNICA                                            │
 │    • run-store: Persiste eventos en .events.v2.jsonl y outbox de efectos.        │
 │    • trace-store: Registra telemetría con redacción automática de secretos.      │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ Proyección Reducida (RunProjection)
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 6. MOTOR DE EJECUCIÓN Y COORDINACIÓN                                             │
 │    • run-engine: RunActor con buzón secuencial para escritor único (Single-Writer│
 │    • run-coordinator: Reductor puro (reduceRun) y manejo de 42 eventos.          │
 │    • orchestrator-graph: Conduce iteración de olas y clausura de artefactos.     │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ Estado Listo / Decisión Requerida
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ 7. APLICACIONES HOST Y BFF                                                       │
 │    • daemon: Proceso privilegiado, lease de instalación y servidor IPC HMAC.     │
 │    • web: Command Center y Cockpit reactivo con @xyflow/react sin saltos visuales│
 └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Matriz de Interacción y Dependencias del Monorepo

ManyHands sigue una jerarquía de dependencias estricta: `apps -> packages -> shared` (Capa Cero).

### Diagrama de Relaciones entre los 17 Subsistemas

```
                      ┌──────────┐      ┌─────────┐
                      │ apps/web │ ◄──► │  apps/  │
                      └────┬─────┘(IPC) │ daemon  │
                           │            └────┬────┘
                           ▼                 │
                 ┌───────────────────┐       │ (Hospeda / Invoca)
                 │  run-coordinator  │ ◄─────┤
                 └─────────┬─────────┘       │
                           │                 ▼
                 ┌─────────┴─────────┐  ┌──────────────┐
                 │    run-engine     │  │  run-store   │
                 └─────────┬─────────┘  └──────┬───────┘
                           │                   │
         ┌─────────────────┼───────────────────┤
         ▼                 ▼                   ▼
┌──────────────────┐┌──────────────┐┌──────────────────────┐
│orchestrator-graph││  scheduler   ││     trace-store      │
└────────┬─────────┘└──────┬───────┘└──────────────────────┘
         │                 │
         ▼                 ▼
┌──────────────────┐┌──────────────┐
│  execution-core  ││conflict-risk │
└────────┬─────────┘└──────┬───────┘
         │                 │
         ├─────────────────┼────────────────────────┐
         ▼                 ▼                        ▼
┌──────────────────┐┌──────────────┐     ┌──────────────────────┐
│    decomposer    ││  task-graph  │     │  windows-job-runner  │ (Rust)
└────────┬─────────┘└──────┬───────┘     └──────────────────────┘
         │                 │             ┌──────────────────────┐
         ▼                 ▼             │   windows-ipc-acl    │ (Rust)
┌──────────────────┐┌──────────────┐     └──────────────────────┘
│ repository-index ││  contracts   │                ▲
└────────┬─────────┘└──────┬───────┘                │
         │                 │                        │
         └────────┬────────┘                        │
                  ▼                                 │
         ┌──────────────────┐                       │
         │      shared      ├───────────────────────┘
         │    (Layer 0)     │
         └──────────────────┘
```

---

## 4. Índice Central de Módulos (17 Subsistemas)

A continuación se indexan las 17 guías arquitectónicas detalladas disponibles en `docs/modules/`:

| Módulo | Tipo y Ubicación | Guía Arquitectónica | README del Módulo | Responsabilidad Principal |
|---|---|---|---|---|
| **contracts** | Paquete (`packages/contracts`) | [`modules/contracts.md`](modules/contracts.md) | [`../packages/contracts/README.md`](../packages/contracts/README.md) | Contratos inmutables, esquemas Zod, serialización canónica y protocolo de efectos en la frontera de confianza. |
| **task-graph** | Paquete (`packages/task-graph`) | [`modules/task-graph.md`](modules/task-graph.md) | [`../packages/task-graph/README.md`](../packages/task-graph/README.md) | Modelo inmutable de revisiones de grafo (`GraphRevision`), relaciones tipadas y verificación de autoridad de recursos (`checkResourceAuthority`). |
| **shared** | Paquete (`packages/shared`) | [`modules/shared.md`](modules/shared.md) | [`../packages/shared/README.md`](../packages/shared/README.md) | Capa cero sin dependencias: primitivas tipadas, modelo epistémico formal, registro de ejecutores y wrappers seguros de procesos CLI. |
| **decomposer** | Paquete (`packages/decomposer`) | [`modules/decomposer.md`](modules/decomposer.md) | [`../packages/decomposer/README.md`](../packages/decomposer/README.md) | Motor de planificación progresiva (`PlanningEngine`), política de granularidad 4.0, verificación de 8 invariantes y compilador directo a grafos. |
| **repository-index** | Paquete (`packages/repository-index`) | [`modules/repository-index.md`](modules/repository-index.md) | [`../packages/repository-index/README.md`](../packages/repository-index/README.md) | Modelado semántico basado en Git (`RepositoryModel`), catálogo de recursos (`ResourceCatalog`) y consultas presupuestadas con honestidad epistémica. |
| **scheduler** | Paquete (`packages/scheduler`) | [`modules/scheduler.md`](modules/scheduler.md) | [`../packages/scheduler/README.md`](../packages/scheduler/README.md) | Motor puro de evaluación continua de disponibilidad (*readiness*) y selección del frente ejecutable sin barreras de fases monolíticas. |
| **conflict-risk** | Paquete (`packages/conflict-risk`) | [`modules/conflict-risk.md`](modules/conflict-risk.md) | [`../packages/conflict-risk/README.md`](../packages/conflict-risk/README.md) | Análisis estático predictivo de interferencias par a par basado en superposición de rutas, símbolos y dependencias de AST. |
| **execution-core** | Paquete (`packages/execution-core`) | [`modules/execution-core.md`](modules/execution-core.md) | [`../packages/execution-core/README.md`](../packages/execution-core/README.md) | Materialización de ChangeSets en Git, sandboxing, validación por matriz de evidencia, detección de tests manipulados y entrega CAS. |
| **run-store** | Paquete (`packages/run-store`) | [`modules/run-store.md`](modules/run-store.md) | [`../packages/run-store/README.md`](../packages/run-store/README.md) | Persistencia autoritativa en `.events.v2.jsonl` con fsync, outbox duradero de efectos en 2 fases, fencing tokens y compactación por generaciones. |
| **trace-store** | Paquete (`packages/trace-store`) | [`modules/trace-store.md`](modules/trace-store.md) | [`../packages/trace-store/README.md`](../packages/trace-store/README.md) | Almacén persistente de telemetría y diagnóstico con sobres checksummed y redacción recursiva automática de secretos. |
| **run-engine** | Paquete (`packages/run-engine`) | [`modules/run-engine.md`](modules/run-engine.md) | [`../packages/run-engine/README.md`](../packages/run-engine/README.md) | Kernel de ejecución duradera basado en el Modelo de Actores (`RunActor`), buzón secuencial para escritor único y reconciliación ante caídas. |
| **run-coordinator** | Paquete (`packages/run-coordinator`) | [`modules/run-coordinator.md`](modules/run-coordinator.md) | [`../packages/run-coordinator/README.md`](../packages/run-coordinator/README.md) | Núcleo de dominio puro, catálogo canónico de 42 eventos, reductor inmutable (`reduceRun`), huellas `InputFingerprint` y decisiones desacopladas. |
| **orchestrator-graph** | Paquete (`packages/orchestrator-graph`) | [`modules/orchestrator-graph.md`](modules/orchestrator-graph.md) | [`../packages/orchestrator-graph/README.md`](../packages/orchestrator-graph/README.md) | Driver canónico de bucle de olas sobre `GraphRevision`, clausura de artefactos requeridos e invariantes de exclusión concurrente. |
| **daemon** | Aplicación (`apps/daemon`) | [`modules/daemon.md`](modules/daemon.md) | [`../apps/daemon/README.md`](../apps/daemon/README.md) | Proceso anfitrión privilegiado, guarda de tickets de Lamport para exclusión de instalación, servidor IPC local seguro con HMAC y supervisor de workers. |
| **web** | Aplicación (`apps/web`) | [`modules/web.md`](modules/web.md) | [`../apps/web/README.md`](../apps/web/README.md) | Command Center, Run Cockpit reactivo con `@xyflow/react` sin saltos visuales, cliente BFF y frontera de seguridad perimetral contra DNS Rebinding y CSRF. |
| **windows-job-runner** | Nativo (`native/windows-job-runner`) | [`modules/windows-job-runner.md`](modules/windows-job-runner.md) | [`../native/windows-job-runner/README.md`](../native/windows-job-runner/README.md) | Ejecutable nativo en Rust puro para custodia estricta de subprocesos mediante Win32 Job Objects anidados y emisión de recibos firmados. |
| **windows-ipc-acl** | Nativo (`native/windows-ipc-acl`) | [`modules/windows-ipc-acl.md`](modules/windows-ipc-acl.md) | [`../native/windows-ipc-acl/README.md`](../native/windows-ipc-acl/README.md) | Herramienta nativa en Rust puro para protección de DACLs (`SE_DACL_PROTECTED`), defensa contra reparse points y proxying seguro de Named Pipes. |

---

## 5. Rutas de Lectura Recomendadas (*Reading Paths*)

Para abordar la comprensión del monorepo según el rol o interés técnico específico:

### Ruta 1: Desarrollador de Motor y Runtime
*Enfocada en el ciclo de vida de eventos, concurrencia, persistencia y el modelo de actores.*
1. [`modules/contracts.md`](modules/contracts.md) (Contratos, serialización e identidades)
2. [`modules/run-coordinator.md`](modules/run-coordinator.md) (Catálogo de eventos y reductor de estado)
3. [`modules/run-engine.md`](modules/run-engine.md) (Modelo de actores y despacho de efectos)
4. [`modules/run-store.md`](modules/run-store.md) (Persistencia duradera en JSONL y fencing tokens)
5. [`modules/scheduler.md`](modules/scheduler.md) (Evaluación continua del frente ejecutable)
6. [`modules/daemon.md`](modules/daemon.md) (Servidor de composición y autoridad de instalación)

### Ruta 2: Ingeniero de Modelos, Planificación y Descomposición
*Enfocada en cómo los requerimientos se transforman en grafos de tareas fundamentados en código.*
1. [`modules/shared.md`](modules/shared.md) (Primitivas, modelo epistémico y registro de ejecutores)
2. [`modules/repository-index.md`](modules/repository-index.md) (Modelo semántico de Git, catálogo de recursos y consultas presupuestadas)
3. [`modules/decomposer.md`](modules/decomposer.md) (Motor de planificación progresivo, granularidad 4.0 y compilación directa)
4. [`modules/task-graph.md`](modules/task-graph.md) (Estructura inmutable de `GraphRevision` y autoridad de recursos)
5. [`modules/conflict-risk.md`](modules/conflict-risk.md) (Análisis de interferencias y predicción de colisiones)

### Ruta 3: Ingeniero de Infraestructura, Sandboxing y Seguridad Nativa
*Enfocada en aislamiento de procesos, protección de memoria y seguridad del sistema operativo.*
1. [`modules/shared.md`](modules/shared.md) (Mitigación DEP0190 y terminación en árbol)
2. [`modules/windows-job-runner.md`](modules/windows-job-runner.md) (Custodia Win32 con Job Objects anidados)
3. [`modules/windows-ipc-acl.md`](modules/windows-ipc-acl.md) (DACLs protegidas y seguridad de Named Pipes)
4. [`modules/execution-core.md`](modules/execution-core.md) (Materialización Git, CredentialBroker y validación exacta)
5. [`modules/daemon.md`](modules/daemon.md) (Servidor IPC local autenticado con HMAC-SHA256)

### Ruta 4: Desarrollador de Frontend y Experiencia de Usuario
*Enfocada en la visualización reactiva de grafos, Server-Sent Events y accesibilidad.*
1. [`modules/run-coordinator.md`](modules/run-coordinator.md) (Modelo de eventos y proyecciones de corrida)
2. [`modules/task-graph.md`](modules/task-graph.md) (Niveles topológicos presentacionales y relaciones visuales)
3. [`modules/web.md`](modules/web.md) (Command Center, Cockpit en `@xyflow/react`, frontera de seguridad y SSE)

---

## 6. Fuentes de Verdad y Estado Normativo

El diseño y desarrollo de ManyHands se rige por una jerarquía estricta de autoridad documental:

1. **[`../PRODUCT.md`](../PRODUCT.md)**: Propósito de producto, usuarios objetivo y principios estables de experiencia.
2. **[`plans/2026-08-12-correctness-first-system-redesign.md`](plans/2026-08-12-correctness-first-system-redesign.md)**: La **única arquitectura normativa y plan de implementación vigente**.
3. **[`agents/`](agents/)**: Protocolos de ejecución y flujo de trabajo para agentes de desarrollo (incluyendo el runbook de ejecución).
4. **[`tesis/`](tesis/)**: Material académico y evidencia histórica atribuible (no define la arquitectura actual).

### Estado de Implementación por Etapas (Stages)

| Stage | Nombre | Estado | Evidencia de Cierre |
|---|---|---|---|
| **Stage 0** | Baseline & Required Cells | `pass` | [`audits/stage-0/`](audits/stage-0/) (Stage 0 baseline, trace de ruta productiva, transition ledger y required-cell registry; 18 recibos de calificación y GO review). |
| **Stage 1** | Canonical Correctness Kernel | `pass` | [`audits/stage-1/`](audits/stage-1/) (122 tests dedicados de contratos y grafos). |
| **Stage 2** | Durable Daemon & Effect Kernel | `pass` | [`audits/stage-2/`](audits/stage-2/) (228 tests de persistencia, outbox y fencing). |
| **Stage 3** | Productive Daemon & Cancellation | `pass` | [`audits/stage-3/`](audits/stage-3/) (Pruebas de browser, reinicios y cancelación concurrente). |
| **Stage 4** | Grounding & Repository Model | `pass` | [`audits/stage-4/`](audits/stage-4/) (Modelo determinista sobre repositorios reales). |
| **Stage 5** | Semantic Planner & Direct Compiler | `pass` | [`audits/stage-5/`](audits/stage-5/) (97 tests de planificación y 8 invariantes). |
| **Stage 6** | Continuous Execution Frontier | `pass` | [`audits/stage-6/`](audits/stage-6/) (Readiness determinista y selectFrontier). |
| **Stage 7** | Exact Artifacts & Validation Matrix | `pass` | [`audits/stage-7/`](audits/stage-7/) (48 tests de artefactos y 78 de validación). |
| **Stage 8** | Sandboxed Leaf Execution | `in_review` | [`audits/stage-8/`](audits/stage-8/) (Evidencia R0/R10/R14/R17). |
| **Stage 9** | Composite Integration Attempt | `in_review` | [`audits/stage-9/`](audits/stage-9/) (Propiedad de convergencia paralelo-secuencial). |
| **Stage 10** | Transactional CAS Delivery | `in_review` | [`audits/stage-10/README.md`](audits/stage-10/README.md) (7 invariantes de entrega y 5 celdas de restart; no cierra antes de GLeaf y GI). |
| **Stages 11–13** | Observability, Architecture & Prod | `in_progress` | [`plans/2026-08-15-remaining-stages-to-gprod.md`](plans/2026-08-15-remaining-stages-to-gprod.md) (Stages 11/GObs and 12/GArch passed; Stage 13/GProd is active). |

### Handoffs de Transición Históricos y Estudios

Los siguientes documentos registran los límites de continuación formal entre etapas y los planes de estudio longitudinal:

- [`handoffs/2026-08-12-stage-2-to-stage-3.md`](handoffs/2026-08-12-stage-2-to-stage-3.md): Límite de continuación histórica utilizado para iniciar Stage 3.
- [`handoffs/2026-08-13-stage-3-to-stage-4.md`](handoffs/2026-08-13-stage-3-to-stage-4.md): Límite de continuación histórica utilizado para iniciar Stage 4 / GRepo.
- [`handoffs/2026-08-13-stage-4-to-stage-5.md`](handoffs/2026-08-13-stage-4-to-stage-5.md): Límite de continuación histórica utilizado para iniciar Stage 5 / GP0+GP1.
- [`handoffs/2026-08-13-stage-5-to-stage-6.md`](handoffs/2026-08-13-stage-5-to-stage-6.md): Límite de continuación histórica para iniciar Stage 6.
- [`handoffs/2026-08-14-stage-6-to-stage-7.md`](handoffs/2026-08-14-stage-6-to-stage-7.md): Límite de continuación formal para iniciar Stage 7 / GA.
- [`plans/2026-08-13-exploratory-longitudinal-study.md`](plans/2026-08-13-exploratory-longitudinal-study.md): Estudio exploratorio longitudinal post-GProd (dos corridas visuales obligatorias y una condicional).
- [`experiments/2026-08-20-viaje-en-familia-final.md`](experiments/2026-08-20-viaje-en-familia-final.md): Protocolo congelado del experimento final R19, sus oráculos y el loop de repositorios/workspaces descartables.
