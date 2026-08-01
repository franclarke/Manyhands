# Plan de ejecución por etapas — cierre de la evidencia de tesis

> **Documento imperativo.** Está escrito para un agente que trabaja en modo
> objetivo durante mucho tiempo, etapa por etapa, sin supervisión continua.
>
> **Leé primero** `docs/tesis/EVIDENCE-BASELINE.md`. Todo lo que está ahí ya está
> hecho y verificado: no lo repitas ni lo re-midas.

---

## 0. Propósito y no-objetivos

### Qué tenés que lograr

Completar la **evidencia** que falta para que la tesis pueda escribirse, y
dejarla documentada en archivos, de forma que otra persona pueda redactar el
manuscrito a partir de ellos sin volver a ejecutar nada.

### Qué NO tenés que hacer

- **No escribas la tesis.** No toques `docs/tesis/main.tex` ni
  `docs/tesis/presentacion.tex`. La redacción es una fase posterior y no es tuya.
- No amplíes el alcance científico ni agregues hipótesis.
- No inventes experimentos nuevos que no estén en este documento.
- No hagas push. Nunca.

### Cómo se mide que terminaste

Las seis celdas de G6 ejecutadas y preservadas, sus resultados derivados por
script, el veredicto de la hipótesis pre-registrada emitido contra su falsador, y
un dossier de evidencia consolidado. Todo con las limitaciones declaradas.

---

## 1. Cómo trabajar

### 1.1 Protocolo de etapa

Cada etapa tiene dos mitades y **no avanzás sin completar las dos**:

1. **Trabajo** — hacés lo que la etapa pide.
2. **Verificación** — comprobás con evidencia que salió bien, y **escribís el
   resultado en el archivo que la etapa indica**.

Al terminar cada etapa:

- actualizá `docs/tesis/evidence/g6/STAGE-LEDGER.md` con una fila: etapa, fecha,
  resultado, commit, y el archivo de evidencia que produjo;
- hacé un commit local chico con mensaje descriptivo;
- recién entonces pasá a la siguiente.

Si una verificación falla, **no avances**. Diagnosticá, corregí con TDD, y
repetí la verificación. Si no podés corregirlo, escribilo como limitación
declarada en el archivo de evidencia de esa etapa y detené la serie.

### 1.2 Formato de la evidencia

Cada etapa escribe un archivo bajo `docs/tesis/evidence/g6/`. Toda cifra debe
salir de un journal, un log o un script derivador. **Ninguna cifra transcrita a
mano.** Si un dato no se pudo medir, escribí que no se pudo y por qué, en vez de
estimarlo y presentarlo como medición.

Cada archivo de evidencia debe tener una sección final **«Qué no se concluye»**.

### 1.3 Reglas heredadas que siguen rigiendo

Están en `EVIDENCE-BASELINE.md` §7 y §8. Las críticas, repetidas acá porque su
incumplimiento arruina el trabajo:

- `pnpm build` **antes** de `pnpm test` y antes de cualquier run.
- `MANYHANDS_RUNS_DIR` fuera del repositorio.
- Un solo vigía detached por run; nunca polling cada 30–60 s.
- Normalizá finales de línea a LF antes de cada commit.
- **Un intento por celda.** Un fallo pre-candidate conserva su resultado terminal
  y no se reintenta.
- **Nunca muevas `minimumAdvantage`**, ni la fórmula, ni el estímulo, ni los
  criterios externos, ni el oráculo, durante G6.
- Los resultados adversos se preservan y se reportan como salieron.

---

## 2. Etapa 0 — Preflight del ejecutor y decisión

### Contexto que no podés ignorar

La celda 1 de G6 ya se ejecutó con `claude-code-cli/sonnet` y entregó 10/10. El
pre-registro declara el ejecutor como **constante del experimento**: una serie
cuyas celdas usan ejecutores distintos **no es internamente comparable** y no
sirve como estudio.

