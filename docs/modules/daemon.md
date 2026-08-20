# Guía Arquitectónica: @manyhands/daemon

> **Ubicación en el Monorepo**: `apps/daemon/`  
> **README de la Aplicación**: [`../../apps/daemon/README.md`](../../apps/daemon/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas de desarrollo de software donde se ejecutan procesos privilegiados, se manejan credenciales de proveedores LLM y se efectúan mutaciones directas sobre el sistema de archivos del usuario, confiar la ejecución a procesos de navegador o a un servidor web sin fronteras de seguridad estrictas introduce vulnerabilidades graves de *DNS Rebinding*, ataques CSRF y condiciones de carrera entre múltiples instancias.

**`apps/daemon`** es el **proceso anfitrión privilegiado y raíz de composición (*composition root*)** de ManyHands en la máquina local del operador:
1. **Autoridad Única de Escritura Canónica (*Single Authoritative Writer*)**: Es el único proceso autorizado en todo el sistema para escribir en el journal persistente de eventos (`.manyhands/daemon/runs/<runId>/events.v2.jsonl`).
2. **Exclusión Mutua de Instalación (*Installation Mutual Exclusion*)**: Implementa un algoritmo de guarda distribuida basado en tickets de panadería de Lamport (`installation-lease.ts`) que asegura que solo exista una instancia activa del daemon por directorio de estado, verificando los ticks de inicio del proceso en el kernel (*process start ticks*) para prevenir colisiones por reciclaje de PIDs.
3. **Servidor IPC Local Criptográficamente Seguro**: Expone un socket Unix Domain o Windows Named Pipe autenticado con HMAC-SHA256, comparación en tiempo constante (`timingSafeEqual`) y caché de nonces con expiración (`ExpiringNonceReplayCache`) para neutralizar ataques de repetición.
4. **Supervisión de Actores (`RunActor`) y Reconciliación ante Caídas**: Aloja el `DurableRunEngine` y `RunActorRegistry`. Al arrancar, ejecuta una reconciliación secuencial no bloqueante de efectos físicos pendientes (`startupRecovery`), limpiando credenciales temporales y restaurando el estado de las corridas.
5. **Despacho Transaccional de Efectos Físicos**: Conecta los puertos del motor de corrida con adaptadores especializados (`ProcessSupervisor`, Git, planificación, materialización de artefactos, validación y entrega).

---

## 2. Arquitectura Interna y Componentes

El código fuente en `apps/daemon/src/` contiene los siguientes módulos especializados:

```
apps/daemon/src/
├── index.ts                         # Re-exportación pública de interfaces, tipos y funciones
├── cli.ts                           # Punto de entrada CLI; parsea entorno, inicia daemon y gestiona señales
├── daemon-kernel.ts                 # Composición central: lease, stores, engine, recovery e IPC server
├── daemon-profile.ts                # Resolución de perfiles: deterministic_fake, transitional_unsafe, sandboxed_live
├── productive-daemon.ts             # Ensamblado del daemon productivo con adaptadores físicos y políticas
├── product-run-application.ts       # Máquinas de decisión y reacción (decide/react) para comandos de producto
├── local-ipc-server.ts              # Servidor IPC local con autenticación HMAC-SHA256 y caché de nonces
├── windows-ipc-acl.ts               # Integración con el binario nativo windows-ipc-acl
├── installation-lease.ts            # Algoritmo de guarda de tickets (Lamport) para exclusión mutua
├── installation-capability.ts       # Generación de tokens de capability de 256 bits con DACL protegida
├── local-process-identity.ts        # Extracción determinista de start ticks de procesos en Windows y Linux
├── process-effect-adapters.ts       # Adaptadores para creación y terminación de subprocesos supervisados
├── current-lifecycle-adapters.ts    # Adaptadores para PlanningEngine, RepositoryModel y Delivery
├── canonical-planning-contract.ts   # Constructores de contratos canónicos de planificación
├── node-activity.ts                 # Consultas para logs y trazas de streaming desde JsonlTraceStore
├── stage8-sandbox.ts                # Proveedores de sandboxing e intermediación de credenciales
├── transitional-repository-lease.ts # Bloqueo mutex exclusivo sobre repositorios locales
├── transitional-unsafe-profile.ts   # Configuración de adaptadores para workers transicionales
├── transitional-unsafe-worker.ts    # Worker hijo que ejecuta intentos mediante CanonicalExecutionDriver
└── deterministic-fake-worker.ts     # Worker simulado con árbol de procesos para pruebas de caídas
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `cli.ts` | Punto de entrada ejecutable. Resuelve variables de entorno, valida la presencia de binarios nativos en Windows, emite `manyhands.daemon.ready` en stdout y gestiona el cierre ordenado (`SIGINT`/`SIGTERM`). |
| `daemon-kernel.ts` | Función `startDaemonKernel`: Ensambla el lease de instalación, almacenes de eventos y efectos, registro de actores, motor duradero, reconciliación de inicio y servidor IPC. |
| `installation-lease.ts` | Implementa `acquireInstallationLease` mediante un protocolo de guarda de tickets en subdirectorios (`daemon.lease.guard/`), verificando la vigencia de procesos con `ProcessIdentityProbe`. |
| `local-ipc-server.ts` | Gestiona el transporte IPC local, valida firmas HMAC-SHA256 sobre peticiones canonicalizadas y rechaza replays mediante `ExpiringNonceReplayCache`. |
| `native-preflight.ts` | Auto-resolución de binarios nativos en `.manyhands/bin/` y `target/release`, emitiendo diagnósticos accionables en caso de componentes faltantes. |
| `productive-daemon.ts` | Ensambla el daemon de producción uniendo `ProcessSupervisor`, adaptadores físicos de Git y subprocesos, y las políticas de `product-run-application.ts`. |
| `product-run-application.ts` | Define `decide` y `react` consumidas por `RunActor`, traduciendo comandos de producto (`create_run`, `start_run`, `pause_run`, `cancel_run`, `deliver_run`) en eventos canónicos e intenciones de efectos. |
| `local-process-identity.ts` | Extrae marcas de tiempo de creación del proceso en ticks de 100ns (`windows:start-ticks:<ticks>` en Windows y `posix:stat-starttime:<ticks>` en Linux). |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra la arquitectura de capas y el flujo de comunicación desde `apps/web` hacia el kernel del daemon y los adaptadores nativos:

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

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Funciones Principales de Composición y Servicios

```typescript
export function startDaemonKernel(
  options: DaemonKernelOptions
): Promise<DaemonKernel>;

export function startProductiveDaemon(
  options: ProductiveDaemonOptions
): Promise<ProductiveDaemonInstance>;

export function acquireInstallationLease(
  options: InstallationLeaseOptions
): Promise<InstallationLease>;

export function startLocalIpcServer(
  options: LocalIpcServerOptions
): Promise<LocalIpcServer>;

export function ensureInstallationCapability(
  capabilityPath: string,
  options?: EnsureInstallationCapabilityOptions
): Promise<InstallationCapabilityRecord>;

export function resolveDaemonProfile(
  profileName?: string,
  options?: ResolveDaemonProfileOptions
): DaemonProfileConfiguration;
```

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Algoritmo de Guarda de Tickets de Lamport para el Lease de Instalación
Para asegurar que dos instancias del daemon no escriban simultáneamente en el mismo directorio de estado:
1. El proceso candidato crea un directorio de reclamo con UUID (`claims/<uuid>/owner.json`).
2. Escribe un ticket incremental (`ticket.json`).
3. Escanea todos los reclamos concurrentes; si existe un ticket o UUID menor, espera con backoff.
4. Adquiere la sección crítica e inspecciona `daemon.lease/owner.json`.
5. Consulta al kernel los *start ticks* del proceso anterior para determinar si el proceso murió o si el PID fue reciclado.
6. Reemplaza atómicamente el lease mediante rename y libera la guarda.

### 2. Servidor IPC Local con Autenticación HMAC-SHA256 y Anti-Replay
El transporte IPC local (`local-ipc-server.ts`) neutraliza accesos no autorizados:
- **Firma HMAC-SHA256**: Cada petición incluye un frame firmado con el secreto de 256 bits de la instalación (`ipc-capability`).
- **Tiempo Constante**: La firma se valida con `crypto.timingSafeEqual`, previniendo ataques de temporización (*timing attacks*).
- **Caché de Nonces con Expiración (`ExpiringNonceReplayCache`)**: Cada petición incluye un nonce aleatorio y un timestamp UTC. Se rechazan peticiones con desfase de reloj mayor a 30s o nonces duplicados en una ventana de 60s.

### 3. Reconciliación Secuencial en el Arranque (`startupRecovery`)
Al instanciar `startDaemonKernel`, la promesa `startupRecovery` escanea el journal de todas las corridas activas, reconcilia efectos pendientes (procesos huérfanos, credenciales intermediadas residuales) y garantiza que el sistema esté en un estado limpio antes de aceptar nuevos comandos.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 2 / GD0+GD1 y Stage 3 / GR)**: El kernel del daemon, el lease de instalación, el servidor IPC seguro y los adaptadores productivos están completamente cerrados y verificados.
2. **Workers Supervisados (Stage 8 / GLeaf)**: Soporta la ejecución de workers desacoplados en procesos hijos confinados por Windows Job Objects (`native/windows-job-runner`).

---

## 7. Navegación y Referencias

- **README de la Aplicación**: [`../../apps/daemon/README.md`](../../apps/daemon/README.md)
- **Módulos Relacionados**:
  - [`run-engine.md`](./run-engine.md): Kernel de actores duraderos hospedado por el daemon.
  - [`web.md`](./web.md): Cliente BFF que se comunica con el daemon vía IPC autenticado.
  - [`windows-job-runner.md`](./windows-job-runner.md): Custodio Win32 de procesos supervisados.
  - [`windows-ipc-acl.md`](./windows-ipc-acl.md): Guardián de seguridad para Named Pipes y DACLs.
- **Documentación Central**: [`../README.md`](../README.md)
