# Web app y experiencia operativa

## Superficies

### Command Center

Crea runs con goal, workspace/target y configuración esencial. Los defaults
avanzados se muestran progresivamente. La creación persiste target y config
efectiva antes de iniciar planning.

### Run Workspace

Una ruta, dos centros:

- planning/running: grafo central;
- result_ready/delivering/completed: evidencia y entrega central.

Sidebar, header, decision strip, canvas/result y inspector forman el shell. No
hay navegación primaria separada para Tareas, Planificación, Integración o
Interfaces.

### Proto

`/runs/proto/[fixture]` usa fixtures registrados y una sidebar propia. No consulta
el registry real de workspaces/runs. Ofrece play/pause, navegación bidireccional
por evento y por hito, scrubber, velocidad, reset y navegación de fixtures. Toda
navegación manual pausa la reproducción antes de reconstruir la proyección.
Las sidebars enlazan explícitamente entre el laboratorio y los runs reales; la
barra de reproducción permanece compacta para no desplazar el canvas.

## Command/query boundary

La UI envía comandos con `expectedVersion`/revision. El servidor valida,
persiste efectos y responde con identidad/cursor. El cliente aprende el estado
real mediante snapshot + eventos, no aplicando éxito optimista a estados de
dominio.

El `RunRecord` JSON usado para metadata, previews y listados es una cache de la
proyección V2. El journal `*.events.v2.jsonl` conserva la historia canónica.

Queries principales:

- snapshot de run con cursor;
- eventos `after=seq`;
- artifact/evidence/log por ref lazy;
- decisions pendientes;
- delivery preview.

## Reducer y selectors

El reducer acepta eventos versionados y es compartido por live/proto. Selectores
derivan lifecycle, nodes, edges visibles, decisions, attention, evidence y
actions permitidas.

No se permiten `nodeStatusOverrides`, arrays de estado paralelos ni componentes
que interpreten stdout para marcar progreso.

## Streaming

SSE o transporte equivalente entrega eventos ordered. El cliente detecta gaps,
reconecta con cursor y solicita snapshot si el schema/cursor no es reconciliable.
Eventos duplicados son idempotentes.

## Decisions

Cada pending decision:

- marca los nodos afectados;
- genera tarjeta contextual;
- aparece en cola global;
- selecciona su nodo y abre evidence/impact/opciones en el inspector;
- maneja submitting, CAS conflict, expired y resolved.

La UI nunca transforma pending en resolved hasta recibir el evento.

## Canvas

- layout determinista por span de subárbol, profundidad y sibling order;
- autoencuadre activado por defecto y controlable desde la toolbar compartida
  del canvas;
- auto-fit solo por cambios estructurales de nodos, nunca por estado, selección
  o actividad; al desactivarlo, el viewport vuelve a ser propiedad exclusiva del
  usuario;
- navegación por teclado y focus visible;
- jerarquía persistente y edges secundarios agrupados/filtrables por lentes de
  ejecución, artefactos, contratos, conflictos y todo;
- `Encuadrar` y minimapa siempre iniciados por el operador;
- reduced motion.

## Listado y archivo de runs

Los listados excluyen runs archivados dentro del repositorio, antes de aplicar
el límite solicitado. `include=archived` habilita la consulta explícita. La
acción de la sidebar archiva y muestra el error del servidor si no puede
completarla; nunca presenta un borrado exitoso de forma optimista.

## Honestidad

La UI distingue:

- candidate de verified;
- verified de delivered;
- blocked de needs_input;
- stale de failed;
- fixture simulated de backend verified.

Copy, badges y acciones deben conservar estas diferencias.
