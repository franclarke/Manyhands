# Informe de ejecución — Etapas 4, 5 y 6 (2026-07-24)

> **Qué es este documento.** El registro de qué se ejecutó, qué salió, qué
> encontré y qué haría yo. Está escrito para que otra persona ---o agente---
> pueda auditar cada afirmación contra evidencia versionada.
>
> **Separación deliberada.** Las secciones 1–4 son **hechos observados**: se
> verifican contra archivos del repositorio. La sección 5 son **inferencias**
> mías, con su razonamiento a la vista. La sección 6 es **una recomendación**,
> es decir opinión. Quien continúe el trabajo debería poder rechazar la 6 sin
> tocar las 1–4.
>
> Cronología detallada en [`../tesis/evidence/progress-log.md`](../tesis/evidence/progress-log.md).

---

## 1. Qué se pidió y qué se ejecutó

Cerrar las etapas 4, 5 y 6 del roadmap de tesis: obtener estabilidad
reproducible del orquestador, ejecutar el estudio comparativo pre-registrado, y
dejar tesis y presentación con la evidencia definitiva.

| Gate | Estado | Commit congelado | Evidencia |
|---|---|---|---|
| G4 — estabilidad reproducible | **PASS** | `db096d0` | `tesis/evidence/gates/g4-gate-results.md` |
| G5 — experimento comparativo | **ejecutado** | `4f4ead5` | `tesis/evidence/gates/g5-gate-results.md` |
| G6 — tesis y presentación | **PASS** | `01d425a` | `tesis/main.pdf` (43 pág.), `tesis/presentacion.pdf` (24 slides) |

**38 commits locales, ninguno pusheado.** Gates finales: 193 archivos de test /
1128 tests / 2 skipped, typechecks de packages y web en 0, `pnpm build` y
`pnpm web:build` en 0, `git diff --check` limpio.

---

## 2. G4 — dos ejecuciones válidas consecutivas

| Run | finalSha | Receipt | Tests en clon limpio | Duración | Topología |
|---|---|---|---|---|---|
| `g4-series-1` | `4731cde7` | confirmado | **13** (base 5) | 20 m 50 s | raíz + 3 hojas |
| `g4-series-2` | `4a974180` | confirmado | **10** (base 5) | 6 m 26 s | raíz + 1 hoja |

Ambas sobre el mismo commit, mismo objetivo, mismo baseline restablecido. **Las
topologías son distintas**: el gate lo admite ---exige que ambas satisfagan los
criterios, no que produzcan el mismo grafo--- y es la variabilidad del
planificador remoto, ahora cuantificada.

### Runs descartados, con su motivo

| Run | Motivo |
|---|---|
| `16429274` | Disco a 0 bytes libres; un agente expiró. **Fallo de entorno**, no del sistema. |
| `0c0f066a` | Deadlock silencioso (§3.2) ⇒ defecto sistémico ⇒ serie reiniciada. |
| `5fe0aa27` | No-op legítimo leído como fallo (§3.3) ⇒ defecto sistémico ⇒ serie reiniciada. |
| `53dda539` | **Interferencia mía**: borré el directorio de salida mientras el driver escribía en él. No es fallo del sistema. |

---

## 3. Defectos encontrados — todos ejecutando, ninguno leyendo código

Cada uno con regresión previa al fix y evidencia preservada.

### 3.1 Trabajo correcto rechazado por alcance — `4bc0040`

`allowedPaths` son rutas exactas. Un archivo de prueba **nuevo** que el
planificador no anticipó invalidaba un candidato correcto: 3 de 3 agentes salían
con exit 0 y los 3 candidatos se rechazaban.

Corrección: **creación acotada** vía `outputRoots`, sin relajar el invariante.
Los roots los deriva el compilador de los directorios que el nodo ya posee ---el
modelo no puede pedirlos---; una ruta en la raíz no produce root; solo autorizan
*crear*, no editar un archivo preexistente no declarado; `forbiddenPaths` sigue
ganando; «nuevo» lo determina `git diff --diff-filter=A`.

