# @manyhands/run-store

Capa de persistencia canónica, almacenamiento de eventos duraderos en formato JSONL, outbox inmutable de efectos físicos direccionado por contenido, bloqueos duraderos con fencing tokens y compactación por generaciones para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/run-store` es la autoridad de persistencia y durabilidad del sistema ManyHands. En la arquitectura basada en Event Sourcing y monolito local duradero:

1. **Persistencia Canónica de Eventos de Dominio**: Almacena la historia authoritative de cada corrida en un journal append-only (`.events.v2.jsonl`). Toda mutación en el ciclo de vida de una corrida (creación, planificación, intentos, validación, adopción de artefactos y entrega) existe como una secuencia ordenada de `RunEvent`.
2. **Patrón Outbox Duradero para Efectos Físicos**: Garantiza la idempotencia y seguridad ante reinicios inesperados (*crash recovery*) mediante `FileEffectInputStore` y `FilePhysicalEffectReceiptStore`. Los inputs de efectos se persisten en disco con `fsync` y digest SHA-256 antes de iniciar cualquier mutación externa en el sistema operativo (Git, subprocesos, sandboxes).
3. **Exclusión Mutua y Fencing Tokens**: Provee locks de archivo duraderos (`acquireDurableLock`) con leases temporales y tokens de fencing (`FencingAuthority`), garantizando que un único escritor (*single-writer*) posea la autoridad sobre el log de eventos y previniendo escrituras concurrentes o extemporáneas (*split-brain*).
4. **Compactación por Generaciones**: Mediante `EventStoreCompactor`, genera instantáneas intermedias inmutables (`generation-N.snapshot.json`) acompañadas por manifiestos con checksum SHA-256, reduciendo los tiempos de replay y manteniendo acotado el tamaño del log activo.
5. **Reconstrucción Determinista de Proyecciones**: Expone funciones de reducción y pliegue lineal (`foldRunEvents`, `reduceRunEvents`) para proyectar el estado (`RunProjection`) a partir de la historia persistida sin duplicaciones innecesarias de memoria.

---

## 2. Arquitectura Modular Interna

El código fuente en `src/` se organiza en los siguientes módulos especializados:

```
packages/run-store/src/
├── index.ts                # Barrel export unificado
├── event-store.ts          # Interfaces de FencedRunEventStore, FencingAuthority y jerarquía de errores
├── jsonl-event-store.ts    # Implementación JsonlRunEventStore (JSONL append-only, fsync, checksums y truncation)
├── event-upcaster.ts       # Migración y upcasting de versiones de esquemas de eventos
├── durable-file.ts         # Escrituras atómicas a disco (atomicWriteFile / atomicWriteJson) con fsync y reintentos
├── durable-lock.ts         # Bloqueos de exclusión duraderos con lease, heartbeat y recuperación de stale locks
├── effect-input-store.ts   # FileEffectInputStore: almacenamiento inmutable direccionado por contenido de inputs de efectos
├── effect-receipt-store.ts # FilePhysicalEffectReceiptStore: almacenamiento inmutable de recibos de efectos físicos
├── attempt-store.ts        # JsonlAttemptStore: registro inmutable de intentos de ejecución
├── artifact-store.ts       # JsonlArtifactStore: registro inmutable de artefactos adoptados
├── snapshot-store.ts       # RunSnapshotStore: almacenamiento y carga de snapshots reconstruibles
├── projection-fold.ts      # Funciones puras foldRunEvents y reduceRunEvents optimizadas para replay lineal
├── compactor.ts            # EventStoreCompactor y utilidades de manifiestos de generación
├── recovery.ts             # Reconciliación de journals y recuperación de efectos pendientes tras caídas
└── migrations.ts           # Utilidades de migración de esquema
```

### Desglose Detallado por Módulo

- **`event-store.ts`**: Define la interfaz `FencedRunEventStore`, la estructura `FencingAuthority` (`operationId`, `fencingToken`) y los errores canónicos (`SequenceConflictError`, `StaleFencingTokenError`, `CorruptRunEventLogError`).
- **`jsonl-event-store.ts`**: Implementa `JsonlRunEventStore`, manejando la persistencia física en `.events.v2.jsonl`, serialización de batches, validación de secuencias, cálculo de firmas de almacenamiento (`StorageSignature`), detección y truncamiento de líneas incompletas al final del archivo (`truncateIncompleteTrailingLine`) y vinculación con `RunEventJournalPort`.
- **`durable-file.ts`**: Implementa `atomicWriteFile` y `atomicWriteJson`. Escribe en un archivo temporal (`*.tmp.<pid>.<uuid>`), ejecuta `fsync` en el descriptor de archivo, realiza rename atómico con backoff exponencial y jitter ante bloqueos de Windows (`EBUSY`, `EPERM`, `EACCES`), y sincroniza el directorio padre.
- **`durable-lock.ts`**: Implementa `acquireDurableLock`. Crea un directorio de bloqueo con `owner.json` conteniendo PID, timestamp y token único. Mantiene un temporizador de renovación periódica (*heartbeat*) y detecta/recupera bloqueos obsoletos (*stale locks*) mediante cuarentena atómica.
- **`effect-input-store.ts`**: Implementa `FileEffectInputStore`. Almacena especificaciones canónicas `EffectInput` indexadas por su digest criptográfico SHA-256. Publica archivos temporales mediante hard-links atómicos (`link()`) para asegurar que dos escritores concurrentes no se sobrescriban.
- **`effect-receipt-store.ts`**: Implementa `FilePhysicalEffectReceiptStore`. Persiste recibos físicos `PhysicalEffectReceipt` validados contra sus hashes de identidad canónica, utilizando nombres de archivo deterministas y publicación con hard-link.
- **`attempt-store.ts`**: Implementa `JsonlAttemptStore`. Gestiona el archivo inmutable `.attempts.v2.jsonl` por corrida, asegurando que un intento (`AttemptRecord`) no pueda ser reescrito con contenido divergente.
- **`artifact-store.ts`**: Implementa `JsonlArtifactStore`. Registra artefactos adoptados (`AdoptedArtifact`) en `.artifacts.v2.jsonl` bajo exclusión mutua.
- **`snapshot-store.ts`**: Implementa `RunSnapshotStore` para guardar y recuperar estados proyectados completos, acelerando la inicialización de vistas de usuario.
- **`compactor.ts`**: Implementa `EventStoreCompactor`. Evalúa umbrales de eventos activos, consolida la historia en una instantánea inmutable (`.generation-<N>.snapshot.json`), escribe el manifiesto (`.compaction-manifest.v1.json`) con checksum y vacía el journal activo de forma atómica.
- **`projection-fold.ts`**: Expone `foldRunEvents` y `reduceRunEvents`. Optimiza el cómputo de la proyección evitando la clonación recurrente de la lista de auditoría `appliedEventIds`.
- **`event-upcaster.ts`**: Upcaster determinista que normaliza eventos de esquemas anteriores a la versión actual (`CURRENT_EVENT_SCHEMA_VERSION = 2`).
- **`recovery.ts`**: Inspecciona journals y recupera efectos en vuelo (`recoverPendingEffects`) tras caídas del proceso o reinicios del daemon.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Event Sourcing Canónico y Autoridad de Fencing

La arquitectura de ManyHands desacopla los hechos de dominio de las proyecciones efímeras. El log `.events.v2.jsonl` es la única fuente de verdad autoritativa:

```
  Actor / Writer
        │
        ▼ (appendFenced con FencingAuthority)
