# @manyhands/run-engine

Motor de ejecución duradera basado en el Modelo de Actores para el daemon local de ManyHands, administración del ciclo de vida de corridas, despacho transaccional de efectos físicos y reconciliación determinista ante caídas.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/run-engine` constituye el kernel de ejecución duradera en el daemon local de ManyHands. Mientras que `@manyhands/run-coordinator` define la semántica de dominio pura y `@manyhands/run-store` provee la persistencia física en disco, `@manyhands/run-engine` coordina activamente la ejecución en memoria y las interacciones físicas:

1. **Modelo de Actores por Corrida (`RunActor`)**: Asigna como máximo una instancia de actor en memoria por cada `runId`. Cada actor posee un buzón secuencial (*mailbox queue*) que procesa comandos de forma estrictamente serializada, garantizando la invariante de escritor único (*single-writer*) y eliminando condiciones de carrera.
2. **Despacho Transaccional de Efectos Físicos (`EffectDispatcher`)**: Orquesta las mutaciones con efectos secundarios en el sistema operativo (llamadas a modelos LLM, creación de worktrees y sandboxes, mutaciones en Git, materialización de artefactos y ejecuciones de procesos) mediante un patrón outbox de dos fases con intención previa obligatoria.
3. **Reconciliación y Recuperación de Fallos (`recoverPendingEffects`)**: Al reiniciar el daemon o instanciar un actor tras una interrupción o corte de energía, el motor escanea el journal de eventos en busca de efectos no terminales y consulta los oráculos del sistema operativo para reconciliar o reanudar el estado sin duplicar trabajo ni corromper repositorios.
4. **Fachada de Aplicación Unificada (`DurableRunEngine`)**: Expone una interfaz de alto nivel para `apps/daemon` que valida sobres de comandos (`RunCommandEnvelope`), devuelve recibos criptográficos (`CommandReceipt`) y provee consultas de estado (`query`, `eventsReady`) libres de efectos colaterales leyendo directamente del journal canónico.

---

## 2. Arquitectura Modular Interna

El código fuente en `src/` comprende los siguientes módulos:

```
packages/run-engine/src/
├── index.ts                    # Barrel export unificado
├── durable-run-engine.ts       # DurableRunEngine: fachada de consultas, suscripciones y envío de comandos
├── run-actor.ts                # RunActor: actor de dominio por corrida con mailbox secuencial y gestión de revisiones
├── run-actor-registry.ts       # RunActorRegistry: registro en memoria y ciclo de vida de instancias de actores
├── effect-dispatcher.ts        # KindAwarePhysicalEffectDispatcher: enrutador de efectos físicos hacia adaptadores
├── physical-effect-adapters.ts # Adaptadores físicos para LLMs, Sandboxes, Git, Materialización de Artefactos y Procesos
└── run-event-journal.ts        # Adaptador entre el journal canónico (run-store) y el puerto del actor (RunActorJournalPort)
```

### Desglose Detallado por Archivo

- **`durable-run-engine.ts`**:
  - `DurableRunEngine`: Punto de entrada principal para el daemon. Implementa `submit(command)` (validando la identidad criptográfica del sobre y del recibo), `query(runId)` (reconstruyendo la proyección pura vía `foldRun`) y `eventsReady(runId, afterSequence)` (para streaming paginado a clientes).
  - Interfaces: `DurableRunEngineOptions`, `DurableRunEngineActor`, `DurableRunEngineActorRegistry`, `RunEventPage`.
- **`run-actor.ts`**:
  - `RunActor`: Máquina de estados operativa de la corrida. Maneja la aceptación de comandos (`accept`), cálculo de revisiones esperadas, persistencia de intenciones (`EffectIntent`), invocación de funciones de decisión (`decide`), reacción a observaciones de efectos (`react`) y vaciado de tareas en segundo plano (`drainEffects`).
  - Interfaces: `RunActorOptions`, `RunActorJournalPort`, `RunActorDispatcherPort`, `RunActorDecision`, `RunActorReaction`, `RunActorTerminalObservation`.
- **`run-actor-registry.ts`**:
  - `RunActorRegistry`: Administra el mapa en memoria `Map<string, Promise<RunActor>>`. Garantiza que solo exista una instancia viva por `runId`, invoca la autoridad de instalación y ejecuta `recoverPendingEffects()` inmediatamente tras instanciar el actor.
- **`effect-dispatcher.ts`**:
  - `KindAwarePhysicalEffectDispatcher`: Implementación de `RunActorDispatcherPort`. Despacha intenciones de efecto a adaptadores especializados según su tipo canónico (`EffectKind`), gestiona colas en vuelo por `effectId` y garantiza la persistencia inmutable de recibos (`PhysicalEffectReceipt`).
  - Puertos e interfaces: `PhysicalEffectAdapter`, `PhysicalEffectAdapterContext`, `EffectInputStorePort`, `PhysicalEffectReceiptStorePort`, `EffectDispatchInvalidationPort`.
- **`physical-effect-adapters.ts`**:
  - Colección de adaptadores para efectos del sistema generados mediante funciones de fábrica (`createModelCallPhysicalEffectAdapter`, `createSandboxCreatePhysicalEffectAdapter`, `createGitMutationPhysicalEffectAdapter`, `createArtifactMaterializePhysicalEffectAdapter`, `createValidationPhysicalEffectAdapter`, `createDeliveryPhysicalEffectAdapter`, `createCleanupPhysicalEffectAdapter`). Cada adaptador implementa `PhysicalEffectAdapter` definiendo métodos `execute` y `reconcile` basados en oráculos de inspección estricta.
- **`run-event-journal.ts`**:
  - Implementa `RunActorJournalPort` conectando el actor con `JsonlRunEventStore` de `@manyhands/run-store`, asegurando la verificación de tokens de fencing y `epoch` del daemon.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Modelo de Actores y Mailbox Secuencial

Para evitar condiciones de carrera cuando múltiples clientes o llamadas de API intentan interactuar con la misma corrida, `RunActor` utiliza una cola de promesas encadenadas (*sequential mailbox*):

```
                        Comandos Externos
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
     submit(commandA)                      submit(commandB)
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RunActor.mailbox                           │
│                      (Promise Queue)                            │
│                                                                 │
│   [Op 1: accept(commandA)] ──► [Op 2: accept(commandB)]         │
│             │                                                   │
│             ▼                                                   │
│   1. assertAuthority(epoch)                                     │
│   2. validate expectedRevision                                  │
│   3. execute decide(command, context)                           │
│   4. persist EffectIntent & command.accepted                    │
│   5. return CommandReceipt                                      │
└─────────────────────────────────────────────────────────────────┘
```

Si dos comandos llegan concurrentemente, el segundo se suspende de forma asíncrona hasta que el primero haya completado su transacción atómica en el journal y actualizado el número de revisión de la corrida.

### 3.2. Despacho de Efectos Físicos en Dos Fases (Two-Phase Outbox)

Ninguna mutación en el sistema de archivos, Git o subprocesos se ejecuta sin antes haber quedado registrada de forma inmutable en el journal:

1. **Intención Duradera (`effect.requested`)**: El actor calcula el digest del input (`EffectInputSpec`), lo persiste en `FileEffectInputStore` y escribe el evento `effect.requested` en `.events.v2.jsonl`.
2. **Ejecución y Recibo (`effect.observed` / `effect.completed`)**: El `EffectDispatcher` delega en el adaptador correspondiente. El adaptador ejecuta la acción física y emite un `PhysicalEffectReceipt` inmutable con hash canónico, permitiendo al actor registrar `effect.completed` o `effect.failed`.

```
  RunActor                   EffectDispatcher             Physical Adapter (OS/Git)
     │                              │                                │
     ├─── 1. persist intent ───────►│                                │
     │    (effect.requested)        │                                │
     ├─── 2. observe(intent) ──────►│                                │
     │                              ├─── 3. execute mutation ───────►│
     │                              │                                │
     │                              │◄── 4. return receipt ──────────┤
     │◄── 5. resolve receipts ──────┤                                │
     │                              │                                │
     ├─── 6. persist completion ───►│                                │
     │    (effect.completed)        │                                │
