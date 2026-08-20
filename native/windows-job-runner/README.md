# manyhands-windows-job-runner

Ejecutable nativo en Rust puro (sin dependencias externas, FFI directo con Win32 `kernel32`) que implementa la frontera de custodia estricta, contención de procesos jerárquicos mediante Job Objects anidados y emisión de recibos criptográficos inmutables para ManyHands en sistemas Windows.

---

## 1. Propósito y Responsabilidad en ManyHands

En entornos Windows, la supervisión de subprocesos y herramientas CLI (compiladores, linters, workers y agentes de ejecución) presenta desafíos críticos:
- Si un proceso padre muere o es finalizado abruptamente, los subprocesos hijos y nietos continúan ejecutándose como procesos huérfanos (*orphan/zombie processes*), consumiendo recursos o bloqueando archivos y puertos.
- Los identificadores de proceso (PIDs) en Windows son reciclados rápidamente por el kernel, lo que genera vulnerabilidades si un supervisor intenta terminar un proceso basándose únicamente en su PID numérico (*PID reuse race conditions*).

`manyhands-windows-job-runner` resuelve estos problemas asumiendo la responsabilidad de **custodio de ejecución de procesos** para `@manyhands/execution-core` y `@manyhands/daemon`:

1. **Contención Total de Árboles de Procesos Mediante Job Objects Anidados**: Utiliza las APIs de Windows Job Objects con la bandera `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Cuando el custodio o el daemon finalizan (por cierre de stdin, timeout o caída del sistema), el kernel de Windows termina atómicamente el proceso supervisado y toda su descendencia sin excepción.
2. **Arranque Suspendido e Inclusión Verificada (`CREATE_SUSPENDED`)**: El proceso supervisado se crea en estado suspendido, se asocia y valida en los Job Objects correspondientes antes de que ejecute una sola instrucción, garantizando que ningún hijo pueda escapar antes de estar bajo custodia del kernel.
3. **Identidad Inmutable por Ticks de Creación del Kernel**: Asocia la identidad del proceso no a su PID efímero, sino a su marca de tiempo exacta de creación en ticks de 100ns (`windows:start-ticks:<ticks>`).
4. **Publicación Atómica de Recibos Criptográficos Encadenados**: Publica recibos inmutables en disco (`started.json` y `final.json`) mediante enlaces duros (*hard links*) con sumas de comprobación SHA-256 canónicas. El código del proceso supervisado solo se reanuda tras asegurar la persistencia física de `started.json`.
5. **Verificación de Cero Descendientes Vivos (*Descendant Reaping Verification*)**: Tras la finalización del proceso objetivo, el runner termina el Job Object del proveedor y consulta las estadísticas de contabilidad del kernel (`active_process_limit == 0`) para garantizar que ningún subproceso residual permanezca vivo antes de emitir `final.json`.

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

## 2. Arquitectura Modular Interna

El componente está desarrollado íntegramente en un único archivo de código fuente Rust de alta cohesión:

```
native/windows-job-runner/
├── Cargo.toml                       # Configuración de compilación Rust (cero dependencias externas)
├── README.md                        # Documentación técnica
└── src/
    └── main.rs                      # Implementación completa de FFI Win32, Job Objects, SHA-256 y CLI
