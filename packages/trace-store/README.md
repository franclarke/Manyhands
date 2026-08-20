# @manyhands/trace-store

Almacenamiento de trazas diagnósticas, observabilidad, eventos de telemetría de agentes, redacción automática de secretos y registro estructurado en formato JSONL para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/trace-store` es la capa de observabilidad y diagnóstico de ManyHands. Su responsabilidad fundamental es registrar información detallada de telemetría sin interferir con la consistencia ni la autoridad del estado de dominio:

1. **Separación Estricta de Autoridad (Diagnóstico vs. Hechos de Dominio)**: Las trazas diagnósticas **no poseen autoridad de dominio**. No deciden el ciclo de vida, la preparación de tareas (*readiness*), la adopción de artefactos ni el veredicto de validación. Los hechos canónicos residen exclusivamente en `@manyhands/run-store`, mientras que `@manyhands/trace-store` almacena información auxiliar (prompts crudos, streams de procesos, tiempos de respuesta de LLMs, métricas de enrutamiento y depuración).
2. **Redacción Automática de Secretos (`redactSecrets`)**: Antes de que cualquier evento sea serializado y escrito en disco, su payload se analiza recursivamente para detectar y enmascarar automáticamente API keys (Anthropic, OpenAI, GitHub tokens, claves de AWS, tokens Bearer, contraseñas y cookies).
3. **Persistencia Duradera en JSONL con Checksum**: Mediante `JsonlTraceStore`, cada traza se almacena encapsulada en un sobre duradero (`DurableTraceEnvelope`) con checksum SHA-256 y sincronización forzada a disco (`fsync`), evitando corrupciones o lecturas inconsistentes en la interfaz de usuario.
4. **Almacenamiento Efímero en Memoria (`InMemoryTraceStore`)**: Provee una implementación rápida en memoria para tests unitarios y procesos de simulación sin dependencias del sistema de archivos.

---

## 2. Arquitectura Modular Interna

El código fuente en `src/` está estructurado en módulos enfocados:

```
packages/trace-store/src/
├── index.ts              # Barrel export unificado
├── trace-types.ts        # Schemas Zod (TraceEventTypeSchema, TraceEventSchema), tipos e InMemoryTraceStore
└── jsonl-trace-store.ts  # Implementación JsonlTraceStore, sobres con checksum y función redactSecrets
```

### Desglose Detallado por Archivo

- **`trace-types.ts`**:
  - `TraceEventTypeSchema`: Enum/Unión Zod que cataloga los 62 tipos de eventos diagnósticos que ocurren a lo largo del ciclo de vida del sistema (planificación, ejecución, sandboxing, validación, integración y decisiones humanas).
  - `TraceActorSchema`: Define los actores responsables de la emisión (`"system"`, `"human"`, `"agent"`).
  - `TraceEventSchema`: Schema Zod para eventos de traza individuales (`id`, `type`, `timestamp`, `actor`, `planId`, `taskId`, `payload`).
  - `TraceStore`: Interfaz que define las operaciones de consulta y adición (`append`, `list`, `findByType`, `findByTask`, `clear`).
  - `InMemoryTraceStore`: Implementación en memoria de la interfaz `TraceStore`.
- **`jsonl-trace-store.ts`**:
  - `JsonlTraceStore`: Implementación persistente que gestiona el archivo `runs/<runId>/traces.jsonl`.
  - `DurableTraceEnvelope`: Estructura de sobre que contiene `schemaVersion: 1`, el `event` y su `checksum` SHA-256.
  - `redactSecrets`: Función recursiva de sanitización que inspecciona claves de objetos y patrones textuales para reemplazar información sensible por `"[REDACTED]"`.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Separación de Autoridad y Prevención de Bloqueo

A diferencia de los eventos de `@manyhands/run-store` (que requieren validación de secuencias, fencing tokens y bloqueos transaccionales), las trazas se conciben como un canal de solo adición (*append-only telemetry*):
- **Cero Bloqueos de Dominio**: Si la persistencia de una traza experimenta latencia de I/O, el motor de ejecución principal no detiene sus transiciones de estado ni invalida un intento de tarea.
- **Aislamiento de Carga**: Los payloads voluminosos (como la salida completa de stdout/stderr de subprocesos o prompts de contexto completo) se envían a `trace-store`, evitando la degradación del rendimiento durante el replay del event store de dominio.

### 3.2. Redacción Recursiva de Secretos

La función `redactSecrets` recorre el árbol de datos antes de serializarlo:

```
                    Payload Crudo
                         │
                         ▼
        ┌──────────────────────────────────┐
        │       redactSecrets(value)       │
        │  1. Claves sensibles de objetos  │  ──► "[REDACTED]"
        │     (apikey, token, auth, etc.)  │
        │  2. Regex de patrones conocidos  │  ──► "sk-ant-...[REDACTED]"
        │     (Bearer, sk-ant-*, ghp_*)    │
        │  3. Detección de ciclos          │  ──► "[REDACTED:CIRCULAR]"
        └────────────────┬─────────────────┘
                         │
                         ▼
             Payload Sanitizado Seguro