```

### 3.3. Reconciliación Determinista ante Reinicios (Crash Recovery)

Si el daemon colapsa durante la ejecución de una mutación externa:
1. Al reiniciarse, `RunActorRegistry` instancia el actor y llama a `recoverPendingEffects()`.
2. El actor carga todos los eventos del journal y busca intenciones (`effect.requested`) que carezcan de un evento terminal (`effect.completed` o `effect.failed`).
3. Para cada intención pendiente, el despachador invoca `adapter.reconcile()`.
4. El adaptador inspecciona el estado real del sistema operativo (por ejemplo, verificando si el proceso en Windows Job Object sigue vivo o si el árbol Git fue creado).
5. Si la operación completó antes de la caída, adopta el resultado existente; si quedó a medio camino, la reanuda o limpia el estado de forma segura.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Clases, Interfaces y Puertos

| Símbolo | Tipo | Archivo | Descripción |
|---|---|---|---|
| `DurableRunEngine` | Clase | `durable-run-engine.ts` | Fachada principal del motor para procesamiento de comandos y consultas. |
| `RunActor` | Clase | `run-actor.ts` | Actor de dominio que administra el buzón secuencial y el ciclo de vida de una corrida. |
| `RunActorRegistry` | Clase | `run-actor-registry.ts` | Registro y administrador del ciclo de vida de actores en memoria. |
| `KindAwarePhysicalEffectDispatcher` | Clase | `effect-dispatcher.ts` | Despachador y enrutador de intenciones de efectos hacia adaptadores físicos. |
| `FencedRunActorJournal` | Clase | `run-event-journal.ts` | Adaptador que vincula un `RunActor` con un `FencedRunEventStore` preservando la autoridad de escritura única. |
| `RunActorJournalPort` | Interfaz | `run-actor.ts` | Puerto de persistencia de eventos utilizado por el actor. |
| `RunActorDispatcherPort` | Interfaz | `run-actor.ts` | Puerto de despacho y reconciliación de efectos físicos. |
| `PhysicalEffectAdapter` | Interfaz | `effect-dispatcher.ts` | Contrato que implementa cada adaptador de efectos (`execute` y `reconcile`). |
| `createModelCallPhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para llamadas a modelos LLM con oráculo terminal. |
| `createSandboxCreatePhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para creación y aislamiento de sandboxes. |
| `createGitMutationPhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para mutaciones seguras de Git sobre referencias privadas. |
| `createArtifactMaterializePhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para materialización de artefactos por manifiesto. |
| `createValidationPhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para ejecución y atestación de suites de validación. |
| `createDeliveryPhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para publicación y entrega de resultados verificados. |
| `createCleanupPhysicalEffectAdapter` | Función | `physical-effect-adapters.ts` | Fábrica de adaptador para limpieza de recursos efímeros y sandboxes. |

### 4.2. Ejemplo de Uso: Envío de Comandos y Consultas

```typescript
import {
  DurableRunEngine,
  RunActorRegistry,
  RunActor,
  KindAwarePhysicalEffectDispatcher
} from "@manyhands/run-engine";
import { JsonlRunEventStore, FileEffectInputStore, FilePhysicalEffectReceiptStore } from "@manyhands/run-store";
import { createHash } from "node:crypto";
import type { DigestHasher } from "@manyhands/contracts";