```

### Desglose de Subsistemas en `src/main.rs`

- **Win32 FFI & Declaraciones del Kernel**:
  - Enlaces directos a `kernel32.dll`: `CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`, `IsProcessInJob`, `CreateProcessW`, `ResumeThread`, `OpenProcess`, `GetProcessTimes`, `TerminateJobObject`, `QueryInformationJobObject`, `GetExitCodeProcess`, `CreateFileW`, etc.
  - Tipos estructurados de Win32: `StartupInfoW`, `ProcessInformation`, `FileTime`, `JobObjectExtendedLimitInformation`, `JobObjectBasicAccountingInformation`.
- **Deserializador de Peticiones Binarias (`parse_request`)**:
  - Implementa la estructura `Cursor` para parsear tramas binarias prefijadas con el encabezado de protocolo `MHJR1\0` y cadenas de longitud fija (`u32` little-endian).
- **Gestión de Identidad de Procesos (`process_creation_identity`)**:
  - Lee los tiempos del proceso mediante `GetProcessTimes`. Convierte los campos `FileTime` (low y high) a un valor de 64 bits en ticks UTC de 100ns, produciendo la cadena `windows:start-ticks:<ticks>`.
- **Motor Criptográfico SHA-256 y Publicación Atómica de Recibos**:
  - Implementación interna de SHA-256 en Rust sin librerías externas (`sha256_hex`, `receipt_checksum`).
  - Función `write_immutable_json`: Escribe el archivo temporal, ejecuta `file.sync_all()` para forzar el vaciado a disco y crea un enlace duro atómico (`fs::hard_link`) hacia el archivo de destino final (`started.json` o `final.json`). Un enlace duro garantiza exclusividad atómica en el volumen NTFS y previene sobreescrituras accidentales.
- **Hilo Centinela de Liveness por Stdin**:
  - Inicia un hilo dedicado en segundo plano que lee continuamente de `io::stdin()`. Si el canal se cierra (EOF porque el daemon cayó o se cerró la tubería), el centinela invoca inmediatamente `TerminateJobObject` sobre ambos jobs y finaliza el proceso con `ExitProcess(1)`.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Arquitectura de Job Objects Anidados (Custodian y Provider)

Para asegurar contención ante caídas sin perder la capacidad de verificar el fin de los procesos durante una ejecución normal, el runner crea **dos Job Objects anidados**:

1. **`custodian_job` (`manyhands-custodian-<job_name>`)**:
   - Configurado con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
   - El propio runner se asocia a este Job (`AssignProcessToJobObject(custodian, GetCurrentProcess())`).
   - El proceso hijo hereda automáticamente la pertenencia a este Job al ser creado.
   - Actúa como **red de seguridad pasiva**: si el ejecutable del runner o el daemon sufren un fallo catastrófico, el cierre de los handles en el kernel termina de inmediato todo el árbol de procesos.
2. **`provider_job` (`manyhands-provider-<job_name>`)**:
   - Configurado con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
   - El proceso supervisado se asocia explícitamente a este Job mientras está suspendido.
   - Permite al runner terminar de forma activa el árbol del proveedor (`TerminateJobObject(provider_job, 0x4d480003)`) y esperar a que el recuento de procesos activos sea cero (`wait_job_empty`) antes de finalizar la custodia del proceso custodio.

### 3.2. Lanzamiento Suspendido y Verificación de Pertenencia

```rust
// 1. Crear proceso suspendido
let created = CreateProcessW(
    application.as_ptr(),
    command_line.as_mut_ptr(),
    null_mut(),
    null_mut(),
    TRUE,
    CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
    environment.as_mut_ptr() as *mut c_void,
    cwd.as_ptr(),
    &mut startup,
    &mut process_info,
);

// 2. Verificar herencia del Job custodio
require_process_in_job(child_process.raw(), custodian_job.raw(), "provider did not inherit custodian Job")?;

// 3. Asignar al Job del proveedor y verificar
AssignProcessToJobObject(provider_job.raw(), child_process.raw());
require_process_in_job(child_process.raw(), provider_job.raw(), "provider did not join provider Job")?;

// 4. Publicar started.json de forma inmutable
write_immutable_json(&started_path, &receipt_with_checksum(&started_material))?;

