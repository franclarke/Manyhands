# Guion opcional de demo - fixture de recuperación de contraseña

> Recurso de preguntas y respuestas, fuera de los 15 minutos de exposición.
> Ruta: `/runs/proto/golden-password-recovery`.
> Estado verificado: 69 eventos canónicos, 9 hitos y 10 nodos.

## Lugar de la demo en la entrevista

La presentación tiene 11 diapositivas principales y 3 de respaldo. El recorrido normal termina en la diapositiva 11; ni los respaldos ni esta demo se abren automáticamente. Durante la exposición, la demostración visual principal es la captura incluida en la diapositiva 6, tomada de [`docs/img/img2.png`](../img/img2.png). No cambies a la UI en vivo por iniciativa propia.

Abrí la fixture únicamente si se cumple al menos una de estas condiciones:

- la audiencia pide ver el sistema;
- terminó la exposición y sobra tiempo;
- quieren profundizar en replay, una decisión local, integración o delivery.

Frase para ofrecerla después de responder una pregunta:

> Tengo una fixture determinista que usa el mismo reducer y cockpit que un run live. Si les sirve, puedo mostrar en dos minutos cómo se proyectan el plan aprobado, el trabajo paralelo, la integración y la diferencia entre `result_ready` y `completed`.

Si nadie la pide, no abrirla. Haber preparado una demo no obliga a usarla.

## Qué demuestra y qué no demuestra

### Apertura obligatoria

> Para explicar el recorrido de forma controlada voy a reproducir una fixture determinista. Contiene 69 eventos canónicos y usa el mismo reducer y el mismo `RunModelView` que un run live. La diferencia es la fuente: no recibe SSE ni ejecuta commands productivos. Esto demuestra replay y proyección de UI; no demuestra que haya agentes o efectos externos ejecutándose ahora.

### Sí demuestra

- que cualquier prefijo de los 69 eventos se reduce a una proyección válida;
- que planning, grafo, decisiones, attempts, integración, evidencia y delivery se expresan con eventos del coordinator;
- que fixture y run live comparten reducer, modelo de presentación y cockpit;
- que avanzar o retroceder reconstruye el modelo desde el journal hasta el cursor;
- que la UI diferencia jerarquía, artifacts, seams, conflicts y estados derivados.

### No demuestra

- ejecución real de Claude Code CLI o Codex CLI;
- existencia real de los commits y archivos nombrados por el escenario;
- operaciones reales de Git, filesystem, red o delivery durante la demo;
- latencia, costo, confiabilidad o seguridad operativa de providers;
- que una fixture visual sustituya los tests o el smoke productivo.

## Datos verificados del escenario

### Estructura

El grafo contiene una raíz, tres composites y seis hojas:

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

Relaciones de la revisión:

- 2 `ArtifactRequirement`;
- 2 `SeamBinding`;
- 1 `ConflictConstraint`.

Los artifacts de token y política de sesiones son inputs materiales para **Confirmación de contraseña**. Los seams relacionan las dos parejas API/UI. El conflict constraint señala que los endpoints de solicitud y confirmación tocan el router público de autenticación.

### Hitos y cursores

| Hito | Cursor | Hecho principal |
|---|---:|---|
| Inicio | 0/69 | seed sin eventos reproducidos |
| 1. Objetivo | 1/69 | `run.created` |
| 2. Repositorio | 2/69 | `repository.inspected` |
| 3. Plan aprobado | 19/69 | graph compilado y revisión aprobada |
| 4. Trabajo paralelo | 25/69 | decisión local pendiente y tres attempts iniciados |
| 5. Reparación automática | 34/69 | fallo `code_test` y segundo attempt de token |
| 6. Decisión humana | 37/69 | token reparado y adoptado; decisión pendiente |
| Resolución | 38/69 | `decision.resolved` |
| 7. Integración | 65/69 | tres composites y raíz integrados bottom-up |
| 8. Resultado verificado | 67/69 | candidato final elegible; lifecycle `result_ready` |
| 9. Entrega | 69/69 | receipt confirmado; lifecycle `completed` |

La captura usada en la diapositiva 6 corresponde al hito 6, cursor `41/69`, con la lente **Todo**, `Artefactos 2`, `Contratos 2` y `Conflictos 1`.

## Preparación opcional antes de la entrevista

1. Desde el checkout correcto, iniciar la aplicación:

   ```bash
   pnpm web:dev
   ```

