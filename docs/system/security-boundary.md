# Security boundary

## Activos

- repositorio y credenciales del usuario;
- procesos del host;
- event log y artifacts del run;
- target de entrega;
- secretos disponibles al executor.

## Amenazas principales

- instrucciones maliciosas dentro del repositorio;
- agente que escribe fuera de scope o commitea;
- comandos de validación inyectados;
- symlink/path traversal;
- procesos hijos que sobreviven cancelación;
- resultado tardío después de takeover;
- secrets en prompts/logs/diffs;
- publicación de un tree distinto al validado;
- dos runs mutando el mismo repo.

## Controles

### Aislamiento de archivos

Worktree por intento, paths resueltos, ScopeContract deny-wins, inspección de
`git diff` y staging controlado por orquestador.

### Autoridad temporal

Operation lease y repository lease con fencing tokens. Todo write/event/adoption
verifica token. Las leases son durables y tienen owner, expiry y takeover.

El claim de operación y el fence canónico forman una sola transacción de
autoridad: el fence se publica antes que la lease visible y ambos se serializan
bajo el mutex durable del run. Un takeover sólo habilita dispatch después de un
receipt durable `allDead=true`; un crash intermedio puede reducir
disponibilidad, nunca devolver autoridad doble. La pérdida del repository lease
aborta los efectos supervisados que sigan en vuelo. Cada operación productiva
registra un controller identificado por `operationId`, y un efecto supervisado
no puede crear procesos nuevos después de que ese controller fue abortado.

### Procesos

Process Supervisor registra árbol, timeout y abort. Cancelación requiere
confirmar terminación. Un proceso huérfano no conserva autoridad.

### Comandos

Validation recipes provienen de fuentes permitidas, pasan validación sintáctica
y corren con timeout. El agente no eleva comandos arbitrarios a evidencia
confiable.

### Datos

Redacción de secrets, mínimos privilegios, logs referenciados y retention. Los
prompts no incluyen credenciales salvo capability explícita y auditada.

### Delivery

El adapter publica únicamente commit/tree del `FinalArtifactManifest` validado y
registra receipt. Auth/permissions se verifican antes de preparar y al publicar.

### Versionado del event log

El journal append-only es inmortal: la forma en disco de un evento no cambia in
situ. Cada envelope declara `schemaVersion`. Cuando la forma de un evento debe
cambiar se incrementa la versión actual y se registra un upcaster de la versión
previa a la nueva; la lectura migra hacia adelante todo registro anterior antes
de aplicar el schema de dominio. Un registro de una versión más nueva que la que
este build entiende falla cerrado: un journal del futuro no se lee a ciegas.

## Trust boundaries

Se consideran no confiables: output del LLM, stdout/stderr, contenido del repo,
commands propuestos, paths serializados y respuestas del navegador. Se validan
en la frontera correspondiente.

## No objetivos actuales

El producto local-first no promete aislamiento fuerte contra código hostil al
nivel de una VM. Si el threat model requiere multi-tenant o repos no confiables,
la ejecución debe moverse a sandbox/VM/container con credenciales efímeras antes
de ofrecer esa garantía.
