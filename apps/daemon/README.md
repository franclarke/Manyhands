# @manyhands/daemon

Punto de composición privilegiado (*composition root*), autoridad única de escritura en el journal canónico de eventos, servidor de comunicación entre procesos (IPC) con autenticación criptográfica HMAC-SHA256, exclusión mutua de instalación mediante guardas tipo panadería de Lamport y supervisor de actores de ejecución duradera para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/daemon` es el proceso anfitrión central y privilegiado del sistema ManyHands en el entorno local del operador. Mientras que `@manyhands/web` actúa como cliente BFF (*Backend-for-Frontend*) y superficie de interacción visual, y los paquetes en `packages/*` implementan contratos y motores de dominio puros, `apps/daemon` asume la responsabilidad física y operativa integral del sistema:

1. **Autoridad Única de Escritura Canónica (*Single Authoritative Writer*)**: Es el único proceso autorizado en todo el sistema para añadir eventos de dominio productivos al journal persistente (`JsonlRunEventStore` en `.manyhands/daemon/runs/<runId>/events.v2.jsonl`). Esto elimina por diseño cualquier condición de carrera o conflicto multi-escritor entre procesos locales.
2. **Exclusión Mutua de Instalación (*Installation Mutual Exclusion*)**: Implementa un algoritmo de guarda distribuida basado en tickets de panadería de Lamport (`installation-lease.ts`) que garantiza que solo exista una instancia activa del daemon por cada directorio de estado (`MANYHANDS_DAEMON_STATE_ROOT`), protegiendo el lease frente a caídas abruptas mediante la verificación estricta de la identidad de inicio del proceso (*process start ticks*).
3. **Servidor IPC Local Criptográficamente Seguro**: Expone un socket Unix Domain o Windows Named Pipe autenticado mediante HMAC-SHA256 con claves derivadas de una *capability* de instalación de 256 bits, comparación en tiempo constante (`crypto.timingSafeEqual`) y caché de noce con expiración (`ExpiringNonceReplayCache`) para neutralizar ataques de repetición y accesos no autorizados de otros procesos del sistema operativo.
4. **Supervisión de Actores de Corrida (`RunActor`) y Reconciliación ante Caídas**: Aloja el `DurableRunEngine` y el registro `RunActorRegistry`. Al iniciar, escanea automáticamente el histórico de corridas y ejecuta una reconciliación secuencial no bloqueante de efectos físicos pendientes (`startupRecovery`), limpiando credenciales temporales intermediadas (*brokered credentials*) y restaurando el estado de los actores.
5. **Despacho Transaccional de Efectos Físicos**: Conecta los puertos del motor de corrida con adaptadores especializados (`ProcessSupervisor`, Git, planificación, materialización de artefactos, validación y entrega), garantizando que toda mutación física sea precedida por una intención inmutable registrada en el outbox (`FileEffectInputStore`).

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                              apps/web                                  │
 │           (Next.js 15 BFF Client / UI Projections / API Routes)         │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │  Local IPC (Unix Socket / Named Pipe)
                                     │  HMAC-SHA256 Signed Frames + Nonce Cache
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                            apps/daemon                                 │
 │                                                                        │
 │  ┌────────────────────────┐  ┌──────────────────────────────────────┐  │
 │  │ installation-lease.ts  │  │ local-ipc-server.ts                  │  │
 │  │ (Lamport Ticket Guard) │  │ (HMAC Auth & Replay Protection)      │  │
 │  └───────────┬────────────┘  └──────────────────┬───────────────────┘  │
 │              │ Epoch Assertion                  │ Commands / Queries   │
 │              ▼                                  ▼                      │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │           DurableRunEngine & RunActorRegistry                    │  │
 │  │                                                                  │  │
 │  │  ┌────────────────────────┐    ┌──────────────────────────────┐  │  │
 │  │  │ product-run-application│    │ FencedRunActorJournal        │  │  │
 │  │  │ (decide / react logic) │    │ (JsonlRunEventStore Writer)  │  │  │
 │  │  └───────────┬────────────┘    └──────────────┬───────────────┘  │  │
 │  │              │                                │                  │  │
 │  │              ▼                                ▼                  │  │
 │  │  ┌────────────────────────┐    ┌──────────────────────────────┐  │  │
 │  │  │ EffectDispatcher       │    │ .manyhands/daemon/runs/      │  │  │
 │  │  │ (Outbox Intents Store) │    │ <runId>/events.v2.jsonl      │  │  │
 │  │  └───────────┬────────────┘    └──────────────────────────────┘  │  │
 │  └──────────────┼───────────────────────────────────────────────────┘  │
 └─────────────────┼──────────────────────────────────────────────────────┘
                   │ Physical Effect Execution
                   ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │              Physical Adapters & Operating System Boundary             │
 │                                                                        │
 │  • native/windows-job-runner (Win32 Dual Job Objects Process Custody)  │
 │  • native/windows-ipc-acl (Protected DACLs: Current User + System)     │
 │  • Git Object Databases, Worktrees & Manifest Materialization          │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Arquitectura Modular Interna

El directorio `apps/daemon/src/` contiene los siguientes módulos especializados:

```
apps/daemon/src/
├── index.ts                         # Re-exportación pública de interfaces, tipos y funciones del daemon
├── cli.ts                           # Punto de entrada CLI ejecutable; parsea entorno, inicia daemon y gestiona señales
├── daemon-kernel.ts                 # Composición central del kernel: lease, stores, engine, recovery e IPC server
├── daemon-profile.ts                # Resolución de perfiles de ejecución: deterministic_fake, transitional_unsafe, sandboxed_live
├── productive-daemon.ts             # Ensamblado del daemon productivo con adaptadores físicos y políticas de aplicación
├── product-run-application.ts       # Máquinas de decisión y reacción (decide/react) para comandos de producto
├── local-ipc-server.ts              # Servidor TCP/IPC local con autenticación HMAC-SHA256, control de tramas y caché de nonces
├── native-preflight.ts             # Auto-resolución de binarios nativos (.manyhands/bin, target/release) y diagnóstico
├── windows-ipc-acl.ts               # Integración en TypeScript con el ejecutable nativo windows-ipc-acl
├── installation-lease.ts            # Algoritmo de guarda de tickets (Lamport) para exclusión mutua de instalación
├── installation-capability.ts       # Generación y validación de tokens de capability de 256 bits con DACL restringida
├── local-process-identity.ts        # Extracción determinista de start ticks de procesos en Windows y Linux
├── process-effect-adapters.ts       # Adaptadores de efectos físicos para creación y terminación de subprocesos supervisados
├── current-lifecycle-adapters.ts    # Adaptadores transicionales para PlanningEngine, RepositoryModel y TransactionalDelivery
├── canonical-planning-contract.ts   # Constructores de contratos canónicos de objetivos, estrategias y obligaciones
├── node-activity.ts                 # Proveedor de consultas para logs y trazas de streaming desde JsonlTraceStore
├── stage8-sandbox.ts                # Configuración de proveedores de sandboxing e intermediación de credenciales (Codex)
├── transitional-repository-lease.ts # Bloqueo mutex exclusivo sobre repositorios Git locales durante la ejecución
├── transitional-unsafe-profile.ts   # Configuración de adaptadores y almacén de resultados para workers transicionales
├── transitional-unsafe-worker.ts    # Worker hijo que ejecuta intentos mediante CanonicalExecutionDriver
└── deterministic-fake-worker.ts     # Worker simulado determinista con árbol de procesos para pruebas de caídas
```

### Desglose Detallado de Módulos

- **`cli.ts`**:
  - Punto de entrada ejecutable de Node.js (`dist/cli.cjs`).
  - Resuelve las variables de entorno (`MANYHANDS_DAEMON_STATE_ROOT`, `MANYHANDS_DAEMON_ENDPOINT`, `MANYHANDS_DAEMON_PROFILE`, `MANYHANDS_WINDOWS_JOB_RUNNER`, `MANYHANDS_WINDOWS_IPC_ACL_HELPER`).
  - Valida en Windows la presencia obligatoria de los ejecutables auxiliares en modo producción.
  - Emite en `stdout` el evento canónico `{"event":"manyhands.daemon.ready",...}` y captura `SIGINT`/`SIGTERM` para un cierre ordenado (`kernel.close()`).
- **`daemon-kernel.ts`**:
  - Función `startDaemonKernel(options)`: Instancia la raíz de composición uniendo `acquireInstallationLease`, `ensureInstallationCapability`, `JsonlRunEventStore`, `FileEffectInputStore`, `FilePhysicalEffectReceiptStore`, `KindAwarePhysicalEffectDispatcher`, `RunActorRegistry`, `DurableRunEngine` y `startLocalIpcServer`.
  - Provee la propiedad `startupRecovery: Promise<void>` que permite a las pruebas de crash-recovery esperar a que todos los efectos previos pendientes se hayan reconciliado secuencialmente.
- **`daemon-profile.ts`**:
  - Función `resolveDaemonProfile`: Configura las rutas de ejecutables de workers y determina si se utiliza el perfil `deterministic_fake` (para tests), `transitional_unsafe` o `sandboxed_live` (con soporte para agentes LLM en sandbox).
- **`productive-daemon.ts`**:
  - Función `startProductiveDaemon`: Ensambla el supervisor de procesos (`ProcessSupervisor`), los adaptadores de efectos físicos (`createProcessSpawnPhysicalEffectAdapter`, `createProcessTerminatePhysicalEffectAdapter`, adaptadores de ciclo de vida de `current-lifecycle-adapters.ts`) y enlaza las políticas de decisión de `product-run-application.ts`.
- **`product-run-application.ts`**:
  - Define las funciones `decide` y `react` consumidas por `RunActor`. Traduce comandos de producto de alto nivel (`create_run`, `start_run`, `pause_run`, `resume_run`, `restart_run`, `cancel_run`, `resolve_decision`, `deliver_run`) en eventos de dominio canónicos e intenciones de efectos físicos (`EffectIntent`).
- **`local-ipc-server.ts`**:
  - Gestiona la capa de transporte local (`net.Server`). Procesa mensajes delimitados por saltos de línea con un tamaño máximo estricto (`IPC_DEFAULT_MAX_FRAME_BYTES = 1 MB`).
  - Valida la firma HMAC-SHA256 calculada sobre la canonicalización de la petición (`canonicalIpcRequestAuthenticationMaterial`).
  - Mantiene la clase `ExpiringNonceReplayCache` que rechaza cualquier reintento o replay dentro de una ventana de desfase de reloj máxima de 30 segundos (`IPC_DEFAULT_MAX_CLOCK_SKEW_MS`) y TTL de 60 segundos (`IPC_DEFAULT_NONCE_TTL_MS`).
- **`installation-lease.ts`**:
  - Implementa `acquireInstallationLease`. Utiliza un protocolo de guarda de tickets en subdirectorios (`daemon.lease.guard/claims/<uuid>/owner.json` y `ticket.json`) para prevenir condiciones de carrera cuando múltiples procesos compiten por el control del lease.
  - Verifica la vigencia de los procesos mediante `ProcessIdentityProbe`, consultando los *start ticks* del kernel para determinar con precisión si un proceso anterior murió o si el PID fue reciclado por el sistema operativo.
- **`installation-capability.ts`**:
  - Genera o recupera de forma segura el secreto de instalación de 32 bytes codificado en Base64URL (`.manyhands/daemon/installation/ipc-capability`).
  - En entornos POSIX aplica permisos `0600`; en Windows delega en `windows-ipc-acl.ts` para aplicar una DACL protegida.
- **`local-process-identity.ts`**:
  - Obtiene la identidad de creación del proceso actual y de procesos remotos:
    - En Windows: Ejecuta un comando de PowerShell para extraer el valor en ticks de 100ns de `Process.StartTime.UtcTicks` (`windows:start-ticks:<ticks>`).
    - En Linux: Lee el campo `starttime` en `/proc/[pid]/stat` (`posix:stat-starttime:<ticks>`).
- **`windows-ipc-acl.ts`**:
  - Envoltorio TypeScript que ejecuta el binario `windows-ipc-acl.exe` en los modos `apply`, `verify`, `serve-pipe` y `verify-pipe`.
- **`process-effect-adapters.ts`**:
  - Define `createProcessSpawnPhysicalEffectAdapter` y `createProcessTerminatePhysicalEffectAdapter`, los cuales traducen intenciones de efecto `process_spawn` y `process_terminate` hacia el `ProcessSupervisor` de `@manyhands/execution-core`.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Algoritmo de Guarda de Tickets de Lamport para el Lease de Instalación

Para asegurar que dos instancias de ManyHands no escriban simultáneamente en el mismo directorio de estado, `apps/daemon` implementa una variante robusta del algoritmo de panadería de Lamport en el sistema de archivos:

```
Proceso A (Candidato)                       Sistema de Archivos (daemon.lease.guard)
        │                                                     │
        ├─── 1. Crea directorio de reclamo con UUID ─────────►│ claims/<uuidA>/owner.json
        │                                                     │
        ├─── 2. Escribe ticket incremental (ticket.json) ────►│ claims/<uuidA>/ticket.json
        │                                                     │
        ├─── 3. Escanea todos los reclamos concurrentes ─────►│ Revisa claims/*
        │                                                     │
        ├─── 4. Si existe ticket menor o UUID menor: ────────►│ Espera con backoff (5ms)
        │       espera a que el reclamo anterior libere       │
        │                                                     │
        ├─── 5. Adquiere sección crítica: ───────────────────►│ Escribe staging/<uuidA>/owner.json
        │       Inspecciona daemon.lease/owner.json           │ Reemplazo atómico vía rename
        │       Verifica PID y start ticks con el Kernel      │
        │                                                     │
        └─── 6. Elimina reclamo y libera guarda ──────────────►│ Elimina claims/<uuidA>
```

Si el dueño registrado en `daemon.lease/owner.json` corresponde a un PID activo cuyos *start ticks* coinciden exactamente con el kernel, la adquisición falla inmediatamente con `InstallationLeaseUnavailableError`. Si el PID ya no existe o sus ticks difieren (el sistema operativo recicló el PID tras un reinicio), el candidato asume el control del lease de forma determinista y segura.

### 3.2. Servidor IPC Local con Autenticación HMAC-SHA256 y Protección Anti-Replay

La comunicación entre `apps/web` y `apps/daemon` se realiza a través de un canal IPC local autenticado. El protocolo opera de la siguiente manera:

1. **Material de Autenticación Canónico**:
   - Petición: `V1\n<requestId>\n<nonce>\n<timestampEpochMs>\n<capabilityToken>\n<canonicalJsonBody>`
   - Respuesta: `V1\n<requestId>\n<nonce>\n<timestampEpochMs>\n<requestSignature>\n<canonicalJsonBody>`
2. **Comparación en Tiempo Constante**:
   La firma recibida se compara utilizando `crypto.timingSafeEqual(Buffer.from(signatureHex), Buffer.from(computedHex))` para evitar ataques de temporización (*timing attacks*).
3. **Caché de Noce con Expiración (`ExpiringNonceReplayCache`)**:
   Registra el par `requestId` y `nonce` junto con su marca de tiempo. Si se recibe un nonce duplicado dentro de la ventana de validez (TTL de 60 segundos) o si el reloj del cliente difiere en más de 30 segundos del daemon, la petición es rechazada de inmediato.

```
       apps/web (Cliente IPC)                        apps/daemon (Local IPC Server)
                 │                                                  │
                 ├─── 1. Genera requestId, nonce, timestamp ────────┤
                 ├─── 2. Firma cuerpo con HMAC-SHA256 ──────────────┤
                 │                                                  │
                 ├─── 3. Envía trama JSON delimitada por \n ───────►│
                 │       {"v":1,"requestId":...,"sig":...}          │
                 │                                                  ├─── 4. Valida tamaño <= 1 MB
                 │                                                  ├─── 5. Valida skew de reloj (<= 30s)
                 │                                                  ├─── 6. Verifica replay en NonceCache
                 │                                                  ├─── 7. timingSafeEqual(sig, computed)
                 │                                                  │
                 │                                                  ├─── 8. Ejecuta comando en RunEngine
                 │                                                  ├─── 9. Firma respuesta con HMAC-SHA256
                 │◄── 10. Recibe trama de respuesta firmada ────────┤
```

### 3.3. Aislamiento Fenced de Actores y Epoch de Daemon

Cada corrida es gestionada por un `RunActor` exclusivo cuya autoridad está protegida por una tupla de fencing:
- Cada inicio del daemon genera un identificador único `daemonEpoch`.
- Toda escritura en el journal mediante `FencedRunActorJournal` valida que la autoridad de instalación continúe vigente (`lease.assertCurrent()`). Si el daemon pierde el lease o es reemplazado por otro proceso, las escrituras fallan de inmediato con `InstallationLeaseLostError`, impidiendo la corrupción del histórico.

### 3.4. Reconciliación Secuencial de Recuperación de Inicio (*Startup Recovery*)

Al arrancar, el daemon ejecuta `startupRecovery` en segundo plano sin bloquear la aceptación inmediata de comandos en el socket IPC:
- Elimina cualquier credencial residual del broker (`purgeAllBrokeredCredentials`).
- Itera sobre todas las corridas registradas en `JsonlRunEventStore`.
- Para cada corrida, el `RunActorRegistry` instancia el actor y ejecuta `recoverPendingEffects()`, consultando los recibos en disco (`FilePhysicalEffectReceiptStore`) y el estado del supervisor de procesos (`ProcessSupervisor`).
- Si un comando llega para una corrida que aún se encuentra en proceso de recuperación, el registro enlaza la petición a la misma promesa en vuelo, evitando ejecuciones concurrentes o duplicadas.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Funciones y Tipos Principales

| Símbolo | Archivo de Origen | Descripción |
|---|---|---|
| `startDaemonKernel(options)` | `src/daemon-kernel.ts` | Inicializa la raíz de composición completa (lease, stores, engine e IPC). |
| `startProductiveDaemon(options)`| `src/productive-daemon.ts`| Configura el daemon productivo con adaptadores físicos y perfiles resueltos. |
| `acquireInstallationLease(path, opts)`| `src/installation-lease.ts`| Adquiere el lease exclusivo con algoritmo de guarda y verificación de ticks. |
| `ensureInstallationCapability(dir, opts)`| `src/installation-capability.ts`| Crea o recupera el token secreto de IPC con permisos restringidos de SO. |
| `startLocalIpcServer(options)` | `src/local-ipc-server.ts` | Levanta el servidor IPC con HMAC-SHA256 y caché de nonces. |
| `resolveDaemonProfile(options)`| `src/daemon-profile.ts` | Resuelve la configuración según `MANYHANDS_DAEMON_PROFILE`. |
| `createProcessSpawnPhysicalEffectAdapter`| `src/process-effect-adapters.ts`| Adaptador para lanzar procesos supervisados bajo Job Objects. |
| `createProcessTerminatePhysicalEffectAdapter`| `src/process-effect-adapters.ts`| Adaptador para finalizar procesos supervisados de forma atómica. |
| `readNodeActivity(options)` | `src/node-activity.ts` | Consulta trazas y logs de un nodo específico en `JsonlTraceStore`. |

### 4.2. Variables de Entorno del Daemon

| Variable de Entorno | Tipo / Valores | Valor por Defecto | Propósito |
|---|---|---|---|
| `MANYHANDS_DAEMON_STATE_ROOT` | Ruta absoluta | `.manyhands/daemon` | Directorio raíz para lease, capability, corridas y almacén de efectos. |
| `MANYHANDS_DAEMON_ENDPOINT` | Ruta o Pipe | `\\.\pipe\manyhands-daemon-<hash>` (Win) / `daemon.sock` (POSIX) | Endpoint de conexión para clientes IPC locales. |
| `MANYHANDS_DAEMON_PROFILE` | `deterministic_fake` \| `transitional_unsafe` \| `sandboxed_live` | `transitional_unsafe` | Perfil de ejecución de workers y modelos. |
| `MANYHANDS_WINDOWS_JOB_RUNNER` | Ruta absoluta | (Requerido en Windows) | Ruta al ejecutable `windows-job-runner.exe`. |
| `MANYHANDS_WINDOWS_IPC_ACL_HELPER` | Ruta absoluta | (Requerido en Win prod) | Ruta al ejecutable `windows-ipc-acl.exe`. |
| `MANYHANDS_CODEX_AUTH_PATH` | Ruta absoluta | Opcional | Archivo de credenciales para el perfil `sandboxed_live`. |
| `MANYHANDS_STAGE8_WINDOWS_SANDBOX` | `elevated` \| `unelevated` | `unelevated` | Modo de contención en Windows para sandboxes de Etapa 8. |

### 4.3. Protocolo de Mensajes IPC

#### Solicitud de Comando (`submit`)
```json
{
  "v": 1,
  "requestId": "req_01j9a8b7c6d5e4f3g2h1",
  "nonce": "nonce_7f8a9b0c1d2e3f4a",
  "timestampEpochMs": 1755532800000,
  "body": {
    "kind": "submit",
    "command": {
      "schemaVersion": 1,
      "commandId": "command:9f83acb...",
      "runId": "run:1a2b3c4d...",
      "expectedRevision": 0,
      "issuedAt": "2026-08-18T16:00:00.000Z",
      "payload": {
        "kind": "create_run",
        "title": "Fix memory leak in buffer pool",
        "workspaceId": "ws-default",
        "repositoryPath": "C:\\Proyectos\\MiRepo",
        "goal": "Refactor BufferPool to avoid unbounded allocations"
      }
    }
  },
  "signature": "a1b2c3d4e5f6... (HMAC-SHA256 hex)"
}
```

#### Solicitud de Consulta (`query`)
```json
{
  "v": 1,
  "requestId": "req_01j9a8b7c6d5e4f3g2h2",
  "nonce": "nonce_1a2b3c4d5e6f7a8b",
  "timestampEpochMs": 1755532801000,
  "body": {
    "kind": "query",
    "runId": "run:1a2b3c4d...",
    "query": "projection"
  },
  "signature": "f6e5d4c3b2a1... (HMAC-SHA256 hex)"
}
```

#### Solicitud de Eventos Listos (`eventsReady`)
```json
{
  "v": 1,
  "requestId": "req_01j9a8b7c6d5e4f3g2h3",
  "nonce": "nonce_9c8b7a6f5e4d3c2b",
  "timestampEpochMs": 1755532802000,
  "body": {
    "kind": "eventsReady",
    "runId": "run:1a2b3c4d...",
    "afterSequence": 15
  },
  "signature": "8a7b6c5d4e3f... (HMAC-SHA256 hex)"
}
```

---

## 5. Ejemplo de Inicialización Programática

```typescript
import path from "node:path";
import { createHash } from "node:crypto";
import { startProductiveDaemon, resolveDaemonProfile } from "@manyhands/daemon";
import { currentProcessStartIdentity, createLocalProcessIdentityProbe } from "@manyhands/daemon";

async function runDaemon() {
  const stateRoot = path.resolve(".manyhands/daemon");
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\manyhands-daemon-prod`
    : path.join(stateRoot, "daemon.sock");

  const resolved = resolveDaemonProfile({
    stateRoot,
    daemonDirectory: __dirname,
    cwd: process.cwd(),
    nodeExecutable: process.execPath
  });

  const kernel = await startProductiveDaemon({
    stateRoot,
    endpoint,
    processStartIdentity: await currentProcessStartIdentity(),
    processIdentityProbe: createLocalProcessIdentityProbe(),
    profile: resolved.profile,
    windowsJobRunnerPath: "C:\\Manyhands\\native\\target\\release\\windows-job-runner.exe",
    production: true
  });

  console.log(`Daemon iniciado en ${kernel.endpoint} con epoch ${kernel.daemonEpoch}`);

  // Esperar a que la reconciliación de corridas previas finalice
  await kernel.startupRecovery;
  console.log("Reconciliación de recuperación de inicio completada exitosamente.");
}
```

---

## 6. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan canónico de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`), `apps/daemon` cumple con los hitos de las siguientes etapas:

- **Etapa 3 / GR (Run Daemon Core & Local IPC)**: Implementación completa del servidor IPC autenticado, exclusión mutua mediante lease con tickets de Lamport y journaling canónico con fencing.
- **Etapa 7 / GA (Git-Native Artifacts & Validation)**: El daemon conecta el almacén de entradas de efectos físicos (`FileEffectInputStore`) con la materialización de manifiestos y construcción de matrices de evidencia exactas.
- **Etapa 8 / GLeaf (Sandboxed Leaf Execution)**: Integración del supervisor de procesos con contención estricta mediante `windows-job-runner`, soporte de credenciales temporales y perfil `sandboxed_live`.
- **Etapa 9 / GI (Hierarchical Integration & Convergence)**: Despacho de intentos de integración compuesta y control de barreras de sincronización.
- **Etapa 10 / GDel (Exact Delivery Invariants)**: Despacho del efecto transaccional de entrega (`delivery`), publicando referencias inmutables en el repositorio Git de destino únicamente cuando la matriz de evidencia está completa.
- **Brechas Transicionales Existentes**:
  - `transitional-unsafe-worker.ts` y `current-lifecycle-adapters.ts` actúan como puentes de compatibilidad mientras se completan las etapas 11 a 13.
  - Dichos componentes se encuentran estrictamente aislados detrás de las intenciones de efectos canónicos y almacenes de recibos, sin violar la invariante de escritor único.

---

## 7. Comandos de Verificación y Testing

### Verificación de Tipos y Compilación
```bash
# Typecheck estricto del paquete daemon
pnpm --filter @manyhands/daemon typecheck

# Compilación de bundles (dist/index.cjs, dist/cli.cjs, dist/workers)
pnpm --filter @manyhands/daemon build
```

### Ejecución de Pruebas Unitarias y de Integración
```bash
# Ejecutar suite de pruebas de daemon y servidores IPC
pnpm vitest run apps/daemon

# Pruebas integrales de crash-recovery y concurrencia de leases
pnpm vitest run apps/daemon/test/installation-lease.test.ts
pnpm vitest run apps/daemon/test/local-ipc-server.test.ts
```
