# Modelo de interacción — UX / producto

> Estado: **baseline de diseño** (2026-06-05). Describe **comportamiento, jerarquía y reglas de interacción**, no diseño visual fino (colores, CSS, tipografía). Se apoya en las fases de [`agent-first-redesign.md`](agent-first-redesign.md) y en los selectores de [`run-operative-model.md`](run-operative-model.md).

---

## 1. Un run de punta a punta

El usuario vive **un solo espacio que madura**, no una secuencia de pantallas. La estructura espacial es constante; lo que cambia es el **centro de gravedad**:

```
[ marco persistente del run: intención · fase · salud · canal de decisiones ]
[ ───────────────── superficie de trabajo (phase-adaptive) ───────────────── ]
[ panel de foco (on-demand) ]            [ canal de comandos (⌘K, on-demand) ]
```

1. **Framing** — el usuario describe la feature. La superficie es el compositor de intención; el DAG no existe aún.
2. **Proposal** — aparece el DAG como **hipótesis**; el usuario lo juzga y aprueba (un gate).
3. **Foundation** — el mismo grafo se *solidifica*: archivos reales, costuras que se congelan, el frente paralelo se revela. Umbral breve.
4. **Supervision** — el grafo se vuelve **wavefront**: olas paralelas con signos vitales. El canal de decisiones está ambiente (vacío = sano).
5. **Reconciliation** — el grafo cambia a **ensamblaje**; los conflictos que requieren juicio aparecen como decisiones bloqueantes.
6. **Disposition** — la **evidencia** toma el centro; el DAG se degrada a mapa de contexto.

Las transiciones **no navegan**: el usuario nunca cambia de página ni pierde el mapa. La superficie reinterpreta el mismo grafo.

---

## 2. Superficie principal por fase y rol del DAG

| Fase | Superficie dominante | Rol del DAG |
|---|---|---|
| Framing | Compositor de intención | ausente |
| Proposal | Estructura del plan | **protagonista** (como hipótesis) |
| Foundation | Solidificación + costuras congelándose | **protagonista** (madurando) |
| Supervision | Wavefront | **protagonista** (trabajo vivo) |
| Reconciliation | Ensamblaje + arbitraje | **protagonista** (convergencia) |
| Disposition | Evidencia (diff + tests + narrativa) | **contexto** (mapa pequeño) |

> El DAG es el **escenario recurrente**, no el protagonista permanente: cede el centro a la *intención* al inicio y a la *evidencia* al final.

---

## 3. El marco persistente del run

Siempre visible, en todas las fases. Responde "¿qué construimos y dónde estamos?". Contiene exactamente tres cosas (todo derivado):
- **Intención** del run (una línea).
- **Posición en el ciclo de vida** (`selectPhase`) + progreso.
- **Salud** (`selectHealth`) y el **canal de decisiones** (`selectAttention`).

Esta minimalidad es deliberada: es la espina agent-first. Nada más merece estar siempre presente.

---

## 4. El canal de decisiones

Concentra **toda** intervención humana tipada en un lugar (`selectAttention`). Reglas:
- **Vacío por defecto, y vacío = éxito operativo**: se muestra con confianza ("N agentes trabajando · nada requiere tu atención"), nunca como un hueco vacío incómodo.
- **Bloqueante vs advisory**: una decisión bloqueante es asertiva (el subárbol afectado espera); una advisory es ambiente (FYI, el run sigue). Esta distinción evita los dos fracasos: el notification-center que molesta y el gate que se pierde.
- **Cada decisión llega con su contexto embebido**: aprobar plan muestra el plan; resolver conflicto muestra las dos interpretaciones + el test que falla + los candidatos; aprobar enmienda muestra la firma `de→a` + el blast radius (preview).
- **Resolución inline**: el gate se resuelve sin salir del run.

> **Una decisión bloqueante nunca pausa todo el run.** Solo el subárbol dependiente entra en `blocked` (atenuado); lo independiente sigue ejecutando. Esto preserva el valor del paralelismo: el humano decide mientras el resto avanza.

---

## 5. La superficie de trabajo phase-adaptive

Es **una sola** superficie (el grafo) que cambia de énfasis, **no** tres vistas pares. La lectura temporal (timeline) y la columnar (board) son **lentes secundarios** que se invocan, no modos por defecto.

- **Selección** de un nodo/costura/conflicto → abre el **panel de foco** (no navega, no pausa).
- El **wavefront** (`selectWavefront`) dirige el énfasis y el movimiento durante Supervision.
- Los **edges están tipados**: dependencia / costura / conflicto. La costura es portante.

