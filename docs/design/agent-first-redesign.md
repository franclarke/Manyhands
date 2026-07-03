# Rediseño agent-first de ManyHands — visión

> Estado: **baseline de diseño** (2026-06-05). Documento de visión. El núcleo técnico está en [`run-operative-model.md`](run-operative-model.md); la experiencia en [`interaction-model.md`](interaction-model.md).
>
> Este rediseño es de la **capa de orquestación + experiencia**. No renegocia las decisiones cerradas del producto (D1–D10, ver [`../DECISIONS.md`](../DECISIONS.md)).

---

## 1. Propósito del rediseño

ManyHands orquesta múltiples coding agents que construyen software en paralelo sobre un DAG de tareas. El producto **no** es "visualizar un grafo de tareas": es **apalancamiento supervisado** — un humano técnico dirige N agentes, confía en que lo que producen funciona, e interviene solo donde su juicio agrega valor, sin leer todos los logs ni inspeccionar cada nodo.

El rediseño existe porque la dirección anterior, sin ser ingenua, resolvía el problema equivocado: era un **visor de planes** cuando lo que el dominio exige es una **sala de control de ejecución**.

---

## 2. Diagnóstico del diseño anterior

Hechos observados sobre la UI previa (todos verificables en el código actual):

| Problema | Síntoma concreto |
|---|---|
| Centrada en planning, no en supervisión | La riqueza viva estaba en la descomposición (árbol vivo, consola CLI); en ejecución los nodos solo cambiaban de color. |
| Vistas pares sin jerarquía | `canvas`, `board` y `timeline` como tres toggles iguales: el usuario carga con elegir el lente. |
| DAG como visor de plan | El grafo mostraba topología estática (dependencias/riesgo), no trabajo vivo. |
| Estado de ejecución pobre | `nodeStatusOverrides` representaba un nodo como `running/done/failed` — un color, no un proceso con loop. |
| Logs crudos promovidos | El stdout de Gemini ocupaba lugar primario; debug ascendido a experiencia. |
| Intervención humana dispersa | Preguntas de planning, aprobación de plan y conflictos vivían en superficies distintas y desconectadas. |
| Sin canal unificado de decisiones | No había un lugar único que rutea la atención humana. |
| Sin seams de primera clase | El contrato entre tareas (lo que habilita el paralelismo) no existía como objeto. |
| Sin modelo de verify-loop | "Éxito" de un nodo = "produjo un diff", no "su código anda". |
| Sin arquitectura de eventos/estado | Estado visual local, sin event log ni reducer ni selectores; riesgo de doble fuente de verdad. |
| Sin modelo de plan vivo | Nada documentaba enmiendas, blast radius, invalidación selectiva ni re-ejecución parcial. |

Estos no eran bugs sueltos: eran señales de un diseño que todavía pensaba el problema como "render de un plan" en lugar de "supervisión de trabajo autónomo".

---

## 3. Principios agent-first

Un sistema agent-first se diseña alrededor de lo que los agentes realmente son:

1. **Malos prediciendo el futuro global** (qué archivos existirán, qué firma tendrá una interfaz que nadie escribió aún).
2. **Buenos resolviendo lo local con contexto concreto.**
3. **No deterministas**, pero **convergen con feedback** (ejecutar, observar el error, corregir).

De ahí, los principios de producto:

- **P1 — Minimizar la previsión global requerida; maximizar el contexto fundamentado y la verificación local.**
- **P2 — El humano fuera del loop, en comando.** El estado por defecto durante ejecución es *mirar*, no *operar*.
- **P3 — Rutear la atención, no exponer todo.** El sistema decide qué merece intervención humana y surfacea solo eso.
- **P4 — Verdad operativa por verificación.** Un nodo "anda" cuando pasa sus tests, no cuando produjo un diff.
- **P5 — Una sola fuente de verdad dinámica** (el event log); todo lo visible se deriva.
- **P6 — La evolución del plan es de primera clase.** Cambiar el plan en vuelo (enmiendas, invalidación, re-ejecución parcial) es comportamiento esperado, no un fallo.

---

## 4. Dashboard-first vs agent-first

| Dimensión | Dashboard-first (anterior) | Agent-first (objetivo) |
|---|---|---|
| Foco | Mostrar todo con igual peso | Rutear la atención a lo que requiere juicio |
| Rol del humano | Operador que monitorea | Director que supervisa e interviene |
| Estado vacío | Pantalla sin datos (incómodo) | "Nada requiere tu atención" = éxito (mostrado con confianza) |
| Ejecución | Colores que cambian | Procesos vivos con signos vitales |
| Intervención | Buscar dónde actuar | El sistema trae la decisión con su contexto |
| Verdad | Estado visual local | Event log → estado derivado |

> Un dashboard te hace cazar información. Una sala de control **decide qué necesitás ver y te lo trae**.

---

## 5. ManyHands como sala de control continua

ManyHands **no** es un wizard (pantallas secuenciales) ni un dashboard (todo a la vez). Es **una sala de control continua**: un único run que **madura** a través de fases, donde lo que cambia es el **centro de gravedad de la atención**, no la pantalla.

La continuidad es deliberada: el usuario observa **el mismo grafo madurar** de hipótesis a frente paralelo a ensamblaje. Nunca pierde el mapa. Esto es lo que evita la sensación de "pantallas desconectadas".

---

## 6. La U de involucramiento humano

El involucramiento del humano no es uniforme: es alto en los extremos y bajo en el medio.

