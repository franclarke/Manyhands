# Guía Arquitectónica: @manyhands/web

> **Ubicación en el Monorepo**: `apps/web/`  
> **README de la Aplicación**: [`../../apps/web/README.md`](../../apps/web/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas de ingeniería de software con agentes autónomos, la interfaz de usuario debe ofrecer máxima claridad cognitiva sin comprometer la seguridad del sistema local ni interferir con la ejecución física de las tareas.

**`apps/web`** constituye la superficie visual, el **Command Center** y el **Run Cockpit** de ManyHands. Diseñada con Next.js 15 (App Router), React 19, Tailwind CSS 4 y `@xyflow/react`, actúa como un cliente BFF (*Backend-for-Frontend*) completamente desacoplado de la custodia de procesos y del almacenamiento directo:

1. **Cliente BFF de Servidor Puro (*Pure Server BFF Client*)**: No almacena estado mutable en memoria ni ejecuta procesos en segundo plano. Todas las operaciones (creación de corridas, inicio, pausa, reanudación, reinicio, cancelación, resolución de decisiones y entrega) se firman y envían a `apps/daemon` mediante llamadas IPC locales autenticadas (`productive-client.ts`).
2. **Frontera de Seguridad Local Estricta (`boundary.ts`)**: Defiende el entorno local frente a amenazas originadas en el navegador:
   - Mitigación de *DNS Rebinding* mediante validación rigurosa de la cabecera `Host` (restringida a loopback).
   - Mitigación de *CSRF* mediante comprobación estricta de `Origin` y rechazo de orígenes `"null"`.
   - Validación de token de sesión efímero (`mh_session` con `SameSite=Strict` o cabecera `x-manyhands-session`) en todas las mutaciones.
   - Exigencia de `Content-Type: application/json` en métodos mutantes.
3. **Proyección Reactiva Basada en Eventos (*Event-Sourced UI*)**: Consume el flujo de eventos canónicos del daemon vía Server-Sent Events (SSE) en `/api/runs/[id]/run-events` y reconstruye deterministamente el estado de la corrida, los contratos y la matriz de evidencia mediante un reductor puro (`reducer.ts`).
4. **Visualización de Grafos Sin Saltos Disruptivos de Viewport**: Renderiza el grafo de ejecución con `@xyflow/react` cumpliendo el principio de estabilidad visual: **el canvas nunca reencuadra ni fuerza zoom automáticamente ante eventos de ejecución**, preservando el foco de atención del operador.
5. **Centro de Decisiones Accesible (WCAG 2.2 AA)**: Permite inspeccionar diffs, contratos de costura y resolver solicitudes humanas sin bloquear la ejecución de ramas paralelas independientes.

---

## 2. Arquitectura Interna y Componentes

El código fuente en `apps/web/src/` está organizado en las siguientes capas:

```
apps/web/src/
├── middleware.ts                         # Middleware global de Next.js que aplica la frontera de seguridad
├── app/                                  # App Router de Next.js 15
│   ├── layout.tsx                        # Layout raíz con navegación lateral
│   ├── page.tsx                          # Página de inicio del Command Center
│   ├── (command-center)/                 # Formularios de inicio de corrida, selector de repositorio y prompts
│   ├── runs/
│   │   ├── [runId]/                      # Espacio de trabajo del Run Cockpit (Server Component + Client View)
│   │   │   ├── page.tsx                  # Entrada de servidor con carga de proyección inicial
│   │   │   └── _components/              # Componentes de UI del Cockpit (Grafo, Nodos, Decisiones, Diffs)
│   │   └── proto/[fixture]/              # Reproductor de fixtures de prueba para desarrollo aislado de UI
│   └── api/                              # 18 Rutas de API REST y SSE (BFF hacia apps/daemon)
│       ├── capabilities/route.ts         # Consulta de capacidades de modelos y proveedores
│       ├── health/route.ts               # Endpoint de verificación de salud
│       ├── local-fs/pick-folder/route.ts # Invocación del selector de carpetas nativo del SO
│       ├── providers/readiness/route.ts  # Detección de herramientas locales instaladas (git, codex, claude)
│       ├── runs/route.ts                 # Listado y creación de corridas
│       ├── runs/[id]/route.ts            # Consulta de proyección, renombrado y archivado
│       ├── runs/[id]/run/route.ts        # Inicio y continuación de ondas de ejecución
│       ├── runs/[id]/pause/route.ts      # Pausa de la corrida
│       ├── runs/[id]/resume/route.ts     # Reanudación de corrida pausada
│       ├── runs/[id]/restart/route.ts    # Reinicio de intentos fallidos o interrumpidos
│       ├── runs/[id]/cancel/route.ts     # Cancelación y detención de procesos
│       ├── runs/[id]/deliver/route.ts    # Publicación y entrega transaccional a Git
│       ├── runs/[id]/run-events/route.ts # Streaming SSE de eventos canónicos con reconexión
│       ├── runs/[id]/decisions/[decisionId]/route.ts # Resolución de decisiones humanas
│       ├── runs/[id]/nodes/[nodeId]/activity/route.ts # Trazas y actividad en streaming de un nodo
│       ├── workspaces/route.ts           # CRUD de espacios de trabajo locales
│       ├── workspaces/[id]/route.ts      # Consulta y eliminación de workspace
│       └── workspaces/migration-conflicts/[duplicateId]/route.ts # Resolución de duplicados
├── components/                           # Componentes de diseño compartidos (UI primitives, botones, inputs)
└── lib/
    ├── run-model/                        # Modelo de estado y reductor de eventos para el cliente
    │   ├── types.ts                      # Tipos de vistas de grafo, nodos y aristas para React Flow
    │   ├── reducer.ts                    # Reductor puro que pliega RunEvents en RunProjection
    │   ├── flow-layout.ts                # Algoritmo de distribución espacial y bandas de integración
    │   ├── sse-adapter.ts                # Adaptador de reconexión SSE con seguimiento de secuencias
    │   └── graph-view.ts                 # Mapeo de contratos y relaciones tipadas a aristas de UI
    └── server/                           # Lógica del servidor Next.js
        ├── daemon/                       # Clientes IPC hacia apps/daemon
        │   ├── productive-client.ts      # Cliente tipado de alto nivel (comandos, consultas, SSE)
        │   └── local-ipc-client.ts       # Transporte IPC de bajo nivel con firmas HMAC-SHA256
        ├── security/                     # Frontera de seguridad local
        │   └── boundary.ts               # Validaciones de Host, Origin, Tokens de Sesión y Content-Type
        ├── runs/                         # Modelado de contexto y preparación de repositorios Git
        ├── workspaces/                   # Persistencia de workspaces en archivo JSON local
        ├── providers/                    # Detección de ejecutables CLI locales
        ├── local-fs.ts                   # Integración con selectores de archivo de SO (PowerShell / Zenity)
        └── repo-root.ts                  # Detección de la raíz del repositorio Git
```

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra el flujo integral de peticiones y streaming de eventos entre el navegador, el BFF de `apps/web` y `apps/daemon`:

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                           Navegador del Operador                       │
  │  • Command Center (Workspace Picker, Prompt & Reasoning Effort)        │
  │  • Run Cockpit (@xyflow/react Graph Canvas + Event-Sourced Reducer)    │
  │  • Accessible Decision Drawer (WCAG 2.2 AA, Diff & Seam Inspector)    │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │ HTTP REST / Server-Sent Events (SSE)
                                      │ Validated: Host, Origin, mh_session Cookie
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                      apps/web (Next.js 15 App Router)                  │
  │                                                                        │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │ src/middleware.ts & src/lib/server/security/boundary.ts          │  │
  │  │ (Local API Security Boundary: DNS Rebinding & CSRF Defense)      │  │
  │  └──────────────────────────────────┬───────────────────────────────┘  │
  │                                     │ Allowed Requests Only            │
  │                                     ▼                                  │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │ 18 API Routes (src/app/api/...)                                  │  │
  │  │ (Runs, Decisions, Deliver, SSE Events, Node Activity, Workspaces)│  │
  │  └──────────────────────────────────┬───────────────────────────────┘  │
  │                                     │ Typed Product Commands & Queries │
  │                                     ▼                                  │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │ src/lib/server/daemon/productive-client.ts                       │  │
  │  │ src/lib/server/daemon/local-ipc-client.ts                        │  │
  │  │ (HMAC-SHA256 Signed Frames, Nonces, Unix Socket / Named Pipe)   │  │
  │  └──────────────────────────────────┬───────────────────────────────┘  │
  └─────────────────────────────────────┼──────────────────────────────────┘
                                        │ Local IPC Transport
                                        ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                              apps/daemon                               │
  │             (Privileged Process Owner & Journal Writer)                │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Funciones Principales del Servidor BFF

| Símbolo | Tipo | Propósito |
|---|---|---|
| `enforceLocalSecurityBoundary` | Función | Evalúa cabeceras `Host`, `Origin`, cookies de sesión y `Content-Type` para autorizar peticiones. |
| `ProductiveDaemonClient` | Clase | Cliente tipado para enviar comandos y consultar proyecciones a `apps/daemon`. |
| `LocalIpcClient` | Clase | Transporte de bajo nivel sobre sockets Unix o Named Pipes con firma HMAC-SHA256. |
| `createRunEventSource` | Función | Conecta el cliente web al stream SSE del backend con reconexión automática y tracking de secuencias. |
| `reduceRunEvents` | Función | Reductor de UI que pliega `RunEvent[]` en el estado visual de nodos y aristas de React Flow. |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Arquitectura Pure Server BFF Client
En revisiones previas, `apps/web` contenía lógica redundante de ejecución y almacenes de archivos que generaban inconsistencias. Durante el rediseño canónico:
- Se eliminaron 24 archivos propietarios obsoletos que pretendían ejecutar procesos o modificar journals desde Next.js.
- `apps/web` no almacena estado de corrida en memoria ni en bases de datos locales; toda la verdad reside en el journal canónico gestionado por `apps/daemon`.

### 2. Frontera de Seguridad Local (`boundary.ts`)
Dado que ManyHands tiene acceso privilegiado al sistema de archivos local:
- **Comprobación de Host (Loopback Check)**: Restringe `Host` a `localhost`, `127.0.0.1`, `[::1]` o hosts explícitamente autorizados, mitigando ataques de *DNS Rebinding*.
- **Comprobación de Origin (CSRF Check)**: Exige coincidencia exacta entre `Origin` y `Host`, rechazando orígenes `"null"`.
- **Token de Sesión (`mh_session`)**: Las mutaciones exigen la cookie `SameSite=Strict` o la cabecera `x-manyhands-session`.

### 3. Estabilidad Visual Estricta en el Canvas React Flow
Para prevenir fatiga cognitiva y desorientación del operador:
- **Principio Fundamental**: El canvas **nunca** reencuadra (`fitView`), enfoca ni altera el zoom automáticamente ante eventos de ejecución o transiciones de estado de nodos.
- El autoencuadre es un interruptor explícito controlado por el usuario en la barra de herramientas.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 3 / GR)**: La arquitectura Pure Server BFF Client y la comunicación vía IPC autenticado con el daemon están completamente cerradas y verificadas.
2. **Interfaz de Producto**: La interfaz implementa el Command Center, el Cockpit con grafos de tareas reactivos y el cajón de decisiones accesibles (WCAG 2.2 AA).

---

## 7. Navegación y Referencias

- **README de la Aplicación**: [`../../apps/web/README.md`](../../apps/web/README.md)
- **Módulos Relacionados**:
  - [`daemon.md`](./daemon.md): Servidor privilegiado y propietario de la ejecución.
  - [`run-coordinator.md`](./run-coordinator.md): Definición de los 42 eventos consumidos vía SSE.
  - [`task-graph.md`](./task-graph.md): Modelo del grafo renderizado en el canvas de React Flow.
- **Documentación Central**: [`../README.md`](../README.md)
