# @manyhands/web

Interfaz de usuario, Command Center, Cockpit de ejecución reactivo basado en grafos (Next.js 15, React 19, Tailwind CSS 4, `@xyflow/react`) y cliente de servidor BFF (*Backend-for-Frontend*) con frontera de seguridad local estricta contra DNS Rebinding y CSRF para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`apps/web` constituye la superficie visual y la puerta de enlace de interacción entre el operador humano y el ecosistema ManyHands. Siguiendo la arquitectura canónica de rediseño (*Correctness-First System Redesign*), `apps/web` ha sido completamente desacoplada de la custodia de procesos y de la ejecución física de corridas, asumiendo roles estrictamente delimitados:

1. **Cliente BFF de Servidor Puro (*Pure Server BFF Client*)**: No ejecuta workers en segundo plano ni escribe directamente en los journals de eventos. Todas las acciones del operador (creación de corridas, inicio, pausa, reanudación, reinicio, cancelación, resolución de decisiones y entrega) se firman y envían a `apps/daemon` mediante llamadas IPC locales autenticadas (`productive-client.ts`).
2. **Frontera de Seguridad Local Estricta (`boundary.ts`)**: Dado que ManyHands administra repositorios y ejecuta procesos en la máquina local del usuario, `apps/web` implementa defensas a nivel de middleware contra amenazas basadas en navegador:
   - Validación de cabecera `Host` restringida a loopback para mitigar ataques de *DNS Rebinding*.
   - Validación rigurosa de `Origin` para neutralizar ataques de falsificación de peticiones en sitios cruzados (*CSRF*).
   - Requisito de token de sesión efímero (`mh_session` con `SameSite=Strict` o cabecera `x-manyhands-session`) en todas las mutaciones y flujos sensibles.
   - Restricción estricta de `Content-Type: application/json` en métodos mutantes.
3. **Proyección Reactiva Basada en Eventos (*Event-Sourced UI Projection*)**: Consume el flujo de eventos canónicos del daemon vía Server-Sent Events (SSE) en `GET /api/runs/[id]/run-events` y reconstruye deterministamente en el cliente el estado de la corrida, los contratos, los artefactos generados y la matriz de evidencia jerárquica mediante un reductor puro (`reducer.ts`).
4. **Visualización de Grafos de Tareas Sin Saltos Disruptivos de Viewport**: Utiliza `@xyflow/react` para renderizar el grafo de ejecución con nodos enriquecidos (`task-node-v2.tsx`, `flow-band-node.tsx`) y aristas tipadas (`InteractiveRelationEdge.tsx`). Cumple estrictamente el principio de estabilidad visual: **el canvas nunca reencuadra ni fuerza zoom automáticamente ante eventos de ejecución**, manteniendo el foco del operador donde este lo haya ubicado (el autoencuadre es un switch opcional en la toolbar).
5. **Centro de Decisiones Accesible (WCAG 2.2 AA)**: Las solicitudes de intervención humana (aprobación de planes, confirmación de validaciones, resolución de seams) se asocian a los nodos afectados sin bloquear la ejecución de ramas paralelas independientes, ofreciendo diálogos accesibles con soporte completo de teclado e inspección de diferencias (*diff viewers*).

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

## 2. Arquitectura Modular Interna

El código fuente en `apps/web/src/` está organizado en las siguientes capas:

