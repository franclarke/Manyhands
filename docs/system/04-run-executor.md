# Run Coordinator y ejecución

## Responsabilidad

Coordinar casos de uso durables sin apropiarse de git, procesos, planning o
validación. Es el único actor que adopta resultados, avanza outcomes y emite
transiciones terminales.

## Comandos

`create`, `plan`, `approve_plan`, `start`, `pause_run`, `pause_branch`, `resume`,
`answer_decision`, `cancel`, `retry`, `fork`, `approve_delivery`.

Cada comando valida lifecycle, expected revision, lease y permisos antes de
efectos. Conflictos devuelven estado actual y siguiente acción posible.

## Operación durable

Una operación mutante adquiere lease con fencing token. Cada persistencia,
evento y adopción verifica el token. El takeover invalida autoridad anterior.

`RunOperationAuthority` es la única interfaz productiva para reclamar esa
autoridad. Bajo el mutex durable del `RunRecord`, el event store acuña primero
el siguiente fence canónico y sólo después se publica la lease en el record.
Si el proceso cae entre ambos pasos queda un fence huérfano y recuperable, pero
el dueño anterior ya no puede escribir. Los writers del record validan el mismo
fence mientras conservan ese mutex.

Un takeover no devuelve autoridad despachable hasta abortar al dueño anterior,
reconciliar su evidencia de procesos y persistir un receipt con `allDead=true`.
Un receipt no verificable deja el fence anterior invalidado y no publica la
nueva lease. El registro in-process se identifica también por `operationId`,
para que el cleanup tardío del dueño reemplazado no desregistre al sucesor.
Para planning, execution o delivery, `allDead` no basta: el takeover cruza además la
repository lease durable y persiste `repositoryQuiescent=true`. Si otro host
conserva esa lease, la nueva autoridad no se publica. Si el host viejo todavía
no la había adquirido, debe revalidar el fence canónico inmediatamente después
de adquirirla y antes de cualquier efecto.
Planning, ejecución y delivery registran además un controller por operación; después del
aborto, la capa de supervisión rechaza un nuevo spawn antes de crearlo. El
`verifiedAt` del receipt y el heartbeat de la lease publicada se toman después
de verificar `allDead`, no al comenzar la reconciliación. La clave global del
registry se versiona cuando cambia la forma de sus valores, para que HMR no
interprete controllers legacy como entradas operation-aware.
Receipts anteriores sin `repositoryQuiescent=true` siguen siendo legibles,
pero son evidencia insuficiente para habilitar el handoff de un runner.

El repository lease protege efectos y grounding consistente sobre un target
compartido. No se reemplaza con booleans in-process.

La pérdida del repository lease aborta su `AbortSignal`; planning, ejecución y
delivery propagan esa señal al Process Supervisor. Aunque el efecto intercepte
el aborto, el wrapper vuelve a verificar la lease y falla cerrado.

## Loop de coordinación

1. Reconciliar event log, snapshot, leases y procesos.
2. Resolver acciones automáticas pendientes por causa.
3. Calcular decisions y nodes ready.
4. Persistir `wave.selected` con configuración efectiva.
5. Despachar intentos bajo presupuesto.
6. Adoptar solo candidatos fresh y elegibles.
7. Integrar composites ready.
8. Producir/validar raíz.
9. Cambiar a `result_ready` o explicar por qué no puede avanzar.

## Recuperación por causa

| Clase | Política |
|---|---|
| transient | retry con backoff y presupuesto del recurso |
| executor timeout | no retry idéntico; cambiar executor, enmendar el corte o pedir decisión |
| code/test | una reparación local en el mismo worktree |
| contract/decomposition | enmienda; no retry idéntico |
| missing dependency | propuesta de ArtifactRequirement/SeamBinding |
| scope/unexpected commit | descartar intento |
| environment/auth/binary | suspender recurso afectado y pedir corrección |
| integration | una reparación semántica y luego decisión |
| shared infrastructure | circuit breaker para el recurso |

Los presupuestos son por clase y quedan persistidos. Repetir el mismo input sin
nueva evidencia no constituye recuperación.

Un timeout de executor no es transitorio por sí mismo: si no cambian el prompt,
el modelo ni el límite, el siguiente intento reproduce la misma restricción y
descarta trabajo útil. El presupuesto automático para esa clase es cero. El
presupuesto por defecto de una hoja es 10 minutos y sigue siendo configurable
por run; agotarlo produce evidencia adversa, nunca un candidato parcial.

## Pausa y cancelación

- Pause run detiene nuevos dispatches. La política efectiva declara si deja
  terminar intentos o los suspende/cancela.
- Pause branch afecta el subárbol seleccionado y dependents reales.
- Cancel es bifásico: marca `cancelling`, invalida lease, aborta procesos,
  verifica `allDead` y termina `interrupted`.
- Resultados tardíos con fencing viejo se descartan aunque el proceso haya
  terminado con exit 0.

## Fallo terminal

`failed` se usa cuando no existe trabajo independiente, recuperación automática
segura ni decisión pendiente que pueda resolver el bloqueo. El error incluye
causa, evidencia, scope afectado y acciones disponibles.