### 3.2 Deadlock silencioso — `c227205`

Un nodo adoptaba **solo** su artefacto de resultado. Un artefacto declarado por
el planificador entre unidades hermanas nunca se satisfacía, sus consumidores
jamás se volvían elegibles, y el run quedaba **sin fallo, sin decisión y sin
avance**: indistinguible de trabajo en curso.

Estaba **latente en todos los runs anteriores**. Solo apareció cuando el
planificador, por variabilidad, declaró ese artefacto.

### 3.3 No-op legítimo leído como fallo — `db096d0`

Una unidad fusionada hereda las rutas de sus fuentes, así que puede implementar
trabajo de una hermana **sin violar ningún contrato**. La hermana entonces no
tiene nada que hacer y produce un diff vacío, que el sistema clasificaba como
fallo.

El heurístico que debía detectarlo (`baselineSatisfiesContract`) era
**inalcanzable** en esa ruta: necesita `expectedOutput` o `executionScope`, y la
ruta V2 no pasa ninguno.

No lo corregí con un heurístico mejor ---derivar rutas desde `allowedPaths` daría
verdadero siempre sobre un repositorio existente, y un agente ocioso pasaría como
éxito---. Ahora un diff vacío **revalida la base** y solo se acepta si el
contrato está genuinamente satisfecho.

### 3.4 Umbral negativo rechazado por el esquema — `4f4ead5`

El esquema del evento exigía `leafThreshold` **positivo**. La condición B
---«ninguna unidad es hoja»--- necesita un valor por debajo del mínimo
alcanzable (`-1`). **Los 4 runs de la condición B murieron en planificación.**

Mis tests de política no lo detectaron porque **ninguno hacía round-trip por el
evento que el planificador realmente escribe**.

### 3.5 Tokens no leídos — `fe6d5ab`, `3bc253d`, `db096d0`

Codex reporta su consumo en stdout ---y a veces en stderr--- y nada lo leía. Sin
eso, RQ2 (el lado del costo) no tenía datos. Se persiste el **total**, sin
inventar el desglose entrada/salida que el CLI no provee.

---

## 4. G5 — resultados

Doce celdas sobre `4f4ead5`, **10 entregas**.

| Tarea | Cond. | Entregas | Reloj (s) | Tokens |
|---|---|---|---|---|
| T1 multi-capa | **A** no dividir | **2/2** | 259, 357 | 21 794, 24 898 |
| T1 multi-capa | B división fina | 1/2 | 942, 1209 | 111 663, 101 120 |
| T1 multi-capa | C adaptativa | 1/2 | 810, 1109 | 104 361, 96 316 |
| T2 acotada | A | 2/2 | 282, 291 | 29 546, 28 385 |
| T2 acotada | B | 2/2 | 362, 393 | 52 499, 28 270 |
| T2 acotada | C | 2/2 | 344, 351 | 32 096, 26 299 |

### 4.1 La hipótesis pre-registrada quedó falsada

La hipótesis era que C se comportaría como A en T2 y **no peor que B en T1**.

- **En T2 se sostiene, y por el mecanismo previsto:** las tres condiciones
  produjeron **una sola unidad**, incluida B, que fuerza dividir.
- **En T1 se falsa:** A entregó 2/2 con cerca de un tercio del tiempo y un cuarto
  de los tokens, entregando la **misma superficie pública** (verificado sobre los
  diffs: `expenseCategories`, `ExpenseCategory`, `computeCategoryTotals`,
  `listCategoryTotals` y el desglose web; la diferencia son 3 tests contra 6).

### 4.2 Defecto de medición: la métrica primaria no compara condiciones

Los criterios de aceptación se compilan **por unidad**, así que su cantidad es
función de la descomposición:

| Cond. (T1) | Hojas | Criterios evaluados | Diff |
|---|---|---|---|
| A | 1 | **5** | +96 / −11 |
| B | 3 | **14** | +176 / −8 |
| C | 3 | **14** | +156 / −9 |

Las 12 celdas dieron cobertura 1,00. **No significa que superaran la misma vara:
cada una satisfizo la suya.**

### 4.3 Dos intentos completos descartados

| Intento | Motivo | Regla aplicada |
|---|---|---|
| 1 | Esquema anuló la condición B (§3.4) | §6 del protocolo: reiniciar completo |
| 2 | Objetivos sub-especificados; el planificador se detenía a preguntar | §6 + enmienda E-1 |

Ambas correcciones quedaron registradas como **enmiendas E-1 y E-2** en el
protocolo, con el argumento de por qué no son ajuste post-hoc. **La regla de
escalamiento no se invocó** pese a que dos celdas discrepan entre repeticiones:
agregar una tercera tras ver datos desfavorables es exactamente el ajuste que el
pre-registro prohíbe.

---

## 5. Inferencias — el razonamiento a la vista

> A partir de acá dejo de reportar y empiezo a interpretar. Cada inferencia lleva
> el dato que la sostiene.

### 5.1 El experimento no pudo probar su hipótesis

**Dato:** el repositorio objetivo tiene **215 líneas en 4 archivos** (`src/api`,
`src/domain`, `src/web`, `tests`). La condición A consumió ~22 000 tokens.

**Inferencia:** la hipótesis de la descomposición es que ayuda cuando un agente
único **satura su contexto**. Con esos números eso no ocurrió ni cerca. El
experimento midió si conviene dividir trabajo trivial ---y la respuesta es que
no, cuesta más---. Eso no es un hallazgo sobre la política.

### 5.2 La política es ciega a la escala

**Dato.** Dimensiones que produjo sobre esas 215 líneas:

| Unidad | Sr | Ii | Vs | Tm | C_task |
|---|---|---|---|---|---|
| `add-expense-categories` (raíz) | 5 | 5 | 6 | 4 | **5,05** |

**Dato.** En `packages/decomposer/src/granularity/adaptive-planning.ts`, solo
`scopeRadius` se acota contra algo real (cantidad de rutas):

```ts
contextTokenMass: clampDimension(raw.contextTokenMass)   // solo acota a [0,10]
```

y el fallback determinista deriva `contextTokenMass` de `pathCount * 1.5` ---
cuenta archivos, no mide su tamaño.

**Inferencia:** tocar 3 archivos de 70 líneas puntúa igual que tocar 3 de 3 000.
`Tm = 4` sobre ~3 000 tokens totales implicaría que 10/10 son ~7 500 tokens, lo
que no se corresponde con ningún presupuesto real. **La política dividió porque
no puede ver que el repositorio es minúsculo.**

Esto reencuadra el resultado negativo: no es «la política no ayuda», es «la
señal está mal anclada y por eso decidió mal en este régimen».

### 5.3 Aritmética de lo que cambiaría (predicción falsable)

Con umbral 3,5 y C = 5,05 hacen falta 1,55 puntos:

| Cambio | Efecto | C resultante |
|---|---|---|
| `Tm` anclado en tokens medidos (~3k → ≈0) | −4 × 0,20 = −0,80 | 4,25 (sigue composite) |
| **+** `Sr` anclado en magnitud, no en conteo (4 archivos chicos → ≈1) | −4 × 0,30 = −1,20 | **3,05 → hoja** |

Sobre un repositorio grande, las mismas «3 capas» puntuarían alto y seguiría
dividiendo. **Esta predicción es falsable y barata de probar.**

*Advertencia:* la aritmética asume una definición concreta de «anclar». Distintas
definiciones dan distintos números; lo verificable es la dirección, no el valor.

### 5.4 La hipótesis también estaba mal planteada

Mezcla dos afirmaciones, usa la métrica confundida, **no declara el régimen**, y
además B y C produjeron topologías casi idénticas en T1 ---así que el contraste
que importaba, A contra el resto, quedó enterrado en el diseño.

