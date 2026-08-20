# Guía Arquitectónica: @manyhands/run-store

> **Ubicación en el Monorepo**: `packages/run-store/`  
> **README del Paquete**: [`../../packages/run-store/README.md`](../../packages/run-store/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas distribuidos y monolitos modulares locales que gestionan procesos largos y mutaciones en el sistema operativo, la persistencia suele ser el eslabón más frágil ante caídas inesperadas (*crashes*), cortes de energía o reinicios de proceso. Si un sistema no desacopla los hechos de dominio de los efectos colaterales en el sistema operativo, corre el riesgo de duplicar trabajo, corromper repositorios o generar estados incoherentes (*split-brain*).

**`@manyhands/run-store`** es la autoridad de persistencia y durabilidad canónica de ManyHands. Implementa un modelo de **Event Sourcing estricto** sobre archivos JSONL append-only, un outbox duradero para efectos físicos direccionado por contenido, bloqueos con tokens de *fencing* para garantizar la autoridad de escritor único (*single-writer*) y compactación por generaciones inmutables.

### Problemas Fundamentales que Resuelve

1. **Persistencia Canónica de Eventos de Dominio (`JsonlRunEventStore`)**: Toda mutación en el ciclo de vida de una corrida se almacena como una secuencia ordenada e inmutable de eventos (`RunEvent`) en `.events.v2.jsonl` con sincronización forzada a disco (`fsync`).
2. **Patrón Outbox Duradero en Dos Fases para Efectos Físicos (`FileEffectInputStore`, `FilePhysicalEffectReceiptStore`)**: Los inputs de efectos se persisten en disco con hash SHA-256 antes de iniciar cualquier acción en el sistema operativo (Git, subprocesos, llamadas a LLMs), permitiendo una reconciliación determinista ante caídas.
3. **Exclusión Mutua y Fencing Tokens (`FencingAuthority`)**: Previene condiciones de carrera y escrituras concurrentes o extemporáneas mediante bloqueos duraderos (`acquireDurableLock`) y verificación de tokens de fencing monótonos.
4. **Compactación por Generaciones Inmutables (`EventStoreCompactor`)**: Consolida la historia de eventos en instantáneas intermedias (`generation-N.snapshot.json`) con manifiestos checksummed, manteniendo acotado el tamaño del log activo y acelerando los tiempos de replay.
5. **Reconstrucción Determinista de Proyecciones (`foldRunEvents`, `reduceRunEvents`)**: Funciones de pliegue lineal optimizadas que proyectan el estado (`RunProjection`) a partir de la historia persistida.

---

## 2. Arquitectura Interna y Componentes

El código fuente en `src/` se organiza en los siguientes módulos especializados:

```
packages/run-store/src/
├── index.ts                # Barrel export unificado
├── event-store.ts          # Interfaces de FencedRunEventStore, FencingAuthority y jerarquía de errores
├── jsonl-event-store.ts    # Implementación JsonlRunEventStore (JSONL append-only, fsync, checksums y truncation)
├── event-upcaster.ts       # Migración y upcasting de versiones de esquemas de eventos
├── durable-file.ts         # Escrituras atómicas a disco (atomicWriteFile / atomicWriteJson) con fsync y reintentos
├── durable-lock.ts         # Bloqueos de exclusión duraderos con lease, heartbeat y recuperación de stale locks
├── effect-input-store.ts   # FileEffectInputStore: almacenamiento inmutable direccionado por contenido de inputs
├── effect-receipt-store.ts # FilePhysicalEffectReceiptStore: almacenamiento inmutable de recibos físicos
├── attempt-store.ts        # JsonlAttemptStore: registro inmutable de intentos de ejecución
├── artifact-store.ts       # JsonlArtifactStore: registro inmutable de artefactos adoptados
├── snapshot-store.ts       # RunSnapshotStore: almacenamiento y carga de snapshots reconstruibles
├── projection-fold.ts      # Funciones puras foldRunEvents y reduceRunEvents optimizadas para replay lineal
├── compactor.ts            # EventStoreCompactor y utilidades de manifiestos de generación
├── recovery.ts             # Reconciliación de journals y recuperación de efectos pendientes tras caídas
└── migrations.ts           # Utilidades de migración de esquema
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `event-store.ts` | Define la interfaz `FencedRunEventStore`, la estructura `FencingAuthority` (`operationId`, `fencingToken`) y los errores canónicos (`SequenceConflictError`, `StaleFencingTokenError`, `CorruptRunEventLogError`). |
| `jsonl-event-store.ts` | Implementa `JsonlRunEventStore`, gestionando el archivo `.events.v2.jsonl`, validación de números de secuencia, truncamiento de líneas incompletas al final del archivo (`truncateIncompleteTrailingLine`) y caching en memoria. |
| `durable-file.ts` | Implementa `atomicWriteFile` y `atomicWriteJson`. Escribe en un temporal, ejecuta `fsync`, realiza rename atómico con backoff exponencial y sincroniza el directorio padre. |
| `durable-lock.ts` | Implementa `acquireDurableLock` mediante `mkdir` atómico, heartbeat de renovación y cuarentena segura de bloqueos obsoletos (*stale locks*). |
| `effect-input-store.ts` | Almacena especificaciones `EffectInput` indexadas por su digest SHA-256 (`runs-v2/effect-inputs/<sha256>.effect-input.json`) mediante hard-links atómicos. |
| `effect-receipt-store.ts` | Almacena recibos `PhysicalEffectReceipt` validados contra sus hashes de identidad canónica mediante hard-links inmutables. |
| `compactor.ts` | Implementa `EventStoreCompactor`. Consolida la historia en una instantánea inmutable (`.generation-<N>.snapshot.json`), emite el manifiesto `.compaction-manifest.v1.json` y vacía el log activo. |
| `projection-fold.ts` | Expone `foldRunEvents` y `reduceRunEvents`, optimizadas para evitar clonaciones innecesarias durante el replay lineal. |
| `recovery.ts` | Reconcilia efectos en vuelo (`recoverPendingEffects`) tras caídas del daemon o reinicios inesperados. |

---

## 3. Flujos de Control y Datos

### Flujo de Escritura Fenced y Outbox de Efectos Físicos

```
  RunActor (apps/daemon)
        │
        ▼ (1. appendFenced con FencingAuthority)
┌─────────────────────────────────────────────────────────┐
│                 JsonlRunEventStore                      │
│  • withLock(runId) ──► acquireDurableLock               │
│  • assertAuthority(fencingToken)                        │
│  • inspectCached(expectedSequence)                      │
│  • atomic append en .events.v2.jsonl con fsync          │
│  • reduceRunEvents (actualiza proyección en memoria)    │
└───────────────────────────┬─────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
        ▼                                       ▼
.events.v2.jsonl                     Persistencia de Intención
(Hecho Canónico de Dominio)         (FileEffectInputStore)
                                                │
                                                ▼  (Mutación en OS/Git)
                                    Persistencia de Recibo Físico
                                    (FilePhysicalEffectReceiptStore)
                                                │
                                                ▼
                                    Evento effect.completed
                                    en .events.v2.jsonl
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Clases e Interfaces Principales

| Símbolo | Tipo | Propósito |
|---|---|---|
| `JsonlRunEventStore` | Clase | Almacén principal de eventos en formato JSONL con soporte de fencing y caching. |
| `FileEffectInputStore` | Clase | Almacén inmutable de inputs de efectos direccionado por contenido (SHA-256). |
| `FilePhysicalEffectReceiptStore` | Clase | Almacén inmutable de recibos de efectos físicos. |
| `EventStoreCompactor` | Clase | Compactador de journals por generaciones inmutables con checksums. |
| `JsonlArtifactStore` | Clase | Almacén inmutable de artefactos adoptados en formato JSONL. |
| `JsonlAttemptStore` | Clase | Almacén inmutable de registros de intentos en formato JSONL. |
| `RunSnapshotStore` | Clase | Persistencia y recuperación de snapshots completos de proyección. |
| `acquireDurableLock` | Función | Adquiere un lock duradero exclusivo con lease y renovación automática. |
| `atomicWriteFile` | Función | Escritura atómica a disco con rename seguro, reintentos y fsync. |
| `foldRunEvents` | Función | Pliega una lista de eventos para generar la `RunProjection` inicial. |
| `reduceRunEvents` | Función | Reduce nuevos eventos sobre una `RunProjection` existente. |
| `recoverPendingEffects` | Función | Recupera y reconcilia efectos en estado pendiente tras una caída del proceso. |

### Jerarquía de Errores Tipados

| Clase de Error | Condición de Disparo |
|---|---|
| `SequenceConflictError` | La secuencia esperada (`expectedSequence`) no coincide con el cursor del log en disco. |
| `StaleFencingTokenError` | El token de fencing proporcionado fue revocado o superado por otra autoridad de daemon. |
| `CorruptRunEventLogError` | El archivo de journal contiene líneas inválidas o checksums corruptos no recuperables. |
| `EffectInputCorruptionError` | El contenido o identidad del input de efecto en disco difiere de su digest canónico. |
| `PhysicalEffectReceiptCorruptionError` | El recibo de efecto físico en disco no supera la validación canónica de identidad. |
| `ImmutableArtifactConflictError` | Intento de registrar un artefacto con el mismo ID pero contenido divergente. |
| `ImmutableAttemptConflictError` | Intento de registrar un intento con el mismo ID pero contenido divergente. |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Event Sourcing Canónico y Autoridad de Fencing
El log `.events.v2.jsonl` es la única fuente de verdad autoritativa. Cada llamada a `appendFenced` exige:
- `expectedSequence`: Verifica que el escritor posea la vista exacta del último evento registrado. Si la secuencia en disco diverge, lanza `SequenceConflictError`.
- `FencingAuthority`: Verifica que el `fencingToken` del escritor coincida con el registro `.fence.v2.json`. Si otro actor asumió la autoridad del run, el escritor anterior recibe `StaleFencingTokenError`.

### 2. Outbox Duradero de Efectos Físicos (Two-Phase Effect Outbox)
Las interacciones con el mundo real (mutaciones en Git, creación de procesos o acceso a sandboxes) no son transaccionales por naturaleza. Para evitar inconsistencias ante caídas del daemon:
1. **Fase de Intención (Pre-mutación)**: Se crea el `EffectInput` estructurado, se persiste en `runs-v2/effect-inputs/<sha256>.effect-input.json` mediante escritura atómica con `fsync` y hard-link, y se emite el evento `effect.requested`.
2. **Fase de Observación y Recibo (Post-mutación)**: Se ejecuta la operación física, se registra el resultado en `FilePhysicalEffectReceiptStore`, y se emite el evento `effect.completed` o `effect.failed`.

### 3. Bloqueos Duraderos con Heartbeat y Cuarentena de Stale Locks
`acquireDurableLock` implementa exclusión mutua basada en el sistema de archivos:
- **Creación Atómica**: Utiliza `mkdir(lockPath, { recursive: false })` que falla atómicamente con `EEXIST` si el bloqueo ya fue adquirido por otro proceso.
- **Heartbeat de Renovación**: Actualiza periódicamente los tiempos de acceso y modificación (`utimes`) del directorio.
- **Reclamación Segura de Bloqueos Obsoletos**: Si un proceso muere abruptamente sin liberar el lock, los competidores detectan que `Date.now() - mtime > staleAfterMs`. La reclamación mueve el directorio a una ruta de cuarentena (`*.stale.<uuid>`) antes de borrarlo, evitando eliminar accidentalmente a un nuevo adquirente legítimo.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 2 / GD0+GD1)**: El kernel de persistencia durable, el outbox de efectos y los bloqueos con fencing tokens están completamente cerrados y verificados con 228 tests en `docs/audits/stage-2/`.
2. **Upcaster Automático**: `event-upcaster.ts` normaliza transparentemente eventos de esquema histórico V1 a la versión canónica actual (`CURRENT_EVENT_SCHEMA_VERSION = 2`).

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/run-store/README.md`](../../packages/run-store/README.md)
- **Módulos Relacionados**:
  - [`run-engine.md`](./run-engine.md): Consumidor de `run-store` para la persistencia del actor y despacho de efectos.
  - [`run-coordinator.md`](./run-coordinator.md): Definición de los eventos canónicos y reductor de estado puro.
  - [`trace-store.md`](./trace-store.md): Persistencia de trazas diagnósticas complementarias sin autoridad de dominio.
  - [`daemon.md`](./daemon.md): Proceso anfitrión que custodia la autoridad única de escritura en disco.
- **Documentación Central**: [`../README.md`](../README.md)