```
involucramiento
  alto │ ███                                   ███
 medio │ ███ ███                           ███ ███
  bajo │ ███ ███ ████████ ejecución ███████ ███ ███
       └──────────────────────────────────────────────
        FRAMING PROPOSAL  FOUNDATION→SUPERVISION  RECON. DISPOSITION
        (autoría)(juicio)  (umbral) (vigilancia)  (arbitraje)(aceptación)
```

- **Autoría (Framing):** el humano expresa intención.
- **Juicio sobre propuesta (Proposal):** decide si confía en el plan antes de gastar cómputo.
- **Supervisión ambiente (Supervision):** mira trabajo autónomo paralelo; no opera.
- **Arbitraje (Reconciliation):** resuelve solo lo que el sistema no puede (conflictos conductuales, enmiendas de contrato).
- **Aceptación (Disposition):** juzga el resultado verificado y lo acepta.

El **medio de la U** es donde agent-first se gana el pan: el humano está *fuera del loop* pero *en comando*.

---

## 7. Ciclo de vida conceptual del run

Seis fases. **No son pantallas rígidas: son centros de gravedad de atención** que se solapan en el tiempo (la fundamentación, la ejecución y la integración se entrelazan bajo el modelo de plan vivo).

| Fase | Acto del sistema | Modo del humano | Pregunta dominante | ¿Gate? |
|---|---|---|---|---|
| **Framing** | Resolver contexto del repo | Autor | ¿Expresé lo que quiero? | no |
| **Proposal** | Descomponer en estructura + costuras (hipótesis) | Juez | ¿Confío en esta división? | **sí** (aprobar plan) |
| **Foundation** | Skeleton, congelar costuras, derivar scopes, computar frente paralelo | Espectador | ¿Qué quedó firme y qué corre en paralelo? | raro |
| **Supervision** | Olas paralelas; cada hoja en verify-loop | Vigía (on-demand) | ¿Todo sano? ¿algo me necesita? | solo si algo se rompe |
| **Reconciliation** | Ensamblar bottom-up, validar por tests; conflictos | Árbitro | ¿Anda el todo? ¿dónde arbitro? | **sí** (conflicto conductual / enmienda) |
| **Disposition** | Materializar evidencia | Juez final | ¿Qué cambió y lo acepto? | **sí** (merge) |

El detalle de qué se ve en cada fase está en [`interaction-model.md`](interaction-model.md). El modelo de datos que las deriva está en [`run-operative-model.md`](run-operative-model.md).

---

## 8. Qué está siempre visible y qué aparece bajo demanda

**Siempre visible** (la mínima espina agent-first):
- La **identidad e intención** del run (una línea).
- La **posición en el ciclo de vida** y la **salud** global.
- El **canal de decisiones** — incluso vacío.

**Bajo demanda** (nunca por defecto):
- Logs crudos del agente, diffs completos, razonamiento del modelo.
- Detalle de un nodo, una costura o un conflicto.
- Lentes secundarios del trabajo (lectura temporal / columnar).

La disciplina: **la superficie primaria responde "¿voy bien?" de un vistazo; el detalle responde "¿qué pasó exactamente acá?" solo cuando se pide.**

---

## 9. "Fuera del loop, pero en comando"

Significa, en términos de comportamiento de producto:

- El humano **no aprueba cada paso**. El sistema ejecuta lo reversible y verificable de forma autónoma.
- El humano **es interrumpido solo** ante decisiones irreversibles o ambiguas (ver tabla de decisiones en [`run-operative-model.md`](run-operative-model.md)).
- Una decisión bloqueante **nunca congela todo el run**: solo el subárbol dependiente espera; lo independiente sigue.
- El humano **puede intervenir en cualquier momento** (peek, steer) sin romper el flujo de ejecución.

---

## 10. Qué hace que el producto se sienta agent-first

Comportamientos concretos, no estética:

1. **Canal de decisiones vacío = éxito**, mostrado con confianza ("N agentes trabajando · nada requiere tu atención").
2. **El paralelismo se ve**: olas de trabajo independiente encendidas a la vez, no una lista.
3. **Cada decisión llega empaquetada con su contexto** (el diff, el conflicto tipado, las dos firmas en pugna) — el humano no caza.
4. **Una re-ejecución parcial se ve parcial**: la mayor parte del grafo intacta es el mensaje de que el cambio es controlado, no un fallo total.
5. **Obsoleto ≠ fallo**: un nodo que era verde y quedó stale se muestra como "superseded", no como regresión.
6. **Verificación como verdad**: el progreso que se muestra es "compila y pasa tests", no "escribió código".

---

## 11. La nueva experiencia objetivo de ManyHands

> ManyHands es una **sala de control continua** para orquestar coding agents en paralelo sobre un DAG vivo. El humano **encarga** una feature, **juzga** el plan propuesto, **supervisa de forma ambiente** mientras múltiples agentes construyen y verifican trabajo en paralelo, **arbitra** solo los conflictos que requieren juicio, y **acepta** un resultado verificado. Todo cuelga de un **event log append-only**; todo lo que se ve es **derivado**. Las costuras entre tareas son contratos de primera clase que *fabrican* el paralelismo seguro; el plan es un artefacto vivo que puede enmendarse con invalidación selectiva y re-ejecución parcial. El humano queda **fuera del loop pero en comando**: el sistema corre solo y lo convoca con precisión, con todo el contexto, en una decisión de segundos.
