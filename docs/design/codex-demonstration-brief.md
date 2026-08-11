# Brief de ejecución autónoma — demostración longitudinal

> **Para el agente que ejecuta.** Este documento es la instrucción completa. No
> hace falta leer otra cosa para empezar, pero
> [`longitudinal-demonstration.md`](longitudinal-demonstration.md) explica por qué
> el experimento está diseñado así y
> [`granularity-policy-redesign.md`](granularity-policy-redesign.md) explica la
> política.

---

## 1. El objetivo

Construir una aplicación en **cinco runs sucesivos de ManyHands**, cada uno sobre
el resultado del anterior, hasta que las cinco iteraciones pasen su oráculo.

El sistema va a fallar en el camino. **Eso es parte del trabajo, no un
contratiempo.** Ante cada fallo: encontrar la causa real en el código de
ManyHands, diseñar una corrección, implementarla, y volver a correr la
iteración. Se termina cuando las cinco iteraciones pasan.

**Al terminar** hay que documentar qué construyó el sistema en cada iteración,
con capturas, para que sirva de material de tesis.

---

## 2. El bucle

```
para cada iteración I en [0, 1, 2, 3, 4]:
    repetir:
        correr la iteración I
        si el oráculo de I pasa:
            capturar grafo, inspector, evidencia y app (§6.4)
            escribir la bitácora y la explicación (§6.2, §6.5)
            seguir a I+1
        si no:
            capturar el estado en el navegador (§6.4)
            analizar la causa en el journal del run
            localizar el defecto en el código de ManyHands
            escribir un test que lo reproduzca (rojo)
            corregirlo (verde)
            correr `pnpm test` completo
            registrar el defecto en el ledger
            volver a correr la iteración I
```

### 2.1 La única regla inviolable

> **Ante un fallo se puede cambiar el sistema. No se puede cambiar la tarea ni
> el oráculo.**

Corregir un defecto del plano de control es ingeniería. Aflojar el oráculo o
reescribir el enunciado porque no pasó es ajustar el experimento al resultado y
**invalida toda la serie**.

Única excepción: si el oráculo tiene un defecto **demostrable** —afirma algo
distinto de lo que el enunciado pide, o falla sobre una solución de referencia
correcta escrita a mano— se corrige y **se registra en el ledger como corrección
de instrumento**, con la evidencia de por qué era un defecto.

### 2.2 Un límite conocido del reintento

Un reintento **vuelve a invocar al ejecutor sin contarle qué falló la vez
anterior**. Para un fallo transitorio alcanza; para tests que fallan es repetir
el mismo pedido y esperar otro resultado.

Si se observa que los reintentos de `code_test` fallan siempre igual, **ése es el
defecto a corregir**: hacer que el intento de reparación reciba el motivo del
fallo previo. Está identificado y no implementado; es candidato natural a ser el
primer defecto del ledger.

### 2.3 Cuándo parar y pedir ayuda

- La misma iteración falla **5 veces** por causas distintas.
- La causa está fuera de ManyHands (cuota del proveedor, red, disco).
- La corrección exigiría rediseñar la arquitectura, no arreglar un defecto.

En esos casos: dejar el estado escrito en el ledger y frenar.

---

## 3. Preparación

### 3.1 Modelos y costo

Usar **modelos baratos** en los tres roles (planning, ejecución, reparación).
La demostración es sobre el orquestador, no sobre la capacidad del modelo.

```json
{
  "planningSelection":  { "executorId": "codex-cli", "model": "<modelo barato>", "effort": "medium" },
  "executionSelection": { "executorId": "codex-cli", "model": "<modelo barato>", "effort": "medium" },
  "repairSelection":    { "executorId": "codex-cli", "model": "<modelo barato>", "effort": "medium" }
}
```

### 3.2 Configuración de ejecución

```json
{
  "maxParallel": 4,
  "scopePolicy": "strict",
  "automaticRetryBudget": 2,
  "leafTimeoutMs": 900000,
  "integrationTimeoutMs": 900000,
  "maxWallClockMs": 5400000,
  "unexpectedCommitPolicy": "reject"
}
```