┌─────────────────────────────────────────────────────────┐
│                 JsonlRunEventStore                      │
│  1. withLock(runId) ──► acquireDurableLock              │
│  2. assertAuthority(authority) (valida token de fence)  │
│  3. inspectCached(runId) (valida sequence esperada)     │
│  4. atomic append en .events.v2.jsonl con fsync         │
│  5. reduceRunEvents (actualiza proyección en memoria)   │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
                    .events.v2.jsonl
```

Cada llamada a `appendFenced` exige:
- `expectedSequence`: Verifica que el escritor posea la vista exacta del último evento registrado. Si la secuencia en disco diverge, lanza `SequenceConflictError`.
- `FencingAuthority`: Verifica que el `fencingToken` del escritor coincida con el registro `.fence.v2.json`. Si otro actor incrementó el fence tras asumir la autoridad de la corrida, el escritor anterior recibe `StaleFencingTokenError`.

### 3.2. Outbox Duradero de Efectos Físicos (Two-Phase Effect Outbox)

Las interacciones con el mundo real (mutaciones en Git, creación de procesos o acceso a sandboxes) no son transaccionales por naturaleza. Para evitar inconsistencias ante cortes de energía o caídas del daemon, `run-store` aplica un patrón Outbox en dos fases:

1. **Fase de Intención (Pre-mutación)**:
   - Se crea el `EffectInput` estructurado.
   - `FileEffectInputStore.put()` lo persiste en `runs-v2/effect-inputs/<sha256>.effect-input.json` mediante escritura atómica con `fsync` y hard-link.
   - Se emite el evento `effect.requested` en el event journal.
2. **Fase de Observación y Recibo (Post-mutación)**:
   - Se ejecuta la operación física en el sistema operativo.
   - Se registra el resultado en `FilePhysicalEffectReceiptStore.put()`.
   - Se emite el evento `effect.completed` o `effect.failed`.

### 3.3. Bloqueos Duraderos con Heartbeat y Reclamación de Stale Locks

`acquireDurableLock` implementa exclusión mutua basada en el sistema de archivos:
- **Creación Atómica**: Utiliza `mkdir(lockPath, { recursive: false })` que falla atómicamente con `EEXIST` si el bloqueo ya fue adquirido por otro proceso.
- **Heartbeat de Renovación**: Actualiza periódicamente los tiempos de acceso y modificación (`utimes`) del directorio.
- **Reclamación Segura de Bloqueos Obsoletos**: Si un proceso muere abruptamente sin liberar el lock, los competidores detectan que `Date.now() - mtime > staleAfterMs`. La reclamación mueve el directorio a una ruta de cuarentena (`*.stale.<uuid>`) antes de borrarlo, evitando eliminar accidentalmente a un nuevo adquirente que haya entrado concurrentemente.

### 3.4. Compactación por Generaciones y Tolerancia a Fallos

Cuando el número de eventos en el journal activo supera el umbral (`threshold`), `EventStoreCompactor`:
1. Vuelca la historia completa en `.generation-<N>.snapshot.json`.
2. Escribe el manifiesto `.compaction-manifest.v1.json` con el checksum SHA-256 de la instantánea.
3. Vacía el archivo activo `.events.v2.jsonl`.
4. Si el sistema colapsa entre los pasos 2 y 3, `JsonlRunEventStore.inspect` detecta los eventos duplicados basándose en los números de secuencia y los unifica sin pérdida ni corrupción de datos.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Clases, Funciones y Schemas

| Símbolo | Tipo | Archivo | Descripción |
|---|---|---|---|
| `JsonlRunEventStore` | Clase | `jsonl-event-store.ts` | Almacén principal de eventos en formato JSONL con soporte de fencing y caching. |
| `FileEffectInputStore` | Clase | `effect-input-store.ts` | Almacén inmutable de inputs de efectos direccionado por contenido. |
| `FilePhysicalEffectReceiptStore` | Clase | `effect-receipt-store.ts` | Almacén inmutable de recibos de efectos físicos. |
| `EventStoreCompactor` | Clase | `compactor.ts` | Compactador de journals por generaciones inmutables. |
| `JsonlArtifactStore` | Clase | `artifact-store.ts` | Almacén inmutable de artefactos adoptados en formato JSONL. |
| `JsonlAttemptStore` | Clase | `attempt-store.ts` | Almacén inmutable de registros de intentos en formato JSONL. |
| `RunSnapshotStore` | Clase | `snapshot-store.ts` | Persistencia y recuperación de snapshots completos de proyección. |
| `acquireDurableLock` | Función | `durable-lock.ts` | Adquiere un lock duradero exclusivo con lease y renovación automática. |
| `atomicWriteFile` | Función | `durable-file.ts` | Escritura atómica a disco con rename seguro, reintentos y fsync. |
| `atomicWriteJson` | Función | `durable-file.ts` | Serialización JSON y escritura atómica a disco. |
| `foldRunEvents` | Función | `projection-fold.ts` | Pliega una lista de eventos para generar la `RunProjection` inicial. |
| `reduceRunEvents` | Función | `projection-fold.ts` | Reduce nuevos eventos sobre una `RunProjection` existente. |
| `recoverPendingEffects` | Función | `recovery.ts` | Recupera y reconcilia efectos en estado pendiente tras una caída del proceso. |

### 4.2. Jerarquía de Errores Tipados

| Clase de Error | Condición de Disparo |
|---|---|
| `SequenceConflictError` | La secuencia esperada (`expectedSequence`) no coincide con el cursor del log. |
| `StaleFencingTokenError` | El token de fencing proporcionado fue revocado o superado por otra autoridad. |
| `CorruptRunEventLogError` | El archivo de journal contiene líneas inválidas o checksums corruptos no recuperables. |
| `EffectInputCorruptionError` | El contenido o identidad del input de efecto en disco difiere de su digest canónico. |
| `PhysicalEffectReceiptCorruptionError` | El recibo de efecto físico en disco no supera la validación canónica de identidad. |
| `ImmutableArtifactConflictError` | Intento de registrar un artefacto con el mismo ID pero contenido divergente. |
| `ImmutableAttemptConflictError` | Intento de registrar un intento con el mismo ID pero contenido divergente. |

### 4.3. Ejemplo de Uso: Escritura Fenced y Persistencia de Efectos

```typescript
import {
  JsonlRunEventStore,
  FileEffectInputStore,
  foldRunEvents,
  type FencingAuthority
} from "@manyhands/run-store";
import { createHash } from "node:crypto";
import type { DigestHasher } from "@manyhands/contracts";