---

## 6. El panel de foco (polimórfico)

Profundidad on-demand de **un** objeto. Nunca abierto por defecto.
- **Nodo:** signo vital expandido, scope, diff (lazy por ref), log (lazy).
- **Costura:** firma congelada, contrato semántico, productor/consumidores, revisión, estado draft/frozen/amended.
- **Conflicto:** diagnóstico (dos lados, assertion que falla, candidatos con blast radius).

Selección → foco es **peek**: la superficie sigue viva detrás; no se interrumpe la ejecución.

---

## 7. Cómo se representa cada concepto (comportamiento)

| Concepto | Comportamiento de representación |
|---|---|
| **planning** | El grafo se "forma" (nodos apareciendo); estilizado como hipótesis (provisional). |
| **seam draft** | Edge punteado entre productor y consumidores. |
| **seam frozen** | El edge pasa de punteado a sólido (la costura se congeló → habilita paralelismo). |
| **seam amended** | El edge marca "contrato cambiado"; preview del blast radius sobre los nodos afectados. |
| **wavefront** | Los nodos de la ola activa encendidos **a la vez**, cada uno con signo vital. |
| **verify-loop** | Signo vital compacto en el nodo: `build ✓ · tests 4/5 · retry 2/3`. El detalle/log, en el foco. |
| **blocked** | Nodo atenuado con indicación de qué espera; **no** es alarma. |
| **stale / obsolete** | Nodo que era verde, ahora "superseded" (neutro), con afordancia de re-ejecución. **Nunca rojo de fallo.** |
| **conflict** | Edge tipado entre los nodos implicados; los no implicados quedan sin marca. |
| **decision pending** | Item en el canal de decisiones, bloqueante o advisory, con contexto embebido. |
| **integration** | Énfasis de ensamblaje: el frente converge hacia arriba; gates de test por compuesto. |
| **evidence** | Superficie protagonista al final: diff agregado + prueba de tests + narrativa (incl. traza de invalidación). |

---

## 8. Cómo se evita saturar al usuario

- **Jerarquía + progressive disclosure**, no esconder: la superficie primaria responde "¿voy bien?"; el detalle responde "¿qué pasó acá?" solo si se pide.
- **Bajo demanda (drawers/paneles secundarios):** logs crudos del agente, diffs completos, razonamiento del modelo, lentes temporal/columnar. Razón: son debug y profundidad, no la experiencia primaria. Promoverlos (como hacía la consola CLI) ahoga la señal.
- **Signos vitales compactos** en lugar de streams crudos durante ejecución. Mostrar todos los eventos satura; el resumen (`tests 4/5 · retry 2/3`) comunica el estado sin ruido.

---

## 9. Reglas de interacción que definen el carácter agent-first

1. **"Vacío en decisiones" se muestra como éxito**, con un mensaje afirmativo, no como pantalla en blanco.
2. **Una decisión bloqueante no congela el run**: solo el subárbol dependiente espera; el resto del wavefront sigue. El usuario ve claramente *qué* espera y *qué* sigue.
3. **Una re-ejecución parcial se ve parcial**: solo los nodos afectados vuelven a latir; los no afectados quedan verdes y estáticos. *El contraste —la mayor parte del grafo intacta— es el mensaje de que el cambio es controlado, no un fallo total.*
4. **Obsoleto ≠ fallo**: un nodo invalidado por una enmienda se muestra distinto de un nodo fallado. Es evolución planificada, no regresión.
5. **El blast radius se previsualiza antes de aprobar** una enmienda: el humano ve exactamente qué se va a invalidar y qué se preserva, *antes* de decidir.
6. **Peek sin interrumpir**: inspeccionar nunca pausa la ejecución.
7. **Steer por teclado** (canal de comandos): el usuario técnico actúa por comando, no cazando botones.

---

## 10. Qué NO debe hacer la interacción (anti-patrones a evitar)

- No tratar canvas/board/timeline como vistas pares (vuelve a "dashboard").
- No promover logs crudos a la superficie primaria.
- No mostrar el estado de nodo desde `execution` directo (debe usar `selectRenderableNodeState`, o mostrará obsoleto como done).
- No dispersar la intervención humana en múltiples superficies (todo va al canal de decisiones).
- No usar un spinner genérico para "trabajando": el trabajo se expresa con el signo vital del verify-loop y el wavefront.