Francisco pidió usar modelos de Codex, lo más bajos posible. Eso implica
**reiniciar G6 con una selección Codex** y reclasificar la celda 1 como
**piloto**, no como celda del estudio. Su evidencia se conserva íntegra y su
valor —chequeo de piso de capacidad y puesta a punto del instrumento— ya está
cobrado.

### Hacé

1. Verificá que el CLI de Codex funciona headless en esta máquina:
   ```
   codex --version
   ```
   y una invocación mínima de prueba en un directorio temporal.
   **Antecedente:** el 2026-07-30, Codex CLI 0.141.0 falló con
   `windows sandbox: orchestrator_helper_launch_failed ... Acceso denegado (os
   error 5)`. Hoy está instalado 0.146.0. **No asumas que funciona: probalo.**
2. Elegí la selección **más barata que el registro conozca**:
   `{ executorId: "codex-cli", model: "gpt-5.4-mini", effort: "low" }`.
   Los modelos disponibles son `gpt-5.4-mini`, `gpt-5.4` y `gpt-5.5`; los
   esfuerzos válidos son `low`, `medium`, `high`, `xhigh`.
3. Verificá que el servidor levanta y acepta una **mutación autenticada** (POST,
   no sólo `/api/health`).

### Evidencia a escribir

`docs/tesis/evidence/g6/stage-0-executor-preflight.md`: versión del CLI, salida
de la prueba mínima, selección elegida, y —si Codex no arranca— el error exacto.

### Verificación

- El CLI responde y la prueba mínima produce salida.
- El servidor devuelve 201 a una creación de workspace autenticada.

### Si falla

Si Codex no arranca en esta máquina, **no improvises**: escribí el error en el
archivo de evidencia, dejá G6 con la selección Claude ya congelada, y seguí el
plan con `claude-code-cli/sonnet` reutilizando la celda 1 como celda real. Anotá
la desviación y avisá en el ledger.

---

## 3. Etapa 1 — Re-congelar G6 con la selección elegida

**Sólo si la etapa 0 eligió Codex.** Si quedó Claude, saltá a la etapa 2 y
reutilizá la celda 1 existente.

### Hacé

1. Registrá en `docs/tesis/evidence/g6-preregistration.md` una **enmienda
   fechada** que diga: la serie se ejecuta con la selección Codex elegida; la
   celda ejecutada con Claude pasa a **piloto**; el motivo es de presupuesto; y
   la enmienda se hace **antes de que exista ningún dato comparativo** (hay una
   sola celda y queda reclasificada, no descartada).
2. Generá las seis celdas en `docs/tesis/evidence/g6/cells/`, una por
   condición-repetición, todas idénticas salvo `cellId`, `position`, `condition`,
   `granularityCondition` y `targetRepo`. Tomá `g6-01-T1-A-r1.json` como molde.
3. Creá **seis clones objetivo independientes**, uno por celda, desde
   `warehouse-control-tower-compact` rama `wc/compact`, todos en la base
   `5da60192cc788032c59c7e7be27696ca0e0a30d7`, con `core.autocrlf=false` y rama
   local `main`. Nombralos `warehouse-g6-02` … `warehouse-g6-07` o similar; **no
   reutilices un clon que ya recibió una entrega.**
4. Corré el gate completo sobre un único commit limpio, **build primero**, y
   registralo.
5. Actualizá `docs/tesis/evidence/g6/freeze.json`: commit, tree, hash de
   `dist/index.js` del decomposer, marcador de política, lockfile, hashes de
   tarea, criterios, evaluador y driver, y el hash de cada celda. Agregá un
   bloque `supersedes` nombrando el freeze anterior y la razón.

### Evidencia a escribir

`docs/tesis/evidence/g6/stage-1-refreeze.md`: resultados del gate, hashes
fijados, lista de clones creados, y el texto de la enmienda.

### Verificación