// 1. Configurar hasher canónico SHA-256
const hasher: DigestHasher = (data: string) =>
  `sha256:${createHash("sha256").update(data, "utf8").digest("hex")}`;

// 2. Instanciar almacenes duraderos
const eventStore = new JsonlRunEventStore({ directory: ".manyhands/runs-v2" });
const inputStore = new FileEffectInputStore({ directory: ".manyhands/runs-v2/effect-inputs", hasher });
const receiptStore = new FilePhysicalEffectReceiptStore({ directory: ".manyhands/runs-v2/effect-receipts", hasher });

// 3. Configurar el despachador de efectos físicos y el registro de actores
const dispatcher = new KindAwarePhysicalEffectDispatcher({
  receiptStore,
  inputStore,
  hasher,
  adapters: [] // Lista de adaptadores físicos configurados
});

const actorRegistry = new RunActorRegistry({
  assertInstallationAuthority: async () => {},
  claimRunAuthority: async (runId) => eventStore.claimAuthority(runId, "daemon-1"),
  createActor: (runId, authority) => new RunActor({
    runId,
    daemonEpoch: "epoch-1",
    journal: {
      load: (id) => eventStore.load(id),
      assertAuthority: async (id) => eventStore.assertAuthority(id, authority),
      appendAndFlush: async ({ runId: id, expectedRevision, events }) =>
        eventStore.appendFenced(id, expectedRevision, authority, events)
    },
    dispatcher,
    inputStore,
    decide: async () => ({ effects: [] }),
    hasher,
    clock: () => new Date().toISOString()
  })
});

// 4. Instanciar el motor duradero
const engine = new DurableRunEngine({
  actorRegistry,
  eventStore,
  assertInstallationAuthority: async () => {},
  hasher
});

// 5. Consultar el estado proyectado de una corrida
const projection = await engine.query("run-2026-08-18-001");
console.log(`Estado de la corrida: ${projection.lifecycle}, Secuencia: ${projection.sequence}`);
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

En concordancia con el plan normativo de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Secciones 9.12 y 9.13, Stages 2, 3 y 11):

| Componente | Estado de Rediseño | Observaciones |
|---|---|---|
| **Actor Model Runtime** | Stage 2 / 3 ✅ | `RunActor` con mailbox secuencial y autoridad de escritura exclusiva operativo. |
| **Two-Phase Effect Outbox** | Stage 3 ✅ | Persistencia obligatoria de `EffectIntent` antes de ejecutar mutaciones físicas implementada. |
| **Adaptadores Físicos y Oráculos** | Stage 11 ✅ | Adaptadores de Git, Sandboxes, LLMs, Procesos y Materialización de Artefactos integrados. |
| **Reconciliación tras Crash** | Stage 11 ✅ | `recoverPendingEffects` valida y reconcilia efectos incompletos al levantar el actor. |
| **Migración desde Web Host** | En progreso 🔄 | La lógica de coordinación histórica que residía en `apps/web` y `orchestrator-graph` está migrando hacia este paquete y `apps/daemon`. |

---

## 6. Comandos de Verificación y Testing

Para verificar los tipos estáticos y compilar `@manyhands/run-engine`:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/run-engine typecheck

# Compilación de paquetes (ESM y CJS con declaraciones DTS)
pnpm --filter @manyhands/run-engine build
```
