# Guía Arquitectónica: @manyhands/trace-store

> **Ubicación en el Monorepo**: `packages/trace-store/`  
> **README del Paquete**: [`../../packages/trace-store/README.md`](../../packages/trace-store/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas complejos de ingeniería de software basados en agentes de lenguaje, existe una cantidad masiva de información auxiliar que se genera durante una corrida: streams de stdout/stderr de subprocesos, prompts crudos, respuestas parciales de LLMs, métricas de enrutamiento y trazas de depuración. Mezclar esta telemetría con los eventos de dominio transaccionales sobrecarga el almacenamiento, degrada el rendimiento de los replays e incrementa el riesgo de fugar secretos y credenciales a las interfaces de usuario.

**`@manyhands/trace-store`** es la capa de observabilidad y diagnóstico de ManyHands. Su responsabilidad fundamental es registrar y consultar telemetría detallada sin interferir con la autoridad del estado de dominio, garantizando la redacción automática de secretos y la integridad de los registros mediante sobres con checksum.

### Problemas Fundamentales que Resuelve

1. **Separación Estricta de Autoridad (Diagnóstico vs. Hechos de Dominio)**: Las trazas **no poseen autoridad de dominio**. No deciden la validez de un contrato, el readiness de una tarea ni el veredicto de validación. Los hechos canónicos residen exclusivamente en `@manyhands/run-store`, mientras que `@manyhands/trace-store` almacena información auxiliar de depuración.
2. **Redacción Automática y Recursiva de Secretos (`redactSecrets`)**: Antes de que cualquier evento se escriba en disco, su payload se analiza recursivamente para detectar y enmascarar API keys (Anthropic, OpenAI, GitHub), tokens Bearer, contraseñas, cookies y cadenas de conexión.
3. **Persistencia Duradera en JSONL con Checksums SHA-256 (`JsonlTraceStore`)**: Cada traza se almacena encapsulada en un sobre duradero (`DurableTraceEnvelope`) con checksum y sincronización forzada a disco (`fsync`), previniendo lecturas inconsistentes.
4. **Almacenamiento Efímero en Memoria (`InMemoryTraceStore`)**: Provee una implementación volátil para pruebas unitarias y simulaciones sin tocar el sistema de archivos.

---

## 2. Arquitectura Interna y Componentes

El código fuente en `src/` está estructurado en módulos especializados:

```
packages/trace-store/src/
├── index.ts              # Barrel export unificado
├── trace-types.ts        # Schemas Zod (TraceEventTypeSchema, TraceEventSchema), tipos e InMemoryTraceStore
└── jsonl-trace-store.ts  # Implementación JsonlTraceStore, sobres con checksum y función redactSecrets
```

### Desglose de Responsabilidades por Archivo

| Módulo | Responsabilidad Principal |
|---|---|
| `trace-types.ts` | Define `TraceEventTypeSchema` (catálogo de 62 tipos de eventos diagnósticos), `TraceActorSchema`, `TraceEventSchema`, la interfaz `TraceStore` y la clase `InMemoryTraceStore`. |
| `jsonl-trace-store.ts` | Implementa `JsonlTraceStore` sobre `runs/<runId>/traces.jsonl`, encapsula eventos en `DurableTraceEnvelope` y aplica la sanitización recursiva `redactSecrets`. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra la separación entre la telemetría diagnóstica y el journal de dominio, junto con el proceso de redacción de secretos:

```
                          Ejecutor / Supervisor / Agente LLM
                                          │
              ┌───────────────────────────┴───────────────────────────┐
              │                                                       │
              ▼ (Hechos Canónicos de Dominio)                         ▼ (Telemetría / Diagnóstico)
     @manyhands/run-store                                    @manyhands/trace-store
   (.events.v2.jsonl)                                                │
   • Mutaciones de Estado                                             ▼
   • Verificación de Secuencias                             ┌───────────────────┐
   • Fencing Tokens                                         │   redactSecrets   │
                                                            └─────────┬─────────┘
                                                                      │ (Payload Sanitizado)
                                                                      ▼
                                                            ┌───────────────────┐
                                                            │  Sobres con SHA   │
                                                            │ (DurableEnvelope) │
                                                            └─────────┬─────────┘
                                                                      │
                                                                      ▼
                                                             traces.jsonl (fsync)
                                                                      │
                                                                      ▼
                                                             Streaming hacia UI
                                                             (/api/runs/[id]/.../activity)
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Interfaces y Clases Principales

| Símbolo | Tipo | Propósito |
|---|---|---|
| `JsonlTraceStore` | Clase | Almacén persistente en disco en formato JSONL con checksums y redacción de secretos. |
| `InMemoryTraceStore` | Clase | Almacén en memoria volátil para testing y simulaciones sin I/O. |
| `TraceStore` | Interfaz | Contrato estándar de almacenamiento y consulta (`append`, `list`, `findByType`, `findByTask`, `clear`). |
| `TraceEventSchema` | Zod Schema | Schema de validación de un evento de traza (`id`, `type`, `timestamp`, `actor`, `planId`, `taskId`, `payload`). |
| `TraceEventTypeSchema` | Zod Schema | Unión de los 62 tipos de eventos diagnósticos del sistema. |
| `redactSecrets` | Función | Sanitiza estructuras de datos eliminando claves y tokens privados. |

### Categorías de Eventos Diagnósticos Notables (62 Tipos)

- **Planificación**: `decomposition_started`, `graph_created`, `contract_created`, `planning_run_completed`, `planning_run_failed`.
- **Scheduling y Riesgo**: `static_conflict_signals_generated`, `risk_predicted`, `batch_scheduled`, `task_blocked_by_gate`.
- **Ejecución y Sandboxes**: `worktree_created`, `agent_run_started`, `executor_started`, `executor_output`, `executor_completed`, `agent_status`.
- **Validación y Alcance**: `scope_validated`, `scope_check_failed`, `validation_started`, `validation_completed`.
- **Integración y Reparación**: `integration_started`, `cherry_pick_attempted`, `cherry_pick_conflict`, `executor_repair_started`, `integration_completed`.

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Cero Bloqueos de Dominio y Aislamiento de Carga
A diferencia de los eventos de `@manyhands/run-store` (que requieren bloqueos transaccionales y validación de secuencias), las trazas se conciben como un canal de solo adición (*append-only telemetry*):
- Si la persistencia de una traza experimenta latencia de disco, el motor de ejecución principal no se detiene.
- Los streams voluminosos de stdout/stderr se desvían a `trace-store`, evitando inflar el journal de eventos de dominio.

### 2. Redacción Recursiva de Secretos (`redactSecrets`)
La función recorre exhaustivamente el objeto antes de serializarlo:
- **Claves Sensibles**: `apiKey`, `accessToken`, `authToken`, `authorization`, `cookie`, `password`, `secret`, `awsSecretAccessKey`.
- **Patrones Textuales**: Tokens de OpenAI (`sk-...`), Anthropic (`sk-ant-...`), GitHub (`ghp_...`, `gho_...`), cabeceras `Authorization: Bearer <token>` y credenciales en variables de entorno.

### 3. Sobres con Checksum SHA-256 y Recuperación de Truncamiento
Cada línea en `traces.jsonl` está encapsulada en un `DurableTraceEnvelope`:
- **Verificación de Integridad**: Al consultar trazas, cada sobre es deserializado y su checksum verificado.
- **Resiliencia ante Caídas**: Si un proceso finaliza abruptamente dejando una línea incompleta (`\n` faltante), `JsonlTraceStore` detecta la línea truncada al inicio de la lectura y ajusta el archivo (`truncateSync`) hasta el último salto de línea válido, permitiendo recuperar los eventos previos.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Separación Canónica (Stage 2 / GD0)**: La separación entre el journal de eventos de dominio y el log de telemetría diagnóstica está completada y estandarizada.
2. **Streaming a la UI**: `apps/daemon` y `apps/web` consumen `trace-store` exclusivamente para la pestaña de actividad y consola de subprocesos en vivo (`/api/runs/[id]/nodes/[nodeId]/activity`).

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/trace-store/README.md`](../../packages/trace-store/README.md)
- **Módulos Relacionados**:
  - [`run-store.md`](./run-store.md): Journal de eventos de dominio autoritativo complementario.
  - [`run-engine.md`](./run-engine.md): Emisión de telemetría durante el ciclo de vida de los actores.
  - [`daemon.md`](./daemon.md): Servidor local que gestiona las rutas de almacenamiento de trazas.
  - [`web.md`](./web.md): Visualización de logs y actividad en tiempo real.
- **Documentación Central**: [`../README.md`](../README.md)