- El hash de `dist/index.js` en disco coincide con el del freeze.
- El marcador `adaptive-utility/3.1.0-pilot` está presente en `dist`.
- Cada clon está limpio y en la base exacta.
- `pnpm test` PASS sobre ese commit.

---

## 4. Etapa 2 — Chequeo de piso de capacidad con el ejecutor elegido

Un ejecutor demasiado débil hace fallar a las tres condiciones por igual, y el
resultado mediría capacidad del modelo en vez de granularidad.

### Hacé

1. Ejecutá **sólo la primera celda A** de la serie nueva, completa.
2. Corré el evaluador externo sobre el candidato producido:
   ```
   node docs/tesis/evidence/scripts/run-g6-evaluator.mjs \
     --repository <clon> --delivered-sha <sha> \
     --base-sha 5da60192cc788032c59c7e7be27696ca0e0a30d7 \
     --criteria docs/tesis/evidence/g6/criteria-t1.json \
     --out docs/tesis/evidence/g6/runs/<cellId>/external-verdict.json
   ```
3. Medí el consumo desde el journal: `tokensIn`, `tokensOut`, `costUsd`,
   invocaciones, duración, hojas, reparaciones.

### Evidencia a escribir

`docs/tesis/evidence/g6/stage-2-capability-floor.md` y el `README.md` de la
celda, con el veredicto por criterio y el costo.

### Verificación y criterio de avance

- **Si satisface al menos un criterio de tarea** (los cinco que el baseline no
  satisface): el piso está superado, seguí.
- **Si satisface cero criterios de tarea**: subí **un solo escalón** de modelo o
  esfuerzo, **una sola vez**, registrá la escalada con su razón, re-congelá y
  repetí esta etapa.
- **Si vuelve a dar cero**: **detené la serie**. Escribí que G6 es **no
  informativo sobre granularidad con este ejecutor**, y que eso es un resultado
  sobre el ejecutor, no sobre la política. No sigas gastando celdas.

---

## 5. Etapas 3 a 7 — Las cinco celdas restantes

Ejecutalas **en el orden declarado**, una por etapa, sin cambiar nada entre
celdas:

| Etapa | Celda | Condición |
|---|---|---|
| 3 | `g6-02-T1-C-r1` | C — política adaptativa |
| 4 | `g6-03-T1-B-r1` | B — división fina fija |
| 5 | `g6-04-T1-C-r2` | C — repetición 2 |
| 6 | `g6-05-T1-A-r2` | A — repetición 2 |
| 7 | `g6-06-T1-B-r2` | B — repetición 2 |

### Hacé, para cada una

1. **Chequeo planning-only primero.** Cuesta minutos y centavos:
   ```
   node docs/tesis/evidence/scripts/run-experiment.mjs \
     --config <celda> --out <dir> --stop-after planning
   ```
   Confirma que el plan compila, que las obligaciones traen `evidence`, y
   **cuántas hojas eligió la condición**. Ese dato ya es un resultado.
   Si el planner pide aclaración, **no la respondas**: es una ambigüedad del
   enunciado y la celda se detiene. Registralo y avisá en el ledger; corregir el
   enunciado a esta altura invalidaría las celdas ya corridas.
2. Si el plan compila, ejecutá la celda completa, detached, con **un solo
   vigía**.
3. Corré el evaluador externo sobre el candidato producido.
4. Preservá en `docs/tesis/evidence/g6/runs/<cellId>/`: journal, snapshot,
   `result.json`, log del driver, `external-verdict.json` y un `README.md` con el
   resultado y su costo.

### Evidencia a escribir

Un `README.md` por celda, más una fila en el ledger.

### Verificación por celda

- El SHA evaluado es exactamente el candidato que la celda produjo.
- El veredicto externo tiene los diez criterios con su detalle.
- El consumo está medido, no estimado.
- La evaluación de granularidad de la celda quedó registrada en el journal
  (`planning.granularity_strategy_selected`): condición, features de la raíz,
  `splitAdvantage`, cantidad de hojas.