```

Detecta automáticamente:
- **Claves de Objeto**: `apiKey`, `accessToken`, `authToken`, `authorization`, `cookie`, `password`, `secret`, `awsSecretAccessKey`, etc.
- **Formatos de Texto**: Tokens de OpenAI (`sk-...`), Anthropic (`sk-ant-...`), GitHub (`ghp_...`, `gho_...`), cabeceras `Authorization: Bearer <token>`, cadenas de conexión de bases de datos y asignaciones en archivos `.env`.

### 3.3. Sobres con Checksum SHA-256 y Recuperación de Truncamiento

Cada línea en `traces.jsonl` está encapsulada en un `DurableTraceEnvelope`:
- **Verificación de Integridad**: Al invocar `list()`, `findByType()` o `findByTask()`, cada sobre es deserializado y su checksum verificado. Si se detecta manipulación o discrepancia, se lanza un error descriptivo.
- **Resiliencia ante Cortes de Energía**: Si un proceso finaliza antes de completar la escritura de la última línea (`\n`), `JsonlTraceStore` detecta la línea truncada al inicio de la lectura y ajusta el tamaño del archivo (`truncateSync`) hasta el último salto de línea válido, permitiendo recuperar las trazas anteriores sin fallar.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Interfaces, Schemas y Clases

| Símbolo | Tipo | Archivo | Descripción |
|---|---|---|---|
| `JsonlTraceStore` | Clase | `jsonl-trace-store.ts` | Almacén persistente en disco en formato JSONL con checksums y redacción de secretos. |
| `InMemoryTraceStore` | Clase | `trace-types.ts` | Almacén en memoria volátil para testing y simulaciones. |
| `TraceStore` | Interfaz | `trace-types.ts` | Contrato estándar de almacenamiento y consulta de trazas. |
| `TraceEventSchema` | Zod Schema | `trace-types.ts` | Schema de validación de un evento de traza individual. |
| `TraceEventTypeSchema` | Zod Schema | `trace-types.ts` | Unión de 62 tipos de eventos diagnósticos del sistema. |
| `TraceActorSchema` | Zod Schema | `trace-types.ts` | Schema para actores (`"system"`, `"human"`, `"agent"`). |
| `redactSecrets` | Función | `jsonl-trace-store.ts` | Sanitiza cadenas y objetos eliminando claves y tokens privados. |

### 4.2. Tipos de Eventos Diagnósticos Notables

El enum `TraceEventType` abarca eventos en todas las fases operativas:
- **Planificación**: `decomposition_started`, `graph_created`, `contract_created`, `planning_run_completed`, `planning_run_failed`.
- **Scheduling y Conflictos**: `static_conflict_signals_generated`, `risk_predicted`, `batch_scheduled`, `task_blocked_by_gate`.
- **Ejecución y Sandboxes**: `worktree_created`, `agent_run_started`, `executor_started`, `executor_output`, `executor_completed`, `agent_status`.
- **Validación y Alcance**: `scope_validated`, `scope_check_failed`, `validation_started`, `validation_completed`.
- **Integración y Reparación**: `integration_started`, `cherry_pick_attempted`, `cherry_pick_conflict`, `executor_repair_started`, `integration_completed`.

### 4.3. Ejemplo de Uso: Registro de Trazas Diagnósticas con Sanitización

```typescript
import { JsonlTraceStore, redactSecrets, type TraceEvent } from "@manyhands/trace-store";

// 1. Instanciar el almacén para una corrida específica
const traceStore = new JsonlTraceStore({
  runId: "run-2026-08-18-001",
  directory: ".manyhands/runs"
});

// 2. Registrar eventos diagnósticos (las credenciales sensibles se enmascaran automáticamente)
const event: TraceEvent = traceStore.append({
  type: "executor_started",
  actor: "agent",
  taskId: "task-build-api",
  payload: {
    command: "npm test",
    environment: {
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-proj-abcdef1234567890abcdef1234567890", // Será enmascarada a [REDACTED]
      PORT: 3000
    }
  }
});

console.log("Traza registrada con ID:", event.id);
console.log("Payload sanitizado:", event.payload);

// 3. Consultar trazas por tipo o por tarea
const executionTraces = traceStore.findByType("executor_started");
const taskTraces = traceStore.findByTask("task-build-api");

console.log(`Total de trazas para task-build-api: ${taskTraces.length}`);
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con la Sección 9.17 del plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

| Componente | Estado de Rediseño | Observaciones |
|---|---|---|
| **Separación de Autoridad** | Estable ✅ | Las trazas están completamente desacopladas del ciclo de vida canónico. |
| **Sanitización de Secretos** | Estable ✅ | `redactSecrets` cubre proveedores principales (Anthropic, OpenAI, GitHub, AWS). |
| **Persistencia Duradera JSONL** | Estable ✅ | Sobres `DurableTraceEnvelope` con checksum SHA-256 operativos. |
| **Streaming UI / WebSocket** | Estable ✅ | Las trazas alimentan las vistas diagnósticas de la UI sin comprometer la persistencia de dominio. |

---

## 6. Comandos de Verificación y Testing

Para verificar los tipos estáticos y compilar `@manyhands/trace-store`:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/trace-store typecheck

# Compilación de paquetes (ESM y CJS con DTS)
pnpm --filter @manyhands/trace-store build
```
