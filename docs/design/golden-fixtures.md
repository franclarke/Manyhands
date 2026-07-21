# Run de muestra: recuperación de contraseña

## Propósito

`/runs/proto/golden-password-recovery` es la demostración principal de
ManyHands. Representa un cambio full-stack comprensible para una audiencia
técnica sin exigir contexto de negocio: agregar recuperación segura de
contraseña a un portal existente.

El fixture reproduce eventos canónicos con el mismo reducer y cockpit que un
run live. Es una simulación determinista para demostración y regresión; no es
evidencia de que el backend haya ejecutado ese repositorio.

No se mantienen runs de muestra del diseño anterior. El catálogo de Proto tiene
un único escenario para que la historia sea consistente y fácil de ensayar.

## Historia del run

```text
Recuperación de contraseña
├── Seguridad de la cuenta
│   ├── Token de un solo uso
│   └── Política de sesiones
├── Flujo del servidor
│   ├── Solicitud de recuperación
│   └── Confirmación de contraseña
└── Experiencia del usuario
    ├── Formulario de solicitud
    └── Nueva contraseña
```

El grafo sigue límites reales de un repositorio existente. Las hojas pueden
ejecutarse de manera independiente, pero conservan relaciones diferentes:

- `SeamBinding`: permite construir UI y API en paralelo contra contratos
  congelados.
- `ArtifactRequirement`: la confirmación necesita materializar el servicio de
  tokens y la política de sesiones antes de ejecutarse.
- `ConflictConstraint`: ambos endpoints modifican el router público de
  autenticación y no deben integrarse a ciegas.

## Recorrido recomendado

| Hito | Qué mostrar | Qué explicar |
|---|---|---|
| 1. Objetivo | Run en `planning` | El run, no una tarea individual, es la unidad de producto. |
| 2. Repositorio | Snapshot de stack y auth | ManyHands inspecciona antes de planificar. |
| 3. Plan aprobado | Grafo y relaciones | Planner y Graph Compiler cumplen responsabilidades separadas. |
| 4. Trabajo paralelo | Tres hojas en ejecución | Una decisión local no bloquea trabajo independiente. |
| 5. Reparación automática | Primer intento fallido y segundo activo | La recuperación depende de la causa, no de un retry universal. |
| 6. Decisión humana | Pregunta sobre sesiones activas | Solo los nodos afectados esperan al operador. |
| 7. Integración | Raíz integrada | Se integran artefactos adoptados de abajo hacia arriba. |
| 8. Resultado verificado | Evidence Matrix y candidato exacto | Éxito significa criterios demostrados sobre un commit. |
| 9. Entrega | Lifecycle `completed` | Se publica el mismo candidato que fue verificado. |

El fallo de seguridad es intencional y concreto: una prueba demuestra que el
token podía reutilizarse. El sistema lo clasifica como `code_test`, crea un
nuevo intento de reparación y preserva el resto del trabajo.

La decisión de negocio también es intencional: cerrar o conservar sesiones
activas después del cambio de contraseña. La demo elige cerrar todas las
sesiones, priorizando seguridad.

## Control de reproducción

La barra de demo forma parte del cockpit y ofrece:

- evento anterior y siguiente;
- hito anterior y siguiente;
- play/pause y velocidades de `0,5×` a `2×`;
- reinicio;
- scrubber para saltar a cualquier cursor;
- título y explicación del hito actual.

Toda navegación manual pausa la reproducción. Los controles tienen nombre
accesible y respetan los límites `0..total`. Retroceder reconstruye la
proyección desde el journal hasta el cursor elegido; no mantiene un segundo
modelo de estado.

## Assertions del fixture

- todos los prefijos de eventos se reducen sin error;
- el catálogo contiene solamente `golden-password-recovery`;
- existen dos `ArtifactRequirement`, dos `SeamBinding` y un
  `ConflictConstraint`;
- el primer intento de token falla y el segundo queda adoptado;
- las decisiones terminan resueltas;
- terminar hijos deja cada composite `ready`, nunca `succeeded`;
- Seguridad, Servidor y Experiencia completan su propia integración antes de la
  integración de la raíz;
- la entrega confirmada lleva el lifecycle a `completed`;
- ningún evento cambia automáticamente el viewport del canvas.