---

## 6. Qué haría yo — recomendación (opinión)

> Esta sección es descartable sin afectar nada de lo anterior.

### Trabajo de implementación, por impacto

**P1 — Criterios de aceptación externos.** Sin esto ninguna comparación es
interpretable, ni siquiera en el régimen correcto. La celda declara un conjunto
único, evaluado contra el árbol entregado, idéntico para A, B y C. Es además lo
que un usuario real quiere saber.

**P2 — Anclar `scopeRadius` y `contextTokenMass` en magnitud medida** desde el
`RepositoryIndex` que ya existe: bytes/tokens reales de los archivos en alcance y
tamaño relativo al repositorio. El LLM sigue proponiendo; el validador acota
contra cantidades **medidas**. Es el fix mecánico de §5.2.

**P3 — Un objetivo donde la saturación sea posible.** No es trabajo de sistema,
pero probablemente lo destape: el compresor de contexto sigue sin trazarse a la
ruta productiva de planning (CLAIM-004).

**P4 — Clasificar los fallos como causados-por-granularidad vs incidentales.**
Hoy un timeout de agente y una violación de alcance cuentan igual.

**P5 — Detección de readiness insatisfacible.** Hoy el run espera en vez de
fallar con su causa; solo un límite de reloj externo lo corta.

### Hipótesis que yo plantearía

| | Hipótesis | Métrica | Estado |
|---|---|---|---|
| H1 | Sobre trabajo cohesivo, C produce el mismo número de unidades que A | estructural | **ya confirmada** |
| H2 | La decisión de C cambia con la magnitud del repositorio para la misma forma de tarea | estructural | **testeable barato**; hoy fallaría |
| H3 | Donde un agente único se degrada, C entrega más seguido que A | criterios externos | **nunca se probó** |
| H4 | El costo de coordinación es acotado y predecible | reloj, tokens | **ya medida** (~800 s, ~75k tokens) |

### Lo que esto **no** garantiza

Que H3 resulte falsa sigue siendo un desenlace posible y legítimo. P1–P5 hacen
que el experimento sea **capaz de responder**; no garantizan que responda a
favor. Si tras todo eso la descomposición sigue sin mostrar ventaja, ese
resultado es más fuerte que el actual, porque la pregunta estaría bien hecha.

---

## 7. Errores míos durante la ejecución

Se declaran para que el conteo de runs sea honesto y para que nadie los repita.

1. **Borré el directorio de salida mientras el driver escribía en él**, abortando
   una celda con ENOENT. Interferencia mía, no fallo del sistema.
2. **Lancé un run contra un `dist` del día anterior.** El servidor de desarrollo
   resuelve `@manyhands/*` desde los paquetes **compilados**, no desde las
   fuentes: sin `pnpm build` previo, el run ejercita el código anterior. Los
   tests pasan igual, así que el fallo es silencioso.
3. **Mi script de derivación leía el estado terminal un nivel demasiado arriba**
   (`result.lifecycle` en vez de `result.outcome.lifecycle`) y reportó las 12
   celdas como no entregadas cuando 6 habían entregado. Lo detecté porque el
   número no cuadraba con el ledger de la serie.

---

## 8. Estado operativo pendiente

| Asunto | Estado |
|---|---|
| **Disco** | ~3 GB libres de 429 GB usados. Liberé ~1 GB borrando `.manyhands/_archive_old_runs` y `_archive_huge` (runs legacy V1/V2 ya declarados descartables). **Consecuencia declarada:** la observación de `stage-1-baseline.md` sobre esos archivos ya no es re-verificable. |
| **Push** | 38 commits locales. Nada pusheado, por instrucción. |
| **Servidor** | Detenido. |
| **Toolchain LaTeX** | MiKTeX 25.12 instalado en scope de usuario. Requiere `initexmf --set-config-value="[MPM]AutoInstall=1"` para la primera compilación. |