// 1. Configurar el DigestHasher canónico
const hasher: DigestHasher = (data: string) =>
  `sha256:${createHash("sha256").update(data, "utf8").digest("hex")}`;

// 2. Instanciar almacenes
const eventStore = new JsonlRunEventStore({ directory: ".manyhands/runs-v2" });
const effectInputStore = new FileEffectInputStore({
  directory: ".manyhands/runs-v2/effect-inputs",
  hasher
});

const runId = "run-2026-08-18-001";
const operationId = "daemon-worker-1";

// 3. Reclamar autoridad de escritura (Fencing Token)
const authority: FencingAuthority = await eventStore.claimAuthority(runId, operationId);
console.log(`Autoridad reclamada: token=${authority.fencingToken}`);

// 4. Registrar un input de efecto en el outbox antes de ejecutarlo
const effectInput = await effectInputStore.put({
  kind: "git_mutation",
  repoRoot: process.cwd(),
  targetBranch: "manyhands/attempt-1",
  baseCommit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
});

// 5. Agregar eventos al log de forma segura y atómica
const appendedEvents = await eventStore.appendFenced(runId, 0, authority, [
  {
    eventId: "evt-001",
    runId,
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: "run.created",
    payload: {
      goal: "Implementar autenticación OAuth2"
    }
  },
  {
    eventId: "evt-002",
    runId,
    sequence: 2,
    occurredAt: new Date().toISOString(),
    type: "effect.requested",
    payload: {
      intent: {
        effectId: "eff-100",
        runId,
        kind: "git_mutation",
        inputDigest: effectInput.inputDigest,
        daemonEpoch: operationId,
        idempotency: "reconcile_then_repeat",
        requestedAt: new Date().toISOString()
      }
    }
  }
]);