2. Esperar a que el script informe el puerto efectivo.
3. Abrir `http://localhost:<puerto>/runs/proto/golden-password-recovery`.
4. Presionar **Reiniciar** hasta dejar el cursor en `0/69`.
5. Usar velocidad `1×`; `2×` solo para mostrar planning progresivo.
6. Confirmar los controles visibles:
   - **Ir al hito anterior**;
   - **Retroceder un evento**;
   - **Reproducir/Pausar demostración**;
   - **Avanzar un evento**;
   - **Ir al hito siguiente**;
   - **Reiniciar demostración**;
   - selector de velocidad `0,5×`, `0,75×`, `1×`, `1,5×`, `2×`;
   - scrubber de posición.
7. En el grafo, confirmar las lentes **Ejecución**, **Artefactos**, **Contratos**, **Conflictos** y **Todo**, además de **Autoencuadre**, **Encuadrar** y **Mostrar mapa**.
8. Volver a `0/69` y dejar la ventana detrás de la presentación.

No inicies un run real como plan alternativo. La fixture existe justamente para no depender de credenciales, red, costo o respuesta probabilística.

## Cómo funciona el replay

La barra de demo controla cuántos eventos recibe el modelo:

```ts
buildRunModel(fixture.seed, fixture.events.slice(0, cursor))
```

La navegación manual pausa el autoplay. **Evento anterior/siguiente** mueve un hecho; **Hito anterior/siguiente** salta a un cursor narrativo. Retroceder no deshace estados locales: vuelve a plegar el prefijo de eventos.

Fixture y live run comparten `RunModelView`. En modo fixture:

- `useLiveRunModel` se crea con SSE deshabilitado;
- la barra de acciones productivas del run no se renderiza;
- `command()` retorna antes de llamar a la API;
- los botones de opciones de una decisión pueden verse activos, pero el click no persiste nada; la resolución correcta para la demo se muestra avanzando al evento 38.

Esta precisión importa: los commands están anulados por el modo fixture, aunque no todos los controles se presenten visualmente con atributo `disabled`.

---

## Opción Q&A de 2 minutos - recorrido mínimo

Usar si piden “mostrame rápidamente cómo se ve”. Saltar siempre por hito; no usar autoplay.

### 1. Plan aprobado - cursor 19/69

**Acción**

- Ir al hito 3.
- Seleccionar la lente **Todo** y, si hace falta, **Encuadrar**.

**Decir**

> El planner propuso unidades semánticas y el Graph Compiler produjo esta revisión ejecutable. Hay una raíz, tres límites de integración y seis hojas. Las relaciones no son una arista genérica: artifacts afectan disponibilidad, seams fijan compatibilidad y conflicts restringen riesgo.

### 2. Trabajo paralelo y decisión local - cursor 25/69

**Acción**

- Ir al hito 4 y señalar la franja de decisión.

**Decir**

> La decisión sobre sesiones bloquea solo Política de sesiones y Confirmación de contraseña. Token, Solicitud de recuperación y Formulario de solicitud avanzan en paralelo. Readiness es local al nodo; una duda no pausa el run completo mientras quede trabajo independiente.

### 3. Integración - cursor 65/69

**Acción**

- Ir al hito 7.

**Decir**

> Los resultados elegibles fueron adoptados como artifacts. Seguridad, Servidor y Experiencia se integraron primero; la raíz consumió esos tres resultados. Cada composite necesita su propio `IntegrationManifest` y validación.

### 4. `result_ready` versus `completed` - cursores 67 y 69

**Acción**

- Ir al hito 8 y luego al 9.

**Decir**

> En 67 hay un candidato final verificado: `result_ready`. En 69 existe además un receipt confirmado de publicación: recién ahí el lifecycle es `completed`. La fixture representa esos hechos; no ejecuta el delivery real.

**Cierre**

> Lo importante es que la misma historia canónica explica planning, ejecución, integración y entrega sin un estado paralelo en la UI.

---

## Opción Q&A de 4 minutos - mecanismo completo en seis saltos

1. **0 → 2:** aclarar que es una fixture; mostrar objetivo y snapshot.
2. **2 → 19:** mostrar grafo, relaciones y Planner/Compiler.
3. **19 → 25:** mostrar decisión local y tres attempts concurrentes.
4. **25 → 34 → 37:** mostrar fallo clasificado, nuevo attempt y pregunta humana.
5. **37 → 65:** explicar adopción e integración bottom-up.
6. **65 → 67 → 69:** diferenciar resultado verificado de entrega confirmada.

Frase final:

> La fixture vuelve reproducible la explicación de eventos y UI; la evidencia de effects backend pertenece a tests y smokes separados.

---

## Opción Q&A de 6 a 8 minutos - recorrido recomendado

### Apertura - cursor 0/69

**Acción**

- Compartir solo la ventana del navegador.
- Confirmar `0/69` y “Antes de comenzar”.

**Decir**

> La barra elige un prefijo del journal y el reducer reconstruye el modelo. Por eso puedo retroceder sin mantener otro lifecycle en React.