`automaticRetryBudget: 2` es deliberado y es nuevo: las series anteriores lo
tenían en 0 para que el experimento fuera limpio, y por eso el sistema nunca se
recuperaba de nada. **Acá se busca justamente que se recupere.**

Ese número **sólo aplica a las clases de fallo que admiten reintento**. La tabla
de `recovery-policy.ts` declara, por clase, si repetir la llamada puede cambiar
algo: cero para una credencial rechazada o un artefacto no declarado, uno para
tests que fallan. Subir el presupuesto del run no resucita las clases que la
política puso en cero, porque repetir una llamada sin sentido más veces sigue sin
tenerlo.

### 3.3 La compuerta de aprobación del plan

**Todo run para en `needs_approval` esperando la decisión `approve_plan`.** Se
levanta siempre, en cada iteración. No es un fallo: es la compuerta de revisión
del plan.

Hay que resolverla por la API antes de que el run avance:

```
POST /api/runs/<runId>/decisions/<decisionId>   { "optionId": "approve" }
```

El `decisionId` sale del evento `decision.raised` del journal, o de
`GET /api/runs/<runId>`. Si Codex no lo hace, la iteración 0 se queda esperando
para siempre y va a parecer un cuelgue.

**Antes de aprobar hay que mirar el plan**, y si tiene algo evidentemente mal
—una hoja sin criterios propios, un corte que no corresponde— eso **es un
defecto del sistema** y va al ledger: la política debió haberlo rechazado.

### 3.4 Trampas operativas conocidas

Estas ya costaron sesiones enteras. No hace falta redescubrirlas.

| Trampa | Qué hacer |
|---|---|
| El dev server sirve `dist`, no el fuente | **`pnpm build` antes de cada run.** Si no, el run ejercita el código de ayer. |
| Rutas largas en Windows rompen `update_ref` | El target va en `C:/mh-demo/<iteracion>`, nunca dentro del scratchpad. |
| El dev server escucha en `127.0.0.1` | Navegar a `127.0.0.1`, no a `localhost`. |
| `/` tarda minutos con datos reales | Para inspeccionar, abrir `/runs/<runId>` directamente (~10 s). |
| El store compartido de pnpm da `EPERM` | Instalar con `--store-dir <store propio>`. |

### 3.5 Antes de la iteración 0

**Verificación de la condición A.** Correr una vez cualquier objetivo con
`granularityCondition: "A"` y confirmar, **leyendo el árbol compilado en el
journal y no la etiqueta**, que produjo una sola hoja. En todas las series
anteriores decía "A" y ejecutaba siete nodos; nadie lo miró y eso invalidó cada
comparación. Este run no cuenta y su resultado se descarta.

---

## 4. Las iteraciones

El target es un repositorio Git en `C:/mh-demo/`, inicializado vacío con un
commit inicial vacío. **Nada se escribe a mano dentro del target: todo lo genera
el sistema.**

### Iteración 0 — el proyecto

> Crear un proyecto Node ESM con `package.json`, script de test
> `node --test test/*.test.mjs`, un módulo `src/` inicial y un test que pase.
> Sin frameworks, sin paso de build, sin dependencias externas.

**Oráculo 0**: existe `package.json` con script `test`; `npm test` sale con
código 0; existe al menos un archivo de test; no hay `node_modules` commiteado.

Esta iteración establece el comando de validación. Sin ella, "verificado" no
significa nada en las siguientes.

### Iteración 1 — el núcleo

> Modelo de receta (id, título, etiquetas, ingredientes con cantidad y unidad),
> un almacén en memoria con alta y listado, y un servidor `node:http` que sirve
> HTML con la lista de recetas.

**Oráculo 1**: se pueden crear y listar recetas; el servidor responde 200 en `/`
con el título de una receta cargada; los tests del proyecto pasan.

### Iteración 2 — etiquetas y filtrado

> Filtrar recetas por etiqueta, con una página que acepta `?tag=` y una función
> pura de filtrado.

**Oráculo 2**: acumulativo (1 + 2). Filtrar por una etiqueta devuelve exactamente
las recetas que la tienen; una etiqueta inexistente devuelve vacío; `/?tag=x`
responde 200.

### Iteración 3 — lista de compras y estadísticas

