# Guía Arquitectónica: manyhands-windows-job-runner

> **Ubicación en el Monorepo**: `native/windows-job-runner/`  
> **README del Componente Nativo**: [`../../native/windows-job-runner/README.md`](../../native/windows-job-runner/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas operativos Windows, la supervisión confiable de subprocesos y herramientas CLI (compiladores, linters, workers y agentes de lenguaje) presenta dos riesgos mayores de estabilidad y seguridad:
1. **Procesos Huérfanos (*Zombies / Leaked Processes*)**: Cuando un proceso padre muere o es finalizado abruptamente, los procesos hijos y nietos continúan ejecutándose de forma invisible en segundo plano, consumiendo CPU y bloqueando archivos o puertos.
2. **Condiciones de Carrera por Reciclaje de PIDs (*PID Reuse Races*)**: El kernel de Windows recicla identificadores numéricos de proceso rápidamente. Si un supervisor intenta terminar un proceso basándose únicamente en su PID numérico tras un timeout, corre el riesgo de destruir un proceso nuevo y no relacionado del sistema operativo.

**`manyhands-windows-job-runner`** es un ejecutable nativo desarrollado en **Rust puro sin dependencias externas** (FFI directo con Win32 `kernel32.dll`) que actúa como **custodio estricto de ejecución de procesos** para `@manyhands/execution-core` y `apps/daemon`.

### Problemas Fundamentales que Resuelve

- **Contención Total de Árboles de Procesos con Job Objects Anidados**: Utiliza Windows Job Objects con la bandera `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Cuando el custodio o el daemon finalizan, el kernel de Windows destruye atómicamente todo el árbol de procesos descendientes sin excepción.
- **Lanzamiento Suspendido e Inclusión Verificada (`CREATE_SUSPENDED`)**: El proceso objetivo se crea en estado suspendido y se valida su pertenencia a los Job Objects antes de que ejecute una sola instrucción, impidiendo que ningún subproceso escape a la custodia.
- **Identidad Causal por Ticks del Kernel**: Identifica los procesos mediante su marca de tiempo exacta de creación en ticks de 100ns (`windows:start-ticks:<ticks>`), eliminando vulnerabilidades por reciclaje de PIDs.
- **Publicación Atómica de Recibos Criptográficos Encadenados**: Emite recibos inmutables en disco (`started.json` y `final.json`) mediante enlaces duros (*hard links*) con sumas de comprobación SHA-256 canónicas encadenadas.
- **Verificación de Cero Descendientes Vivos (*Descendant Reaping Verification*)**: Antes de emitir `final.json`, termina activamente el Job del proveedor y verifica que el recuento de procesos activos en el kernel sea estrictamente cero (`active_process_limit == 0`).

---

## 2. Arquitectura Interna y Componentes

El componente está desarrollado íntegramente en un único archivo de código fuente Rust de alta cohesión:

```
native/windows-job-runner/
├── Cargo.toml                       # Configuración de compilación Rust (cero dependencias externas)
├── README.md                        # Documentación técnica
└── src/
    └── main.rs                      # FFI Win32, Job Objects, SHA-256, Hard-links y CLI
```

### Desglose de Subsistemas en `src/main.rs`

- **Win32 FFI & Enlaces del Kernel**: Enlaces directos a `kernel32.dll` (`CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`, `IsProcessInJob`, `CreateProcessW`, `ResumeThread`, `GetProcessTimes`, `TerminateJobObject`, `QueryInformationJobObject`, `GetExitCodeProcess`).
- **Deserializador de Peticiones Binarias (`parse_request`)**: Implementa la estructura `Cursor` para parsear tramas binarias prefijadas con el encabezado de protocolo `MHJR1\0`.
- **Gestión de Identidad de Procesos (`process_creation_identity`)**: Extrae los tiempos de creación mediante `GetProcessTimes` y genera la cadena `windows:start-ticks:<ticks>`.
- **Motor Criptográfico SHA-256 y Publicación Atómica**: Implementación interna de SHA-256 y función `write_immutable_json` que escribe el archivo temporal, ejecuta `file.sync_all()` y crea un enlace duro atómico (`fs::hard_link`) hacia `started.json` o `final.json`.
- **Hilo Centinela de Liveness por Stdin**: Monitorea continuamente `io::stdin()`. Si el canal se cierra (EOF porque el daemon cayó), invoca inmediatamente `TerminateJobObject` sobre ambos Jobs y finaliza.

---

## 3. Flujos de Control y Datos

El siguiente diagrama ilustra el protocolo de custodia estricta y emisión de recibos:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        apps/daemon (Supervisor)                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Spawns via stdin pipe
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      windows-job-runner (Custodio)                      │
│                                                                        │
│  1. Crea custodian_job (KILL_ON_JOB_CLOSE)                             │
│  2. Asigna su propio proceso a custodian_job                           │
│  3. Crea provider_job (KILL_ON_JOB_CLOSE)                              │
│  4. Lanza proceso con CREATE_SUSPENDED                                 │
│  5. Valida herencia de custodian_job y asigna a provider_job           │
│  6. Extrae start-ticks del kernel (GetProcessTimes)                    │
│  7. Escribe y enlaza atómicamente started.json                         │
│  8. Emite "STARTED\n" e invoca ResumeThread                            │
│                                                                        │
│    ┌──────────────────────────────┐  ┌──────────────────────────────┐  │
│    │ custodian_job                │  │ provider_job                 │  │
│    │ (Kill-on-Close Guard)        │  │ (Kill-on-Close & Reaping)    │  │
│    │  • windows-job-runner (Self) │  │  • Target Worker Process     │  │
│    │  • Provider & Descendants    │  │    • Child CLI Process A     │  │
│    │                              │  │    • Child CLI Process B     │  │
│    └──────────────────────────────┘  └──────────────────────────────┘  │
│                                                                        │
│  9. Monitorea stdin: si daemon muere (EOF) ──► TerminateJobObject      │
│ 10. Al terminar target: TerminateJobObject(provider_job)               │
│ 11. Verifica kernel active_process_limit == 0                          │
│ 12. Escribe y enlaza atómicamente final.json con SHA-256 encadenado    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Interfaces Públicas, Comandos CLI y Protocolo

### Sintaxis de Operaciones CLI

```
manyhands-windows-job-runner <operación> [argumentos...]
```

| Operación | Parámetros | Propósito |
|---|---|---|
| `run` | `<receipts-dir> <job-name>` | Lee la petición binaria por `stdin`, crea los Job Objects anidados, lanza el proceso suspendido, emite `started.json`, reanuda la ejecución y emite `final.json`. |
| `terminate` | `<custodian-pid> <custodian-identity> <provider-pid> <provider-identity> <job-name>` | Protocolo de terminación segura de ambos Jobs con validación estricta de identidad duradera. |
| `probe-identity` | `<pid>` | Consulta al kernel de Windows y retorna en `stdout` la identidad `windows:start-ticks:<ticks>` del proceso indicado. |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Arquitectura de Job Objects Anidados (Custodian y Provider)
Para asegurar contención ante caídas sin perder la capacidad de verificar el fin de los procesos durante una ejecución normal, el runner crea **dos Job Objects anidados**:
1. **`custodian_job` (`manyhands-custodian-<job_name>`)**:
   - Configurado con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
   - El propio runner se asocia a este Job.
   - Actúa como red de seguridad pasiva: si el ejecutable del runner o el daemon sufren un fallo catastrófico, el cierre de handles en el kernel termina de inmediato todo el árbol de procesos.
2. **`provider_job` (`manyhands-provider-<job_name>`)**:
   - Configurado con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
   - El proceso supervisado se asocia a este Job mientras está suspendido.
   - Permite al runner terminar de forma activa el árbol del proveedor (`TerminateJobObject`) y esperar a que el recuento de procesos activos sea cero antes de finalizar.

### 2. Encadenamiento Causal de Recibos
El archivo `final.json` incluye obligatoriamente el campo `startedReceiptChecksum`, el cual referencia el hash SHA-256 exacto del `started.json` generado al inicio. Esto garantiza criptográficamente que ningún observador externo pueda sintetizar un recibo final desconectado de su intento verificado.

### 3. Protocolo de Terminación Segura y Fail-Closed
El comando `terminate` no realiza terminaciones ciegas por PID:
- Abre los Jobs `custodian_job` y `provider_job`.
- Si los Jobs ya no existen, consulta `probe_identity` para el custodio y el proveedor.
- Si y solo si **ambas identidades duraderas están confirmadas como muertas** (`dead`), la operación se considera convergida.
- Si un PID fue reciclado por otro proceso (`different`) o no puede determinarse con certeza, la operación falla en modo cerrado (*fail-closed*).

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 3 / GR y Stage 8 / GLeaf)**: El ejecutable nativo está completamente implementado y verificado en pruebas de estrés de caídas y cancelación concurrente.
2. **Consumo Productivo**: `@manyhands/execution-core` (`ProcessSupervisor`) y `apps/daemon` invocan este binario como el custodio obligatorio en entornos Windows.

---

## 7. Navegación y Referencias

- **README del Componente Nativo**: [`../../native/windows-job-runner/README.md`](../../native/windows-job-runner/README.md)
- **Módulos Relacionados**:
  - [`execution-core.md`](./execution-core.md): Integración mediante `ProcessSupervisor`.
  - [`daemon.md`](./daemon.md): Orquestación de workers supervisados.
  - [`windows-ipc-acl.md`](./windows-ipc-acl.md): Seguridad complementaria para Named Pipes y DACLs en Windows.
- **Documentación Central**: [`../README.md`](../README.md)
