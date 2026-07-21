# Modelo de interacción del run

## Estructura persistente

```text
┌ Sidebar ─────────┬ Run header: objetivo · estado · controles ───────────────┐
│ workspaces/runs  │ Decision strip global y contextual                     │
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
En escritorio, header, reproducción de fixtures y cola de decisiones usan
franjas compactas de una línea para priorizar la altura visible del grafo.

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
el zoom fuera del modo `Autoencuadre`. El switch comienza activado y habilita
`fitView` solo cuando cambia la estructura de nodos. El inicio
de intentos, integración, fallos, decisiones, selección y cambios de lente
conservan el viewport. Una notificación puede ofrecer `Ver nodo`, y esa acción sí
cambia el foco.

### Layout estable

Los nodos reciben una posición determinista a partir del span de cada subárbol,
la profundidad y el orden de siblings. El mismo árbol produce el mismo layout.
El viewport se inicializa una sola vez. `Encuadrar` es una acción puntual;
`Autoencuadre` es un modo temporal, activado inicialmente, para seguir nodos nuevos; el
minimapa solo aparece bajo demanda en grafos grandes. Desactivar el switch
devuelve inmediatamente el control exclusivo del viewport al operador.

### Lentes de relaciones

- **Ejecución:** jerarquía y relaciones del nodo seleccionado.
- **Artefactos:** requirements materiales entre producer y consumer.
- **Contratos:** compatibilidad de seams.
- **Conflictos:** restricciones de scheduling/riesgo.
- **Todo:** todas las relaciones secundarias.

Las relaciones secundarias del mismo par se agrupan visualmente. El agrupamiento
reduce ruido pero no elimina el detalle canónico, que permanece inspeccionable.

## Decisiones humanas

Cuando uno o más nodos requieren intervención aparece una tarjeta horizontal en
la franja superior. Contiene:

- pregunta en lenguaje claro;
- por qué importa;
- alcance bloqueado y trabajo que continúa;
- acción `Revisar`.

`Revisar` selecciona el primer nodo afectado y abre la decisión en el inspector
lateral. El inspector muestra razón, alcance, opciones, evidencia y
consecuencias sin tapar el canvas; puede cerrarse sin resolver. Cada nodo
pendiente conserva un badge y la franja funciona como cola global.

## Inspector progresivo

El inspector tiene una estructura consistente:

1. **Resumen:** objetivo, estado y razón.
2. **Entradas y salidas:** artefactos y seams en lenguaje de producto.
3. **Validación:** criterios y evidencia.
4. **Cambios:** diff, commits y archivos.
5. **Historial:** intentos, eventos y logs bajo demanda.

No existen tabs globales equivalentes para Tareas, Planificación, Integración o
Interfaces. Esos conceptos se inspeccionan desde el objeto correspondiente.
El inspector lateral puede colapsarse sin alterar selección, pan o zoom; al
seleccionar un nodo o revisar una decisión vuelve a abrirse con ese contexto.

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

- Sidebar colapsable con acceso explícito entre runs reales y laboratorio; el
  grafo mantiene su estado.
- En pantallas estrechas el inspector es un sheet que conserva la misma
  semántica de decisión.
- Todo nodo, edge interactivo, lente y acción es operable por teclado.
- El foco vuelve al elemento invocador al cerrar el inspector/sheet.
- Los live regions anuncian decisiones y estados terminales, no cada evento.
- Cumplimiento objetivo: WCAG 2.2 AA.