### Hito 1 - Objetivo - cursor 1/69

**Decir**

> El escenario pide recuperación segura de contraseña. El run completo es la unidad de producto: no alcanza con que termine una hoja; hace falta resultado integrado, validado y entregado.

### Hito 2 - Repositorio - cursor 2/69

**Decir**

> `repository.inspected` registra un portal con Next.js, Node.js, PostgreSQL, sesiones, email, Vitest y Playwright. El planner recibe esa evidencia; distingue `evidenceIds` observados de `plannedPaths` futuros.

### Hito 3 - Plan aprobado - cursor 19/69

**Acción**

- Seleccionar **Todo**.
- Mostrar la jerarquía y los contadores de relaciones.
- Seleccionar **Confirmación de contraseña**.

**Decir**

> Hasta aquí se reprodujeron planning progresivo, `WorkBreakdown`, compilación, revisión y aprobación. El modelo propuso; el compiler fijó identidad, scopes, relaciones y contratos; los critics revisaron coherencia.
>
> `parentId` expresa ownership. Los dos artifacts son inputs materiales. Los dos seams permiten construir UI y API contra interfaces compatibles. El conflict constraint señala riesgo compartido sobre rutas de autenticación, no un conflicto Git ya ocurrido.

### Hito 4 - Trabajo paralelo - cursor 25/69

**Acción**

- Señalar la decisión y los tres nodos activos.

**Decir**

> La decisión sobre sesiones afecta a dos nodos. Readiness deja avanzar token, endpoint de solicitud y formulario. La wave se registra antes del dispatch, de modo que un crash no borra qué trabajo se había seleccionado.

### Hito 5 - Reparación automática - cursor 34/69

**Acción**

- Seleccionar **Token de un solo uso**.

**Decir**

> El primer attempt falló porque una prueba demostró reutilización del token. Se clasificó como `code_test` y se inició un segundo attempt que referencia al anterior. No se reescribe la historia ni se reinicia trabajo independiente ya adoptado.

### Hito 6 - Decisión humana - cursor 37/69

**Acción**

- Abrir la decisión para mostrar **Cerrar todas** y **Conservar la actual**.
- No usar el click como si persistiera un command.
- Avanzar un evento hasta `38/69`.

**Decir**

> La reparación ya quedó adoptada, pero la política de sesiones es una decisión de producto. En un run live la opción se envía al backend. En la fixture `command()` es un no-op, por eso muestro la resolución durable avanzando a `decision.resolved`.

### Hito 7 - Integración - cursor 65/69

**Decir**

> Después se ejecutan las hojas restantes. Los tres composites integran artifacts adoptados y la raíz integra sus outputs. Un padre no queda completo solo porque terminaron sus hijos: produce su manifest y valida su contrato.

### Hito 8 - Resultado verificado - cursor 67/69

**Decir**

> La Evidence Matrix corresponde al commit final exacto. El lifecycle es `result_ready`: hay un candidato elegible, pero todavía no una publicación confirmada.

### Hito 9 - Entrega - cursor 69/69

**Decir**

> `delivery.started` congela la aprobación y `delivery.published` aporta un receipt confirmado. Recién ese hecho lleva el run a `completed`.

**Cierre**

> La fixture simuló los efectos externos, pero reprodujo con el modelo real cómo el journal se vuelve estado, decisiones, integración y delivery visible.

---

## Opción Q&A de 10 minutos - profundización técnica

Usar solo si la audiencia quiere explorar la UI y queda tiempo suficiente.

- En el hito 3, alternar **Ejecución**, **Artefactos**, **Contratos**, **Conflictos** y **Todo**.
- Seleccionar **Confirmación de contraseña** para mostrar dos inputs y el scope.
- En el hito 4, comparar nodos activos con los afectados por la decisión.
- En el hito 5, explicar identidad inmutable del attempt y recovery por causa.
- En el hito 6, mostrar las consecuencias de ambas opciones y luego avanzar al evento 38.
- En el hito 7, seleccionar composites para explicar ownership e integración.
- En el hito 8, abrir **Detalles técnicos** y aclarar que actividad operativa y diagnóstico provienen del mismo journal.
- Retroceder un hito y volver a avanzar para demostrar replay.
- Cerrar con `result_ready` versus `completed`.

## Preguntas probables durante la demo

### ¿La fixture usa una UI paralela?

> No. Usa el mismo `RunModelView`, reducer, layout y presentación del cockpit. Cambia la fuente: un prefijo de eventos determinista en lugar de SSE.

### ¿Por qué no ejecutar un run real?

> Porque esta demo explica el modelo operativo de forma reproducible. Un run real dependería de credenciales, latencia, costo y salida probabilística. La ejecución real se evalúa con tests de adapters, E2E de dominio y smokes productivos, cada uno con alcance explícito.