### Clasificación de un fallo, ya fijada

- **Fallo genuino de la condición** (el plan compila, la ejecución corre, el
  resultado no satisface criterios): cuenta con su cobertura real, aunque sea
  0/10.
- **Fallo de infraestructura, de entorno o de límite de sesión del proveedor**:
  la celda se marca `not_attributable`, se preserva y se reporta aparte.
- **Sin candidato**: cobertura `null`, con su causa terminal, clasificada según
  las dos reglas anteriores.

---

## 6. Etapa 8 — Derivación de resultados

### Hacé

1. Escribí `docs/tesis/evidence/scripts/derive-g6-results.mjs`, versionado, que
   recorra `docs/tesis/evidence/g6/runs/` y emita:
   - `results.csv` y `results.json` con una fila por celda: `cellId`, condición,
     repetición, runId, lifecycle, SHA final, criterios satisfechos, cobertura,
     hojas, `splitAdvantage` de la raíz, duración, tokens, costo, modos de falla;
   - `summary.json` con la métrica primaria por condición y su dispersión entre
     repeticiones.
2. Escribilo con TDD: una regresión que lo ejercite sobre un directorio de
   celdas de prueba.

### Evidencia a escribir

`docs/tesis/evidence/g6/results.md` con las tablas derivadas, más los CSV/JSON.

### Verificación

- Los números del `results.md` coinciden con los `external-verdict.json` de cada
  celda.
- Re-ejecutar el script produce salida idéntica.
- Ninguna celda quedó fuera de la tabla, incluidas las `not_attributable`.

---

## 7. Etapa 9 — Veredicto de la hipótesis

### Hacé

Evaluá **H-G6** contra su falsador pre-registrado, tal como están escritos en
`docs/tesis/evidence/g6-preregistration.md`. No los reformules.

- **H-G6:** en el régimen donde un agente único satura su contexto, C alcanza una
  proporción de criterios externos satisfechos **no menor** que A y **no menor**
  que B.
- **Falsador:** H-G6 queda falsada si A supera a C en la métrica primaria **con
  la misma dirección en ambas repeticiones**.
- **Regla de inconclusión:** si las dos repeticiones de una celda discrepan en
  dirección, esa celda es **inconclusa** y no cuenta como señal. **No agregues
  una tercera repetición.**

### Evidencia a escribir

`docs/tesis/evidence/g6/verdict.md`, con:

- la tabla de la métrica primaria por condición y repetición;
- el veredicto explícito: sostenida, falsada o inconclusa;
- las celdas `not_attributable` listadas aparte, con su causa;
- una sección **«Qué no se concluye»** que diga, como mínimo: que con dos
  observaciones por celda no hay inferencia estadística; que G6 no es comparable
  con G5 porque el ejecutor cambió; y qué quedó sin medir.

### Verificación

- El veredicto se deriva de `results.md` y de ningún otro lado.
- Si el resultado es adverso, **se reporta como salió**. Está acordado por
  escrito con Francisco antes de ejecutar. No lo suavices, no elijas un
  subconjunto de celdas, no reinterpretes el falsador.

---

## 8. Etapa 10 — Reviews independientes pendientes

Los tickets 11, 12, 02, 14 y 15 se cerraron **sin** las reviews Standards y Spec
que el protocolo exige. Es una desviación registrada y hay que saldarla.

### Hacé

1. Pedí reviews independientes **Standards** y **Spec** del delta
   `4f64258..HEAD`, ambas con la instrucción **«No implementes correcciones»**.
2. Si aparece un hallazgo P0/P1/P2, conservalo, corregilo con TDD y volvé a
   pedir la review del punto fijo nuevo.

### Evidencia a escribir

`docs/tesis/evidence/g6/stage-10-reviews.md` con el veredicto de cada review, los
hallazgos y qué se hizo con cada uno.

