# Modelo de interacción del run

## Estructura persistente

```text
┌ Sidebar ─────────┬ Run header: objetivo · estado · controles ───────────────┐
│ workspaces/runs  │ Decision strip contextual                              │
│ o fixtures proto ├──────────────────────────────────────────────────────────┤
│                  │ Graph workspace / Result workspace                     │
│                  │                                           Inspector →  │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

El run usa una única ruta. No navega automáticamente entre pantallas al cambiar
de estado. La selección del usuario, el pan y el zoom permanecen estables.

## Run header

Siempre muestra:

- objetivo resumido;
- estado real del run;
- trabajo activo y decisiones pendientes;
- `Pause run`, `Pause branch` cuando hay selección y `Cancel`;
- acceso a la cola de decisiones.

No muestra métricas decorativas ni una lista completa de fases.

## Grafo

### Interacción

- click selecciona; doble click o acción explícita enfoca;
- pan y zoom pertenecen al usuario;
- `Fit graph` es un comando, no una reacción a eventos;
- seleccionar abre el inspector sin pausar ejecución;
- los edges secundarios aparecen al seleccionar un nodo o activar un lente;
- la jerarquía permanece visible; requirements, seams y conflictos se revelan
  según contexto.

### Regla de viewport

Ningún evento puede llamar implícitamente a `fitView`, centrar un nodo o cambiar
el zoom. La creación de nodos, inicio de intentos, integración, fallos y
decisiones conservan el viewport. Una notificación puede ofrecer `Ver nodo`, y
esa acción sí cambia el foco.

### Layout estable

Los nodos nuevos reciben una posición determinista relativa a su padre y a la
revisión de grafo. El layout puede ampliar espacio fuera del viewport, pero no
reordena nodos materializados durante una revisión. Una nueva revisión puede
ofrecer `Aplicar nuevo layout`; nunca se aplica mientras el usuario inspecciona
sin consentimiento.

## Decisiones humanas

Cuando un nodo requiere intervención aparece una tarjeta horizontal encima del
área del grafo, alineada visualmente con el nodo cuando sea posible. Contiene:

- pregunta en lenguaje claro;
- por qué importa;
- alcance bloqueado y trabajo que continúa;
- acción `Responder` y acción `Ver impacto`.

`Responder` abre un popup accesible con opciones, evidencia y consecuencias. El
popup no esconde el contexto del nodo y puede cerrarse sin resolver. Cada nodo
pendiente conserva un badge. El header ofrece la cola y `Siguiente decisión`.

## Inspector progresivo

El inspector tiene una estructura consistente:

1. **Resumen:** objetivo, estado y razón.
2. **Entradas y salidas:** artefactos y seams en lenguaje de producto.
3. **Validación:** criterios y evidencia.
4. **Cambios:** diff, commits y archivos.
5. **Historial:** intentos, eventos y logs bajo demanda.

No existen tabs globales equivalentes para Tareas, Planificación, Integración o
Interfaces. Esos conceptos se inspeccionan desde el objeto correspondiente.

## Estados visibles

| Estado | Representación |
|---|---|
| planned/ready | neutro, con razón de readiness disponible |
| running | actividad ember y progreso del intento |
| validating | checks activos, distinto de escribir código |
| candidate | cambio producido, todavía no adoptado |
| verified | evidencia satisfecha |
| integrating | convergencia hacia el composite |
| needs_input | badge y tarjeta de decisión |
| blocked | atenuado con “espera X”; no rojo |
| stale | obsoleto por inputs nuevos; conserva historial |
| failed | fallo real con causa y siguiente acción |

El color nunca es la única señal.

## Movimiento

- aparición de nodo: 180–240 ms, fade + desplazamiento corto desde el padre;
- edge nuevo: trazo progresivo que termina en estado estático;
- inicio de intento: pulso local, no permanente en todo el nodo;
- integración: flujo breve de hijos al composite y confirmación del padre;
- invalidación: transición a stale sin animación de error;
- decisión: entrada de la tarjeta, sin mover el canvas.

No se animan posiciones durante la interacción. `prefers-reduced-motion` elimina
trazos, pulsos y desplazamientos; conserva cambios instantáneos y foco.

## Responsive y accesibilidad

- Sidebar colapsable; el grafo mantiene su estado.
- En pantallas estrechas el inspector es un sheet y la decisión un diálogo
  fullscreen parcial.
- Todo nodo, edge interactivo, acción y popup es operable por teclado.
- El foco vuelve al elemento invocador al cerrar un popup.
- Los live regions anuncian decisiones y estados terminales, no cada evento.
- Cumplimiento objetivo: WCAG 2.2 AA.