### ¿Puedo resolver la decisión desde la fixture?

> El control se ve porque comparte el cockpit, pero `command()` retorna sin llamar a la API. El click no persiste. La resolución forma parte del journal y se muestra al avanzar al evento 38.

### ¿El grafo es de LangGraph?

> No. Es una `GraphRevision` del dominio de ManyHands y React Flow la renderiza. LangGraph no participa en la ruta productiva actual.

### ¿Todas las aristas son dependencias?

> No. `ArtifactRequirement` expresa disponibilidad material; `SeamBinding`, compatibilidad; `ConflictConstraint`, riesgo o exclusión; y `parentId`, ownership de integración.

### ¿Por qué la raíz sigue activa cuando varias hojas terminaron?

> Porque los composites y la raíz deben integrar y validar su propio resultado. El estado del padre no es un promedio de los hijos.

### ¿Qué impide adoptar el primer attempt del token?

> Quedó fallido con su propia evidencia. El segundo attempt produce otra identidad y solo se adopta si la validación es elegible y el fingerprint sigue vigente.

### ¿Dónde está la Evidence Matrix completa?

> El cockpit proyecta el resultado y los eventos de validación, pero no es todavía un explorador completo de matrices. La estructura íntegra está en el dominio y el journal. Puedo mostrar `evidence-matrix.ts` si quieren bajar a código.

## Contingencia invertida: la captura es el camino normal

La exposición principal nunca depende de esta UI. Ante cualquier problema, cerrar o dejar en segundo plano la ventana y continuar desde la captura de la diapositiva 6.

### La ruta devuelve 404 o el servidor compila

> La UI opcional no está lista y no quiero consumir tiempo de la entrevista. La captura de la diapositiva muestra el mismo escenario; continúo desde ahí y, si quieren, revisamos luego el código del fixture.

No esperes ni reinicies el relato principal.

### El grafo queda fuera de cuadro

- usar **Encuadrar** una vez;
- desactivar **Autoencuadre** si distrae;
- si no se corrige de inmediato, volver a la presentación.

### El autoplay avanzó demasiado

- pausar;
- volver con **Hito anterior**;
- evitar múltiples clicks rápidos por evento.

### La pantalla compartida tiene poco espacio

- ocultar el inspector;
- conservar barra de hitos y grafo;
- o abandonar la UI y usar la captura.

### La web deja de responder

- no iniciar un run real como reemplazo;
- no depurar en vivo;
- volver a la diapositiva 6;
- ofrecer revisar el fixture o los tests después.

Un fallo de esta demo opcional no modifica ni interrumpe la exposición principal.

## Errores de relato que hay que evitar

- llamar “ejecución real” a la fixture;
- afirmar que el click de una decisión persistió un command;
- llamar `StateGraph` de LangGraph al grafo visual;
- presentar un `SeamBinding` como dependencia de orden;
- presentar un `ConflictConstraint` como conflicto Git ocurrido;
- decir que un composite completó porque terminaron sus hijos;
- presentar worktrees como sandbox fuerte;
- ocultar que commits, paths y receipts son datos del escenario;
- contar esta demo dentro de los 15 minutos;
- insistir en abrir la UI cuando la captura ya respondió la pregunta.

## Evidencia de implementación

La revalidación del 19/07/2026 confirmó los tests funcionales del fixture y de navegación dentro de la suite. El resultado global del worktree fue 163 archivos: 945 tests pasados, 2 regresiones UI fallidas y 1 skipped. Los fallos actuales son `typography-scale.test.ts` —spacing fuera de escala en el cockpit/fixture— y `run-loading-skeleton.test.ts` —drift de layout del skeleton—. No invalidan los assertions de 69 eventos, 9 hitos o replay, pero impiden afirmar que la suite vigente está completamente verde.

- [Historia y assertions del fixture](../design/golden-fixtures.md)
- [Eventos, grafo, contratos y milestones](../../apps/web/src/lib/run-model/fixtures/index.ts)
- [Navegación por cursor e hitos](../../apps/web/src/lib/run-model/fixture-playback.ts)
- [Hook de replay por prefijo](../../apps/web/src/components/run-model/use-fixture-playback.ts)
- [Cockpit de fixture](../../apps/web/src/app/runs/proto/[fixture]/cockpit-fixture-view.client.tsx)
- [Cockpit compartido](../../apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx)
- [Reducer del run](../../apps/web/src/lib/run-model/reducer.ts)
- Tests de [fixture y replay](../../tests/run-model-v2-fixture.test.ts) y de [navegación](../../tests/fixture-playback-navigation.test.ts)
