# Grafo como centro — experiencia objetivo

## Propuesta

ManyHands no es un visor de tareas ni un chat con herramientas. Es un workspace
continuo donde el usuario encarga un objetivo de software, comprende la
estrategia, observa trabajo autónomo y decide únicamente cuando su criterio
cambia el resultado.

El grafo es la representación causal del trabajo. Muestra qué unidades existen,
qué entregan, qué necesitan, cuáles pueden avanzar y dónde se integran. No debe
forzarse para ser didáctico: primero tiene que ser correcto para los agentes y
para el repositorio. La UI traduce esa estructura mediante nombres comprensibles,
resúmenes y progressive disclosure.

## Dos centros de gravedad

### Planning y ejecución

El grafo ocupa el centro. El usuario puede:

- comprender el objetivo de cada nodo;
- seleccionar un nodo para ver contrato, scope, intento y evidencia;
- distinguir jerarquía, requisitos de artefactos, seams y conflictos;
- ver trabajo paralelo y bloqueos locales;
- responder una decisión vinculada al objeto que la originó;
- pausar el run, una rama o cancelar.

### Resultado

Al alcanzar `result_ready`, el contenido principal cambia a:

- objetivo y criterios alcanzados;
- Evidence Matrix;
- cambios integrados;
- validaciones y riesgos residuales;
- historial de reparaciones/enmiendas relevante;
- acción de entrega.

El grafo permanece como mapa secundario de procedencia. No desaparece, pero ya
no compite con el momento de valor.

## Cómo se construye un grafo útil

La raíz expresa el resultado buscado. Sus composites son fronteras reales de
integración. Las hojas son cambios cohesivos e independientemente verificables.

Un buen corte puede ser:

- un incremento vertical que incluye UI, API y tests;
- una capacidad compartida que habilita varios incrementos;
- una migración o adapter con resultado materializado;
- una frontera de módulo que requiere integración propia.

Un mal corte separa frontend y backend por reflejo, crea nodos “planificación” o
“integración” sin entregable, o convierte cada paso narrativo en una tarea.

La profundidad es irregular. El planner detiene la descomposición cuando el nodo
puede ser ejecutado por un agente con contexto acotado, un scope razonable y una
validación convincente.

## Humano fuera del loop, en comando

El sistema ejecuta lo reversible y verificable. Convoca al usuario ante:

- ambigüedad del objetivo que cambia arquitectura o comportamiento;
- aprobación del plan inicial;
- enmienda con impacto visible;
- conflicto conductual no resoluble con evidencia;
- entrega final.

Una decisión no congela lo que no depende de ella. Si todavía hay nodos ready,
el run continúa en `running`. Solo se muestra `waiting_for_input` cuando no queda
trabajo útil que pueda avanzar.

## Criterios de éxito de la experiencia

- En menos de diez segundos se entiende qué se intenta lograr y si algo requiere
  atención.
- Un usuario no técnico puede seguir la historia sin leer firmas ni logs.
- Un usuario técnico puede inspeccionar la evidencia sin cambiar de producto.
- La creación, reintento e integración de nodos se perciben sin perder la
  posición elegida en el canvas.
- Al terminar, queda claro qué se entregará y con qué evidencia.
