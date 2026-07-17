# Fixtures golden

## Propósito

Los fixtures de `/runs/proto/[fixture]` cumplen tres funciones:

1. regresión del reducer, selectores y componentes;
2. exploración de la experiencia antes de conectar una capacidad backend;
3. demostración comprensible del producto.

No prueban que el backend real implemente una capacidad. Cada fixture debe
declarar qué simula y tener un test backend equivalente antes de usar esa
capacidad como afirmación de producto.

## Contrato

```ts
type RunFixture = {
  id: string;
  title: string;
  summary: string;
  events: RunEvent[];
  playback?: {
    defaultSpeed: number;
    stepDelaysMs?: Record<string, number>;
  };
  assertions: FixtureAssertion[];
};
```

- `events` usa el mismo envelope de dominio que el stream real.
- La reproducción puede avanzar manualmente, pausar y ajustar velocidad.
- El reducer no conoce si el origen es fixture o backend.
- La sidebar de Proto enumera fixtures y nunca workspaces/runs reales.
- Ningún evento recentra el canvas. `Fit graph` y `Ver nodo` son acciones
  explícitas.

## Catálogo

| Fixture | Propósito |
|---|---|
| `golden-appointment-booking` | demo principal para público general |
| `golden-happy-path` | run completo sin incidentes |
| `golden-planning-question` | aclaración que cambia el plan |
| `golden-verify-auto-repair` | reparación local autónoma |
| `golden-behavioral-conflict` | conflicto semántico con decisión humana |
| `golden-seam-amendment-blast-radius` | enmienda e invalidación selectiva |
| `golden-support-desk-saas` | desarrollo SaaS con varios límites técnicos |
| `golden-subscriptions-billing-saas` | reglas de negocio e integración de eventos |
| `golden-deep-import-pipeline` | DAG profundo y angosto para audiencia técnica |

## Fixture principal: AgendaFácil

### Historia

El usuario solicita una aplicación sencilla para reservar turnos. El grafo es
comprensible por el producto, pero está cortado para trabajo agéntico real:

```text
Construir AgendaFácil
├─ Motor de reservas
│  ├─ modelo y disponibilidad
│  ├─ reserva atómica
│  └─ API y evidencia de concurrencia
├─ Experiencia de reserva
│  ├─ búsqueda de horarios
│  ├─ formulario y confirmación
│  └─ estados de error/accesibilidad
└─ Operación del servicio
   ├─ comprobantes
   ├─ recordatorios
   └─ observabilidad y herramientas internas
```

Los títulos explican valor; los nodos representan límites técnicos e incrementos
verificables. Los contratos conectan disponibilidad, `BookingRequest`,
`BookingReceipt`, zona horaria y notificaciones.

### Recorrido manual

1. **Objetivo:** se crea el run y el repositorio queda fijado.
2. **Aclaración:** el planner pregunta la política de cancelación porque cambia
   dominio, UI y recordatorios.
3. **Propuesta:** aparecen la raíz y tres composites. Cada expansión explica por
   qué el nodo se divide.
4. **Aprobación:** se muestran outputs, requirements, seams y Evidence Matrix
   proyectada, no tabs técnicas separadas.
5. **Baseline:** se materializan contratos compartidos para habilitar trabajo
   paralelo.
6. **Wave inicial:** motor, UI y operación avanzan donde sus requisitos lo
   permiten.
7. **Fallo local:** la reserva atómica acepta doble booking. El mismo intento
   recibe un diagnóstico y hace una única reparación; luego valida.
8. **Dependencia descubierta:** recordatorios detecta que `BookingReceipt` no
   incluye zona horaria. Propone una enmienda y muestra el impacto.
9. **Decisión humana:** el usuario aprueba. Solo productor, consumidores y
   composites afectados quedan stale; trabajo independiente se conserva.
10. **Integración:** un conflicto estructural en estado compartido se repara
    automáticamente. La validación conductual confirma el flujo completo.
11. **Resultado:** Evidence Matrix, diff agregado y candidato exacto toman el
    centro. El grafo queda como procedencia.
12. **Entrega:** se valida nuevamente el candidato y se publica.

### Assertions

- exactamente tres hijos de la raíz por decisión narrativa de este fixture, no
  como regla del producto;
- profundidad de cuatro, con una rama de cinco solo si mejora la historia;
- ningún composite existe únicamente para “planificar” o “integrar”;
- al menos un `ArtifactRequirement`, un `SeamBinding` y un
  `ConflictConstraint` visibles en contexto;
- una reparación autónoma, una enmienda, una invalidación selectiva y una
  integración reparada;
- una decisión pendiente no detiene ramas independientes;
- ningún resultado stale se integra;
- cada criterio final tiene evidencia;
- la reproducción manual permite explicar un evento por vez;
- creación, fallo e integración no cambian el viewport.

## Fixtures de mecanismo

### `golden-happy-path`

Plan aprobado, dos hojas compatibles en paralelo, integración limpia, Evidence
Matrix completa y entrega confirmada. Es la mínima línea base del lifecycle
objetivo.

### `golden-planning-question`

Una ambigüedad arquitectónica genera `decision.raised`. La respuesta se incorpora
a una nueva revisión antes de aprobar. No simula preguntas cosméticas.

### `golden-verify-auto-repair`

Un test local falla por un defecto de código. Se permite una reparación en el
mismo worktree y se crea evidencia de ambos intentos. No genera atención humana
mientras exista una política segura.

### `golden-behavioral-conflict`

Producer y consumer pasan tests aislados pero discrepan sobre unidades. La
integración detecta el fallo e intenta una reparación. Al no poder decidir
semántica de negocio, crea una decisión con opciones e impacto.

### `golden-seam-amendment-blast-radius`

Un contrato agrega paginación. El preview distingue trabajo preservado y
artefactos que quedarían stale. La aprobación crea otra revisión y reejecuta solo
inputs incompatibles.

## Fixtures de aplicaciones complejas

### `golden-support-desk-saas`

Mesa de ayuda con identidad, tickets, inbox, comentarios, SLA y auditoría. Debe
mostrar que algunos cortes son verticales y otros son capacidades compartidas.

### `golden-subscriptions-billing-saas`

Planes, prorrateo, checkout, webhooks, facturación y portal. La aclaración de
redondeo ocurre antes de ejecutar; la integración valida idempotencia y orden de
eventos.

### `golden-deep-import-pipeline`

Ingesta B2B, parsing, schema, validación, normalización, persistencia idempotente
y entrega. Prioriza profundidad sobre anchura. Cada paso consume un artefacto
concreto; no usa dependencies de orden ficticias. La velocidad default es lenta
y los pasos de integración tienen pausas narrables.

## Cobertura mínima del set

El catálogo conjunto debe cubrir:

- lifecycle completo y cancelación/interrupción;
- graph revision y aprobación;
- todas las relaciones tipadas;
- intentos verified, failed, discarded y stale;
- recuperación por causa;
- decisiones locales y cola de atención;
- integración limpia, reparada y escalada;
- evidencia satisfied, failed, uncovered y flaky;
- entrega exitosa y fallida;
- reduced motion, teclado, contenido largo y viewport estrecho.