// 5. Reanudar la ejecución del proceso hijo
ResumeThread(child_thread.raw());
```

### 3.3. Encadenamiento Causal de Recibos (*Receipt Causal Chaining*)

El archivo `final.json` incluye obligatoriamente el campo `startedReceiptChecksum`, el cual referencia el hash SHA-256 exacto del `started.json` generado al inicio. Esto garantiza criptográficamente que ningún observador externo o proceso de recuperación pueda sintetizar un recibo final desconectado de su intento inicial verificado.

### 3.4. Protocolo de Terminación Segura y Fail-Closed

El comando `terminate` no realiza terminaciones ciegas por PID:
- Abre los Jobs `custodian_job` y `provider_job`.
- Si los Jobs ya no existen (por ejemplo, tras una caída del sistema), consulta `probe_identity` para el custodio y el proveedor.
- Si y solo si **ambas identidades duraderas están confirmadas como muertas** (`dead`), la operación se considera convergida.
- Si un PID fue reciclado por otro proceso (`different`) o no puede determinarse con certeza (`unknown`), la operación falla en modo cerrado (*fail-closed*) arrojando un error de permisos, impidiendo la terminación accidental de procesos no relacionados.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Operaciones de Línea de Comandos (CLI)

```
manyhands-windows-job-runner <comando> [argumentos...]
```

| Comando | Argumentos | Propósito |
|---|---|---|
| `run` | `<request_file_path>` | Lee el archivo de petición binaria, supervisa el proceso, gestiona jobs y emite recibos. |
| `probe` | `<pid> <expected_creation_identity>` | Consulta si el `<pid>` está vivo y coincide con `<expected_creation_identity>`. Imprime `same`, `different`, `dead` o `unknown`. |
| `terminate` | `<job_name> <provider_pid> <provider_expected> <custodian_pid> <custodian_expected>` | Finaliza de forma segura los Job Objects verificando la identidad de ambos procesos. |

### 4.2. Formato de la Petición Binaria (`MHJR1`)

El archivo de petición procesado por `run` posee la siguiente estructura binaria:
- Cabecera fija: 6 bytes con el texto `MHJR1\0`.
- Campos serializados como `[longitud u32 little-endian][bytes UTF-8]`:
  1. `receipt_directory`: Directorio donde se escribirán los recibos.
  2. `effect_id`: Identificador del efecto físico.
  3. `input_digest`: Hash canónico del input del efecto.
  4. `daemon_epoch`: Epoch del daemon invocador.
  5. `attempt_id`: Identificador del intento de ejecución.
  6. `supervisor_nonce`: Nonce del supervisor.
  7. `job_name`: Nombre base para los Job Objects.
  8. `cwd`: Directorio de trabajo del subproceso.
  9. `executable`: Ruta al ejecutable a lanzar.
  10. `stdout_path`: Ruta del archivo para capturar la salida estándar.
  11. `stderr_path`: Ruta del archivo para capturar el error estándar.
  12. `argc` (`u32`): Cantidad de argumentos, seguido de cada argumento `String`.
  13. `envc` (`u32`): Cantidad de variables de entorno, seguido de pares clave/valor `String`.

### 4.3. Esquemas de Recibos JSON

#### Recibo de Inicio (`started.json`)
```json
{
  "schemaVersion": 1,
  "effectId": "effect:01j9a8b7c6d5e4f3g2h1",
  "inputDigest": "sha256:4f8a3c2b1e...",
  "daemonEpoch": "epoch_01j9a8b7c6...",
  "attemptId": "attempt:01j9a8b7c6...",
  "processIdentity": {
    "pid": 14208,
    "creationIdentity": "windows:start-ticks:638596032000000000",
    "supervisorNonce": "nonce_7f8a9b0c"
  },
  "custodianIdentity": {
    "pid": 8940,
    "creationIdentity": "windows:start-ticks:638596031998000000",
    "supervisorNonce": "nonce_7f8a9b0c:custodian"
  },
  "platformOwnership": "manyhands-job-01j9a8b7",
  "stdoutPath": "C:\\Manyhands\\runs\\run1\\stdout.log",
  "stderrPath": "C:\\Manyhands\\runs\\run1\\stderr.log",
  "phase": "started",
  "startedAtEpochMs": 1755532800000,
  "receiptChecksum": "sha256:9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b"
}
```

#### Recibo Final de Terminación (`final.json`)
```json
{
  "schemaVersion": 1,
  "effectId": "effect:01j9a8b7c6d5e4f3g2h1",
  "inputDigest": "sha256:4f8a3c2b1e...",
  "daemonEpoch": "epoch_01j9a8b7c6...",
  "attemptId": "attempt:01j9a8b7c6...",
  "processIdentity": {
    "pid": 14208,
    "creationIdentity": "windows:start-ticks:638596032000000000",
    "supervisorNonce": "nonce_7f8a9b0c"
  },
  "custodianIdentity": {
    "pid": 8940,
    "creationIdentity": "windows:start-ticks:638596031998000000",
    "supervisorNonce": "nonce_7f8a9b0c:custodian"
  },
  "platformOwnership": "manyhands-job-01j9a8b7",
  "stdoutPath": "C:\\Manyhands\\runs\\run1\\stdout.log",
  "stderrPath": "C:\\Manyhands\\runs\\run1\\stderr.log",
  "phase": "final",
  "outcome": "succeeded",
  "exitCode": 0,
  "completedAtEpochMs": 1755532805000,
  "startedReceiptChecksum": "sha256:9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b",
  "receiptChecksum": "sha256:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
}
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan de rediseño canónico (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

- **Etapa 3 / GR (Daemon Foundation & Windows Custody)**: `windows-job-runner` implementa completamente la frontera de custodia nativa requerida en Windows, satisfaciendo los requisitos de aislamiento de procesos y emisión de recibos duraderos.
- **Etapa 7 / GA & Etapa 8 / GLeaf**: Actúa como el motor de confinamiento primario para la ejecución de workers que compilan artefactos y evalúan matrices de validación en entornos Windows.
- **Sin Dependencias Binarias Compiladas en el Repositorio**: Siguiendo la política de seguridad del proyecto, no se commitean binarios `.exe` en Git. El ejecutable debe ser compilado localmente con Cargo / rustc antes de iniciar el daemon.

---

## 6. Comandos de Verificación y Testing

```bash
# Verificar análisis estático de Rust (sin advertencias)
cargo check --manifest-path native/windows-job-runner/Cargo.toml

# Compilar binario de producción optimizado
cargo build --release --manifest-path native/windows-job-runner/Cargo.toml

# Ejecutar suite de pruebas de supervisión de procesos en execution-core
pnpm vitest run packages/execution-core/test/process-supervisor.test.ts
```
