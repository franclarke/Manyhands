# PILAR 2 — EJECUCIÓN, SCHEDULER CONTINUO Y SANDBOXING DE PROCESOS

> **Ubicación del código**: `packages/scheduler`, `packages/orchestrator-graph`, `packages/execution-core`  
> **Responsabilidad**: Despachar de forma continua, segura y aislada la ejecución de agentes de código (Claude/Codex) en worktrees locales de Git.

---

## 1. ARQUITECTURA DEL SCHEDULER CONTINUO POR EVENTOS

ManyHands reemplaza la ejecución por lotes (*waves*) por un **Scheduler Continuo Basado en Disponibilidad de Artefactos**:

```mermaid
flowchart TD
    EventLog[Evento: Artifact Adopted / Decision Resolved] --> Scheduler[Continuous Event Scheduler]
    Scheduler --> CheckReadiness[explainReadiness / selectReadyWaveV2]
    CheckReadiness --> ConflictCheck{¿Bloqueado por ConflictConstraint?}
    ConflictCheck -->|Sí| Defer[Difiere Nodo (deferred: true)]
    ConflictCheck -->|No| Dispatch[Despacha a Cola de Agentes Libres]
    Dispatch --> Driver[V2ExecutionDriver]
    Driver --> WorktreePool[Worktree Recycling Pool]
```

---

## 2. APLAZAMIENTO SIMÉTRICO POR RESTRICCIONES DE CONFLICTO (`selectReadyWaveV2`)

Garantiza que dos tareas que modifican los mismos archivos o módulos conceptuales no se ejecuten simultáneamente:
- Evalúa la restricción de forma **estrictamente bidireccional** (`blocksPair(left, right)` y `blocksPair(right, left)`).
- Compara candidatos contra nodos activos en ejecución (`activeResourceNodeIds`) y nodos seleccionados en la ola actual.
- Difiere nodos conflictivos fijando `deferred: true`.
- Respeta el cupo máximo `effectiveConfig.maxParallel` y ordena de forma determinista usando `nodeId.localeCompare`.

---

## 3. CONTROLADOR DE EJECUCIÓN Y REGISTRO ATÓMICO (`V2ExecutionDriver`)

- **`recordQueue` Atómico**: Encadena las grabaciones de hechos de finalización de nodos concurrentes (`Promise.all`) mediante una cola secuencial atómica, evitando condiciones de carrera en el estado (*Read-Modify-Write Races*).
- **Aislamiento de Excepciones**: Captura rejections en la cadena mediante `.catch(() => {})` para evitar excepciones no observadas.
- **Huella Digital Inmutable (`InputFingerprint`)**: Hash SHA-256 de todas las entradas del intento (`runId:attempt:nodeId:ordinal`).

---

## 4. POOL DE RECICLAJE DE WORKTREES (`WorktreePool`)

Para eliminar la latencia I/O de crear y borrar worktrees físicos con `git worktree add/remove`:
- Mantiene un pool de worktrees pre-creados en disco (`<worktreesRoot>/<runId>/<taskId>`).
- En reintentos o asignaciones, ejecuta un `git reset --hard <baseCommit>` y `git clean -fd` ultrarrápido en milisegundos.
- Relocaliza la raíz en Windows si la ruta supera los 220 caracteres (`WINDOWS_GIT_PATH_BUDGET`).

---

## 5. LÍMITES DE SEGURIDAD Y SUPERVISIÓN DE PROCESOS

- **Guard de Traversal (`ScopeChecker.validatePathBoundary`)**: Bloquea ataques de path traversal (`../`) y escapes por symlinks (`realpathSync`).
- **Supervisión de Procesos (`LiveProcessRegistry`)**: Registra todos los subprocesos de agentes. Ante cancelaciones o timeouts, ejecuta `killProcessTreeVerified` y sondea en el SO con Signal-0 hasta confirmar la muerte del PID.
- **Filtrado de Secretos (`buildAgentEnvironment()`)**: Sanitiza `process.env` manteniendo solo variables en allowlist (`PATH`, `HOME`, credenciales del proveedor) y eliminando secretos del host.
- **Saneamiento de Comandos Git (`safeGitArgs`)**: Inyecta `-c safe.directory=<cwd>` para evitar fallos de propiedad en Windows sin modificar el `~/.gitconfig` global.
