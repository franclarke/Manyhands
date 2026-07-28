# Goal — cerrar la tesis de ManyHands

Completá de forma autónoma el cierre técnico y académico de ManyHands siguiendo
íntegramente [`docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md`](docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md).
Leé ese archivo completo, `docs/tesis/HANDOFF.md`, `PRODUCT.md`,
`docs/README.md`, las instrucciones `AGENTS.md` aplicables y el ticket que vayas
a reclamar antes de modificar nada.

El resultado esperado es:

1. cerrar con evidencia verificable los tickets abiertos 02 y 05–15 de
   `.scratch/code-review-remediation/issues/`, respetando sus dependencias;
2. ejecutar la serie ancha comparable `{4, 8, 16}`, emitir un veredicto honesto
   sobre `validationDuplication` y preservar tanto PASS como resultados
   adversos;
3. ejecutar W2 desde la entrega W1 verificada, o fijar de forma defendible el
   límite longitudinal en 1/8 con sus causas y con “Qué no se concluye”;
4. sintetizar los claims sin presentar parámetros provisionales como derivados;
5. reescribir y verificar tesis, presentación y material de defensa contra la
   evidencia cerrada;
6. dejar tests, typechecks, builds, artefactos, enlaces y commits locales
   coherentes, sin hacer push.

Trabajá ticket por ticket con el ciclo de Pocock definido en el plan: inspección
antes de actuar, TDD para cambios conductuales, diagnóstico causal ante fallos y
revisión independiente por estándares y especificación antes de cerrar cada
ticket. Un reintento nunca puede ser “probar de nuevo hasta que pase”: debe
responder a una causa clasificada y conservar la evidencia anterior.

No finalices por longitud de contexto, consumo de tiempo ni porque una suite
enfocada esté verde. Continuá recalculando el frente desbloqueado hasta cumplir
la definición de terminado del plan. Si el contexto se vuelve insuficiente,
dejá un handoff durable y continuá en el siguiente turno del goal.

Sólo declarate bloqueado cuando la misma condición externa impida progreso
material durante tres turnos consecutivos del goal y no quede trabajo seguro e
independiente. Nunca marques el goal como completo si queda un gate, ticket,
claim o artefacto obligatorio pendiente.

## Inicio recomendado

En una tarea nueva de Codex, ejecutá:

```text
/goal Completa el cierre técnico y académico de ManyHands definido en GOAL.md y docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md. Léelos completos antes de actuar, usa los tickets locales como unidades de trabajo, continúa autónomamente hasta su definición de terminado, conserva resultados adversos y no hagas push.
```