### Verificación

Ambas reviews en PASS sin hallazgos abiertos, o los hallazgos abiertos declarados
como limitación con su razón.

---

## 9. Etapa 11 — Dossier de evidencia para la redacción

Esta etapa produce el insumo con el que después se escribe la tesis. **Seguís sin
escribir la tesis.**

### Hacé

Escribí `docs/tesis/evidence/THESIS-EVIDENCE-DOSSIER.md`, que reúna, con enlaces
a los archivos y sin re-derivar nada:

1. **PI-1** — qué entregó el sistema, con commits y receipts; y qué no, con las
   causas terminales de las nueve celdas anchas y el 1/8 longitudinal.
2. **PI-2** — la frontera «si / cómo» con el run que la refutó; el veredicto
   sobre `validationDuplication` con su tabla; el resultado de G6 con su tabla; y
   el análisis de implementabilidad de hoja (84 intentos, 94,6 %, ningún proxy de
   tamaño separa).
3. **PI-3** — los modos de falla observados, con su clasificación y su frecuencia.
4. **Parámetros provisionales** y por qué no están anclados.
5. **Limitaciones**, todas juntas, sin suavizar.
6. **Índice de evidencia**: tabla de archivo → qué contiene → qué afirmación
   sostiene.

### Verificación

- Toda afirmación del dossier enlaza a un archivo concreto.
- Ninguna cifra aparece que no esté en un archivo derivado.
- La sección de limitaciones incluye, como mínimo: ninguna serie ancha entregó;
  la cadena quedó 1/8; el caso motivador de 19 hijos nunca se re-midió; G6 no es
  comparable con G5; los parámetros siguen provisionales; y las celdas
  `not_attributable` de G6, si las hubo.

---

## 10. Etapa 12 — Gate final e informe

### Hacé

1. Sobre un único commit limpio, con **build primero**:
   ```
   pnpm build
   pnpm test
   pnpm -r --filter "./packages/*" typecheck
   pnpm --filter @manyhands/web exec tsc --noEmit
   pnpm web:build
   git diff --check
   ```
2. Escribí `docs/tesis/evidence/g6/FINAL-REPORT.md` con: estado de cada etapa,
   decisiones y causas raíz, commits locales, comandos y resultados del gate,
   runs con ejecutor/modelo/SHAs/receipts, veredictos, limitaciones reales, y la
   confirmación explícita de que **no se hizo push**.

### Verificación

- Los cinco comandos en PASS sobre el commit final.
- El ledger de etapas está completo.
- El working tree está limpio.

---

## 11. Presupuesto y reglas de corte

- **Tope por celda: USD 8 de costo reportado.** Si se supera, cortá la celda,
  preservala y reportala como truncada por presupuesto.
- **Tope de la serie: USD 40.** Si se alcanza, detené la serie, reportá qué
  celdas faltaron y no las completes con otra configuración.
- Medí el costo **por celda**, desde el journal, y anotá que los intentos de
  planning no registran `usage`, así que el total real es mayor que el medido.
- Si una celda cuesta mucho más que la anterior porque la condición dividió en
  varias hojas, **eso es un resultado**, no un problema: registralo.

---

## 12. Errores que ya se cometieron y no hay que repetir

- Correr `pnpm test` **antes** de `pnpm build`: la suite ejercita `dist` viejo y
  el verde no vale.
- Sobrescribir evidencia preservada al copiar una corrida nueva sobre el mismo
  directorio. Usá un directorio por corrida.
- Responder una pregunta del planner para «destrabar» una celda: eso inyecta
  estímulo que la celda pre-registrada no autoriza.
- Cambiar un umbral, una fórmula o un criterio para que un caso dé el resultado
  buscado.
- Declarar PASS un gate cuyo fallo se repitió.
- Gastar una celda completa para descubrir algo que un chequeo planning-only de
  tres minutos habría mostrado.