> Dos capacidades **independientes entre sí**: una lista de compras que agrega
> los ingredientes de un conjunto de recetas sumando cantidades por unidad, y un
> panel de estadísticas (cantidad de recetas, ingredientes distintos, etiqueta
> más usada).

**Oráculo 3**: acumulativo. La lista de compras suma correctamente cantidades de
la misma unidad y no mezcla unidades distintas; las estadísticas coinciden con
el contenido del almacén.

**Esta es la iteración donde el paralelismo debería verse**: las dos capacidades
no dependen una de la otra, así que la política debería registrar
`runsInParallel: true` y el scheduler despacharlas juntas. Anotarlo.

### Iteración 4 — persistencia, importación y detalle

> Persistir el almacén en un archivo JSON, importar y exportar recetas, y una
> página de detalle por receta.

**Oráculo 4**: acumulativo. Lo persistido se recupera tras reiniciar; exportar e
importar es idempotente; `/recipe/<id>` responde 200 con los ingredientes.

### 4.1 Restricciones del target, válidas en todas las iteraciones

Van en `acceptanceCriteria` de cada run:

- Sin dependencias externas: sólo la librería estándar de Node.
- Sin `Date.now()`, sin `Math.random()`, sin números con decimales en el dominio
  y sin red. Rompen el determinismo del oráculo.
- Sin paso de build ni framework de frontend. HTML renderizado en el servidor.
- Cada iteración conserva el comportamiento de las anteriores.

---

## 5. Los oráculos

Uno por iteración, en `docs/demo/oracle/iteration-<n>.mjs`, **fuera del target**.

- Recibe la ruta de un checkout limpio del SHA entregado y devuelve
  `{ pass, checks: [{ name, pass, detail }] }`.
- No lee prompts, ni trazas, ni el journal de ManyHands. Sólo el código
  entregado y su comportamiento.
- **Acumulativo**: el de la iteración 3 corre también los controles de 1 y 2. Sin
  esto, una regresión en la 4 sobre algo de la 1 pasa desapercibida, que es
  exactamente lo que una cadena longitudinal produce.

**Preflight obligatorio antes de usar cada oráculo.** Debe:
1. **Fallar** sobre el estado del repositorio previo a esa iteración.
2. **Pasar** sobre una solución de referencia escrita a mano.

Sin la segunda mitad no se distingue "el sistema falló" de "los criterios eran
imposibles de cumplir". Si el preflight no cumple las dos, el oráculo está mal y
se arregla antes de correr nada.

---

## 6. Qué registrar

### 6.1 Ledger de defectos — `docs/demo/defect-ledger.md`

Una entrada por defecto corregido:

```markdown
## D-<n> — <título en una línea>

- **Apareció en**: iteración <i>, run `<runId>`
- **Síntoma**: qué se observó
- **Causa**: el defecto real, con archivo y línea
- **Corrección**: qué se cambió y por qué así
- **Test de regresión**: ruta del test que lo reproduce
- **Commit**: sha
```

### 6.2 Bitácora por iteración — `docs/demo/iteration-<n>.md`

Sólo del run que **pasó**:

- `runId`, SHA entregado, duración total, tokens consumidos.
- **El árbol que produjo el sistema**: cada nodo con su título, objetivo y
  archivos, y para cada corte **cuál de las tres razones lo sostuvo**
  (`doesNotFit`, `runsInParallel`, `verifiableApart`).
- Qué implementó cada hoja.
- Cuántos intentos fallaron y cuántas reparaciones hubo dentro del run.
- Resultado del oráculo, control por control.
- Masa de contexto del repositorio al empezar la iteración.

Esto es lo que va a la tesis: **qué nodos se crearon y qué implementó cada
etapa.**

### 6.3 Cómo operar el navegador

**Todo se hace contra la aplicación levantada de verdad, en un navegador real.**
No alcanza con leer el journal: la evidencia de la tesis son capturas del sistema
funcionando.

Levantar la aplicación:

```bash
pnpm build          # obligatorio: el server sirve dist, no el fuente
pnpm web:build
pnpm --filter @manyhands/web start   # queda en 127.0.0.1:3100
```

Manejar el navegador con `puppeteer-core`, que ya es dependencia de la raíz
(`25.3.0`), apuntando al Chrome instalado:

```js
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: false,               // se quiere ver, y las capturas salen mejor
  defaultViewport: { width: 1600, height: 1000 }
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:3100/runs/<runId>", { waitUntil: "networkidle2" });
await page.screenshot({ path: "docs/demo/screenshots/<nombre>.png" });
```

Dos cosas que hacen fallar la captura si no se saben:

- **`127.0.0.1`, nunca `localhost`.** El server no escucha en el segundo.
- **La barra lateral monta colapsada.** Expandirla antes de capturar:
  `await page.click('[aria-label="Expandir barra lateral"]')`.
- **`/` tarda minutos** con datos reales. Ir siempre directo a `/runs/<runId>`.

Si Chrome no está en esa ruta, el fallback es
`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.

### 6.4 Capturas — `docs/demo/screenshots/`

**De cada intento que pasa** (`iter-<n>/`):

| Archivo | Qué muestra |
|---|---|
| `graph.png` | El grafo compilado en `/runs/<runId>`: los nodos que el sistema creó |
| `node-inspector.png` | Un nodo seleccionado con su explicación de granularidad — las tres razones |
| `evidence.png` | La evidencia del run entregado |
| `app.png` | La aplicación construida, corriendo en el navegador |

**De cada intento que falla** (`iter-<n>/failed-<k>/`):

| Archivo | Qué muestra |
|---|---|
| `failure.png` | El estado del run donde se frenó, con el nodo o la decisión que lo trabó |
| `context.png` | El inspector del nodo que falló, o la cola de decisiones |

Las capturas de fallo **no van a la tesis**: son para diagnosticar y para el
ledger. Las de éxito sí.

Y una vez, si ocurre: `recovery.png` — la secuencia fallo → reparación →
entrega. Es la prueba visual de la robustez y vale más que cuatro éxitos limpios.

### 6.5 Explicación por intento exitoso

Además de la bitácora de §6.2, cada iteración que pasa deja en
`docs/demo/iteration-<n>.md` un párrafo en prosa que explique **qué construyó el
sistema y cómo lo decidió**, escrito para que se pueda pegar en la tesis:

> En la iteración 2 el planificador propuso un corte de tres unidades. La
> política conservó dos y colapsó la tercera porque no poseía ningún criterio de
> aceptación propio. Las dos que quedaron corrieron en paralelo —no había
> artefacto que las ordenara— y la integración adoptó ambos resultados sobre la
> base de la iteración anterior.

Con la captura del grafo al lado, eso es una página de tesis.

## 7. Al terminar

Cuando las cinco iteraciones pasen su oráculo:

1. **Resumen** en `docs/demo/README.md`: qué se construyó, en cuántas
   iteraciones, cuántos defectos se corrigieron, y la tabla de las cinco
   iteraciones con SHA, nodos, hojas, razones de corte, tokens y duración.
2. **Progresión de tamaño**: masa de contexto del repositorio al inicio de cada
   iteración, y qué razones de la política se activaron en cada una. Es donde se
   ve si el régimen cambió.
3. **Actualizar la documentación del sistema** si alguna corrección cambió el
   comportamiento descrito en `docs/system/` o `docs/core-pillars/`.
4. **Verificación final**: `pnpm test`, `pnpm -r --filter "./packages/*"
   typecheck`, `pnpm --filter @manyhands/web exec tsc --noEmit`, `pnpm build`,
   `pnpm web:build`. Los cinco en verde sobre el commit final.

---

## 8. Recordatorios sobre el código de ManyHands

- **TDD para todo cambio conductual**: test rojo que reproduce, corrección
  mínima, verde. Un defecto corregido sin test de regresión vuelve.
- **No cerrar nada sin `pnpm test` completo** sobre el commit exacto. Cerrar con
  gates focales ya dejó 12 tests rojos sin que nadie los viera.
- **Finales de línea**: el índice no es uniforme. Antes de commitear, ajustar
  cada archivo modificado al final de línea con que está commiteado y verificar
  con `git diff --numstat`. Un archivo que suma y resta su longitud entera es la
  señal de que se corrigió para el lado equivocado.
- **Nunca `git stash`** para probar una hipótesis sobre el árbol de trabajo.
- **Preservar cambios ajenos**: nada de `reset`, `clean` ni `stash` global.
