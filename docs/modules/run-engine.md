# Guía Arquitectónica: @manyhands/run-engine

> **Ubicación en el Monorepo**: `packages/run-engine/`  
> **README del Paquete**: [`../../packages/run-engine/README.md`](../../packages/run-engine/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas de ejecución duradera donde las corridas pueden extenderse durante horas o requerir intervención humana, la gestión del estado en memoria y la coordinación de efectos secundarios físicos (procesos, llamadas a LLMs, mutaciones en Git) presentan riesgos severos de carreras y estados inconsistentes si múltiples comandos interactúan concurrentemente sobre la misma corrida.

**`@manyhands/run-engine`** es el kernel de ejecución duradera de ManyHands basado en el **Modelo de Actores**. Administra el ciclo de vida de las corridas en el daemon local, garantiza la invariante de escritor único (*single-writer*) mediante buzones secuenciales en memoria, orquesta el despacho transaccional de efectos físicos mediante un patrón outbox en dos fases y reconcilia determinísticamente los efectos pendientes tras interrupciones o caídas del sistema.

### Problemas Fundamentales que Resuelve

1. **Modelo de Actores por Corrida (`RunActor`)**: Asigna como máximo una instancia de actor en memoria por cada `runId`. Cada actor posee un buzón secuencial (*sequential mailbox queue*) que procesa comandos de forma estrictamente serializada, eliminando condiciones de carrera.
2. **Despacho Transaccional de Efectos Físicos (`EffectDispatcher`)**: Orquesta las mutaciones con efectos secundarios en el sistema operativo mediante un protocolo outbox en dos fases con intención previa obligatoria (`EffectIntent`).
3. **Reconciliación y Recuperación de Fallos (`recoverPendingEffects`)**: Al reiniciar el daemon o instanciar un actor tras una caída, escanea el journal en busca de efectos no terminales y consulta los oráculos del sistema operativo para reconciliar el estado sin duplicar trabajo ni corromper repositorios.
4. **Fachada de Aplicación Unificada (`DurableRunEngine`)**: Expone una interfaz de alto nivel para `apps/daemon` que valida sobres de comandos (`RunCommandEnvelope`), devuelve recibos criptográficos (`CommandReceipt`) y provee consultas libres de efectos colaterales leyendo directamente del journal canónico.

---

## 2. Arquitectura Interna y Componentes

El código fuente en `src/` comprende los siguientes módulos:

```
packages/run-engine/src/
├── index.ts                    # Barrel export unificado
├── durable-run-engine.ts       # DurableRunEngine: fachada de consultas, suscripciones y envío de comandos
├── run-actor.ts                # RunActor: actor de dominio por corrida con mailbox secuencial
├── run-actor-registry.ts       # RunActorRegistry: registro en memoria y ciclo de vida de instancias de actores
├── effect-dispatcher.ts        # KindAwarePhysicalEffectDispatcher: enrutador de efectos hacia adaptadores
├── physical-effect-adapters.ts # Adaptadores físicos para LLMs, Sandboxes, Git, Artefactos y Procesos
└── run-event-journal.ts        # Adaptador entre el journal canónico (run-store) y el puerto del actor
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `durable-run-engine.ts` | Punto de entrada principal para el daemon. Implementa `submit(command)` (validando la identidad criptográfica del sobre y emitiendo el recibo), `query(runId)` (reconstruyendo la proyección vía `foldRun`) y `eventsReady(runId, afterSequence)` (para streaming SSE paginado). |
| `run-actor.ts` | Máquina de estados operativa de la corrida. Administra el buzón secuencial de comandos, la persistencia de intenciones (`EffectIntent`), la invocación de funciones de decisión (`decide`), la reacción a observaciones de efectos (`react`) y el drenado de tareas (`drainEffects`). |
| `run-actor-registry.ts` | Administra el mapa en memoria de actores (`Map<string, Promise<RunActor>>`). Asegura que solo exista una instancia viva por corrida y ejecuta `recoverPendingEffects()` inmediatamente tras instanciar cada actor. |
| `effect-dispatcher.ts` | Implementa `KindAwarePhysicalEffectDispatcher`. Despacha intenciones de efecto a adaptadores especializados según su tipo canónico (`EffectKind`), gestiona colas en vuelo y asegura la persistencia inmutable de recibos (`PhysicalEffectReceipt`). |
| `physical-effect-adapters.ts` | Colección de adaptadores para efectos del sistema: llamadas a LLMs, sandboxes, mutaciones Git, materialización de artefactos, validación, entrega y limpieza. |
| `run-event-journal.ts` | Implementa `RunActorJournalPort` conectando el actor con `JsonlRunEventStore` de `@manyhands/run-store`, asegurando la verificación de tokens de fencing y `epoch` del daemon. |

---

## 3. Flujos de Control y Datos

### Modelo de Actores y Buzón Secuencial

```
                        Comandos Externos (apps/daemon)
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
            submit(commandA)                      submit(commandB)
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      RunActor.mailbox (Promise Queue)                  │
│                                                                        │
│   [Op 1: accept(commandA)] ──► [Op 2: accept(commandB)]                │
│             │                                                          │
│             ▼                                                          │
│   1. Valida autoridad de epoch y fencing                               │
│   2. Valida expectedRevision                                           │
│   3. Ejecuta decide(command, context)                                  │
│   4. Persiste EffectIntent en outbox y command.accepted en journal     │
│   5. Retorna CommandReceipt firmado                                    │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Despacho de Efectos Físicos                           │
│                                                                        │
│   RunActor ──► EffectDispatcher ──► Physical Effect Adapter (OS/Git)   │
│                   │                         │                          │
│                   │ (Persiste Intención)    ▼                          │
│                   │                  Ejecuta Mutación Física           │
│                   │                         │                          │
│                   │◄────────────────────────┘                          │
│                   │ (Retorna PhysicalEffectReceipt)                    │
│                   ▼                                                    │
│   Persiste effect.completed en .events.v2.jsonl                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Clases e Interfaces Principales

| Símbolo | Tipo | Propósito |
|---|---|---|
| `DurableRunEngine` | Clase | Fachada principal del motor para procesamiento de comandos, consultas y streaming de eventos. |
| `RunActor` | Clase | Actor de dominio que administra el buzón secuencial y el ciclo de vida de una corrida. |
| `RunActorRegistry` | Clase | Registro y administrador del ciclo de vida de instancias de actores en memoria. |
| `KindAwarePhysicalEffectDispatcher` | Clase | Despachador y enrutador de intenciones de efectos hacia adaptadores físicos especializados. |
| `FencedRunActorJournal` | Clase | Adaptador que vincula un `RunActor` con un `FencedRunEventStore` preservando la autoridad de escritor único. |
| `RunActorJournalPort` | Interfaz | Puerto de persistencia de eventos utilizado por el actor. |
| `RunActorDispatcherPort` | Interfaz | Puerto de despacho y reconciliación de efectos físicos. |
| `PhysicalEffectAdapter` | Interfaz | Contrato que implementa cada adaptador de efectos (`execute` y `reconcile`). |

### Fábricas de Adaptadores Físicos

- `createModelCallPhysicalEffectAdapter`: Llamadas a modelos LLM con oráculo terminal.
- `createSandboxCreatePhysicalEffectAdapter`: Creación y aislamiento de sandboxes efímeros.
- `createGitMutationPhysicalEffectAdapter`: Mutaciones seguras sobre referencias privadas de Git.
- `createArtifactMaterializePhysicalEffectAdapter`: Materialización de artefactos por manifiesto.
- `createValidationPhysicalEffectAdapter`: Ejecución y atestación de suites de validación.
- `createDeliveryPhysicalEffectAdapter`: Publicación y entrega de resultados verificados.
- `createCleanupPhysicalEffectAdapter`: Limpieza de recursos temporales y sandboxes.

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Modelo de Actores y Mailbox Secuencial
Para evitar condiciones de carrera cuando múltiples clientes o llamadas de API interactúan con la misma corrida, `RunActor` utiliza una cola de promesas encadenadas:
- Cada comando entrante se encola en el buzón secuencial.
- Si dos comandos llegan concurrentemente, el segundo se suspende de forma asíncrona hasta que el primero haya completado su transacción atómica en el journal y actualizado el número de revisión de la corrida.

### 2. Despacho de Efectos Físicos en Dos Fases (Two-Phase Outbox)
Ninguna mutación en el sistema de archivos, Git o subprocesos se ejecuta sin antes haber quedado registrada en el outbox duradero:
1. **Intención Duradera (`effect.requested`)**: El actor calcula el digest del input, lo persiste en `FileEffectInputStore` y escribe el evento `effect.requested` en el journal canónico.
2. **Ejecución y Recibo (`effect.completed`)**: El adaptador ejecuta la acción física y emite un `PhysicalEffectReceipt` inmutable con hash canónico, permitiendo al actor registrar `effect.completed` o `effect.failed`.

### 3. Reconciliación Determinista ante Reinicios (Crash Recovery)
Si el daemon se interrumpe durante una mutación física:
1. Al reiniciarse, `RunActorRegistry` instancia el actor y llama a `recoverPendingEffects()`.
2. El actor carga todos los eventos del journal e identifica intenciones (`effect.requested`) que carecen de un evento terminal.
3. Para cada intención pendiente, el despachador invoca `adapter.reconcile()`.
4. El adaptador inspecciona los oráculos del sistema operativo (por ejemplo, verificando si el proceso en Windows Job Object sigue vivo o si el árbol Git fue creado).
5. Si la operación completó antes de la caída, adopta el resultado existente; si quedó a medio camino, la reanuda o limpia el estado de forma segura.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 2 / GD0+GD1 y Stage 3 / GR)**: El motor de actores duraderos, la fachada `DurableRunEngine`, el outbox de efectos y la reconciliación ante reinicios y cancelaciones están completamente cerrados y certificados en `docs/audits/stage-2/` y `docs/audits/stage-3/`.
2. **Desacoplamiento de Web**: La aplicación web (`apps/web`) no posee actores ni ejecuta promesas en segundo plano; se comunica con `DurableRunEngine` exclusivamente a través del servidor IPC del daemon.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/run-engine/README.md`](../../packages/run-engine/README.md)
- **Módulos Relacionados**:
  - [`run-coordinator.md`](./run-coordinator.md): Definición de máquinas de decisión (`decide`/`react`) y eventos canónicos.
  - [`run-store.md`](./run-store.md): Journal canónico de eventos y almacén de outbox de efectos.
  - [`execution-core.md`](./execution-core.md): Adaptadores físicos de ejecución, sandboxes y validación.
  - [`daemon.md`](./daemon.md): Proceso anfitrión que hospeda el `DurableRunEngine`.
- **Documentación Central**: [`../README.md`](../README.md)