// 6. Proyectar el estado resultante
const projection = foldRunEvents(appendedEvents);
console.log(`Estado proyectado de la corrida: ${projection.lifecycle}`);
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

En correspondencia con el plan maestro normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Sección 9.13 y Stage 11):

| Aspecto | Estado de Rediseño | Observaciones |
|---|---|---|
| **Formato JSONL canónico** | Stage 11 ✅ | Eventos `.events.v2.jsonl` y registros inmutables `.attempts.v2.jsonl` / `.artifacts.v2.jsonl` plenamente funcionales. |
| **Fencing y Single-Writer** | Stage 11 ✅ | `claimAuthority` y `appendFenced` garantizan autoridad exclusiva por corrida. |
| **Outbox de Efectos Físicos** | Stage 11 ✅ | `FileEffectInputStore` y `FilePhysicalEffectReceiptStore` operativos con direccionamiento por contenido y `link()` atómico. |
| **Compactación de Logs** | Stage 11 ✅ | `EventStoreCompactor` genera instantáneas con checksum SHA-256 e invalidación de caché. |
| **Consolidación de Autoridad en Daemon** | En progreso 🔄 | La autoridad de escritura migra de la aplicación Next.js hacia el actor `RunActor` gestionado por `apps/daemon` y `@manyhands/run-engine`. |

---

## 6. Comandos de Verificación y Testing

Para verificar los tipos estáticos y compilar los bundles de distribución de `@manyhands/run-store`:

```bash
# Verificación estática de tipos TypeScript
pnpm --filter @manyhands/run-store typecheck

# Compilación de paquetes (ESM, CJS y definiciones TypeScript DTS)
pnpm --filter @manyhands/run-store build
```