```
apps/web/src/
├── middleware.ts                         # Middleware global de Next.js que aplica la frontera de seguridad
├── app/                                  # App Router de Next.js 15
│   ├── layout.tsx                        # Layout raíz con listado de corridas para la barra lateral
│   ├── page.tsx                          # Página de inicio del Command Center
│   ├── (command-center)/                 # Componentes del Command Center (selector de repositorio, prompts)
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

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Arquitectura Pure Server BFF Client (Eliminación de Legacy Owners)

En revisiones previas, `apps/web` contenía lógica redundante de ejecución, máquinas de estado de bajo nivel y almacenes directos de archivos que generaban inconsistencias. Durante el rediseño canónico:
- Se retiraron **24 archivos propietarios obsoletos** que pretendían ejecutar procesos o modificar journals desde el servidor web.
- `apps/web` no almacena estado de corrida en memoria ni en bases de datos locales; toda la verdad reside en el journal canónico gestionado exclusivamente por `apps/daemon`.
- Cada acción del operador en la UI se traduce en un comando inmutable (`RunCommandEnvelope`) con identificador determinista derivado del hash del request (`commandIdForRequest`).

### 3.2. Frontera de Seguridad Local (`src/lib/server/security/boundary.ts`)

Dado que ManyHands tiene acceso privilegiado al sistema de archivos local y puede ejecutar comandos en la máquina del operador, `boundary.ts` actúa como un escudo perimetral estricto:

```
Petición HTTP Entrante
        │
        ├─── 1. Comprobación de Host (Loopback Check)
        │    Host debe ser localhost, 127.0.0.1, [::1] o estar en MANYHANDS_ALLOWED_HOSTS.
        │    ► Si falla: Rechaza con 403 (Mitiga DNS Rebinding de sitios maliciosos).
        │
        ├─── 2. Comprobación de Origin (CSRF Check)
        │    Si existe cabecera Origin, debe coincidir exactamente con el Host de la petición.
        │    Se rechazan explícitamente los orígenes "null" (iframes aislados, esquemas file://).
        │    ► Si falla: Rechaza con 403 (Mitiga Cross-Site Request Forgery).
        │
        ├─── 3. Comprobación de Tipo de Contenido (Content-Type)
        │    Para mutaciones (POST, PUT, PATCH, DELETE), Content-Type debe ser application/json.
        │    ► Si falla: Rechaza con 415 (Unsupported Media Type).
        │
        └─── 4. Validación de Capacidad de Sesión (Session Capability)
             Mutaciones, SSE y rutas de exploración requieren la cookie 'mh_session' (SameSite=Strict)
             o la cabecera 'x-manyhands-session'.
             ► Si falla: Rechaza con 401 (Unauthorized).
```

### 3.3. Proyección de Estado por Reducción Pura de Eventos (`reducer.ts`)

La interfaz del Run Cockpit no sincroniza modelos imperativos ni depende de sondeos periódicos con sobrecarga de red:
- Al abrir una corrida, la página carga la proyección inicial (`RunProjection`) generada por el daemon.
- Se establece una conexión SSE unidireccional con `/api/runs/[id]/run-events?afterSequence=<N>`.
- Cada `RunEvent` recibido es procesado por la función pura `reduceRunEvents(previousModel, newEvents)`, actualizando el grafo, el progreso de los nodos, las dependencias de artefactos, los conflictos de recursos y las decisiones pendientes de forma determinista y sin parpadeos.

### 3.4. Principios de UI del Grafo y Accesibilidad (WCAG 2.2 AA)

1. **Estabilidad del Viewport**:
   - Siguiendo los principios de usabilidad del producto, la canvas de React Flow nunca invoca automáticamente `fitView()`, `zoomTo()` o `setCenter()` en respuesta a eventos de ejecución en segundo plano. El operador mantiene el control absoluto de su encuadre. Se provee un control de `Autoencuadre` en la barra de herramientas que solo actúa cuando se incorporan nuevos nodos al grafo si el usuario decide activarlo.
2. **Decisiones Desacopladas y No Bloqueantes**:
   - Cuando un nodo requiere intervención humana (por ejemplo, aprobación de descomposición o confirmación de validación), la decisión se muestra como una tarjeta contextual vinculada al nodo y en el panel global de decisiones (`DecisionQueueDrawer.tsx`). Las ramas del grafo que no dependen de ese nodo continúan ejecutándose en paralelo.
3. **Accesibilidad Integral**:
   - Diálogos con trampa de foco accesible (`accessible-dialog.tsx`), navegación completa por teclado (`Escape` para cerrar, `Enter` para confirmar), estados de alto contraste y compatibilidad con preferencias de reducción de movimiento (`prefers-reduced-motion`).

---

## 4. Catálogo Completo de Rutas API (18 Rutas REST y SSE)

Todas las rutas se encuentran ubicadas bajo `apps/web/src/app/api/`:

| # | Ruta HTTP | Método | Operación Daemon IPC | Propósito y Descripción |
|---|---|---|---|---|
| 1 | `/api/runs` | `GET` | `query(list)` | Lista corridas filtradas por workspace, estado o archivo. |
| 2 | `/api/runs` | `POST` | `submit(create_run)` | Captura el contexto Git del repositorio y crea una nueva corrida. |
| 3 | `/api/runs/[id]` | `GET` | `query(projection)` | Obtiene la proyección completa de estado (`RunProjection`). |
| 4 | `/api/runs/[id]` | `PATCH` | `submit(rename/archive)`| Actualiza el título de la corrida o modifica su estado de archivado. |
| 5 | `/api/runs/[id]/run` | `POST` | `submit(start_run)` | Inicia o avanza la ejecución de la siguiente onda de tareas. |
| 6 | `/api/runs/[id]/pause` | `POST` | `submit(pause_run)` | Pausa de forma segura la ejecución de la corrida activa. |
| 7 | `/api/runs/[id]/resume` | `POST` | `submit(resume_run)` | Reanuda una corrida previamente pausada. |
| 8 | `/api/runs/[id]/restart` | `POST` | `submit(restart_run)` | Reinicia un intento fallido o interrumpido. |
| 9 | `/api/runs/[id]/cancel` | `POST` | `submit(cancel_run)` | Cancela la corrida y finaliza los subprocesos activos. |
| 10 | `/api/runs/[id]/decisions/[decisionId]` | `POST` | `submit(resolve_decision)`| Resuelve una decisión humana (aprobar plan, validar seam, etc.). |
| 11 | `/api/runs/[id]/deliver` | `POST` | `submit(deliver_run)` | Publica transaccionalmente el resultado verificado en Git. |
| 12 | `/api/runs/[id]/run-events` | `GET` | `eventsReady(long-poll)`| Canal Server-Sent Events (SSE) de eventos canónicos `RunEvent`. |
| 13 | `/api/runs/[id]/nodes/[nodeId]/activity` | `GET` | `query(activity)` | Obtiene trazas de streaming de la actividad del agente en un nodo. |
| 14 | `/api/workspaces` | `GET` | (local store) | Lista los espacios de trabajo locales registrados. |
| 15 | `/api/workspaces` | `POST` | (local store) | Registra un nuevo espacio de trabajo vinculado a una ruta local. |
| 16 | `/api/workspaces/[id]` | `GET/DELETE` | (local store) | Consulta detalles o elimina el registro de un workspace. |
| 17 | `/api/workspaces/migration-conflicts/[duplicateId]` | `POST` | (local store) | Resuelve colisiones de migración entre workspaces duplicados. |
| 18 | `/api/local-fs/pick-folder` | `POST` | (SO dialog) | Abre el diálogo nativo del sistema para seleccionar carpetas. |

### Rutas Adicionales de Diagnóstico
- `/api/health`: Sondeo de salud básico del servidor web (`GET`).
- `/api/capabilities`: Declaración de modelos y capacidades soportadas (`GET`).
- `/api/providers/readiness`: Verificación de binarios locales disponibles en el PATH (`git`, `codex`, `claude`) (`GET`).

---

## 5. Ejemplos de Uso e Integración de Interfaces

### 5.1. Consulta de Proyección e Invocación de Comandos vía `productive-client.ts`

```typescript
import {
  queryProductRun,
  listProductRuns,
  readProductRunEvents
} from "@/lib/server/daemon/productive-client";

// 1. Obtener la proyección de una corrida
const projection = await queryProductRun("run:01j9a8b7c6d5e4f3g2h1");
console.log(`Estado: ${projection.status}, Nodos: ${projection.nodes.length}`);

// 2. Listar corridas activas de un workspace
const activeRuns = await listProductRuns({
  workspaceId: "ws-principal",
  statuses: ["running", "paused", "waiting_decision"]
});

// 3. Leer eventos desde una secuencia específica para SSE
const eventPage = await readProductRunEvents("run:01j9a8b7c6d5e4f3g2h1", 12);
for (const event of eventPage.events) {
  console.log(`Secuencia ${event.sequence}: ${event.type}`);
}
```

### 5.2. Consumo del Canal SSE en el Cliente React

```typescript
import { useEffect, useState } from "react";
import { reduceRunEvents } from "@/lib/run-model/reducer";
import type { RunModel } from "@/lib/run-model/types";

export function useRunEventStream(runId: string, initialModel: RunModel) {
  const [model, setModel] = useState<RunModel>(initialModel);

  useEffect(() => {
    let lastSequence = model.latestSequence;
    const eventSource = new EventSource(
      `/api/runs/${encodeURIComponent(runId)}/run-events?afterSequence=${lastSequence}`
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (Array.isArray(data.events) && data.events.length > 0) {
        setModel((current) => reduceRunEvents(current, data.events));
        lastSequence = data.nextSequence;
      }
    };

    eventSource.onerror = () => {
      // El navegador reintentará automáticamente la conexión SSE
    };

    return () => {
      eventSource.close();
    };
  }, [runId]);

  return model;
}
```

---

## 6. Variables de Entorno de la Aplicación Web

| Variable | Tipo | Propósito |
|---|---|---|
| `MANYHANDS_DAEMON_ENDPOINT` | Ruta o Named Pipe | Endpoint de conexión al daemon local (autodetectado si no se especifica). |
| `MANYHANDS_DAEMON_STATE_ROOT`| Ruta absoluta | Directorio raíz para localizar la capability de instalación (`.manyhands/daemon`). |
| `MANYHANDS_ALLOWED_HOSTS` | Lista separada por comas | Nombres de host adicionales permitidos en `boundary.ts` (ej. alias LAN). |
| `MANYHANDS_WORKSPACES_FILE` | Ruta de archivo JSON | Almacén de persistencia para el catálogo local de espacios de trabajo. |
| `PORT` | Número (default `3000`) | Puerto HTTP en el que escucha el servidor Next.js. |

---

## 7. Estado de Transición y Brechas Arquitectónicas

En concordancia con el plan canónico `docs/plans/2026-08-12-correctness-first-system-redesign.md`:

- **Etapa 3 / GR**: `apps/web` migrado al modelo BFF puro sobre IPC local autenticado. La verdad reside en el journal canónico; `RunRecord` fue eliminado como entidad de persistencia de ejecución.
- **Etapa 7 / GA**: Soporte en el Cockpit para la inspección visual de artefactos con direccionamiento por contenido y visualización de la matriz de evidencia.
- **Etapa 8 / GLeaf**: Integración de trazas de streaming de agentes LLM en `/api/runs/[id]/nodes/[nodeId]/activity`.
- **Etapa 9 / GI**: Renderizado de bandas de integración jerárquicas (`flow-band-node.tsx`) y seams de contratos (`SeamContractInspector.tsx`).
- **Etapa 10 / GDel**: Interfaz para revisión final de cambios antes de la entrega y disparo de `/api/runs/[id]/deliver`.
- **Brechas Transicionales**:
  - Soporte de compatibilidad dual en el reductor (`canonicalGraphView` vs `legacyGraphView`) para reproducir corridas históricas previas a la migración.

---

## 8. Comandos de Verificación y Testing

```bash
# Verificación de tipos TypeScript en la aplicación web
pnpm web:typecheck

# Análisis estático y linter
pnpm web:lint

# Compilación de producción (Next.js build)
pnpm web:build

# Iniciar servidor de desarrollo con Hot Reload
pnpm web:dev
```
