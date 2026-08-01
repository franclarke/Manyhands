# Pre-registro G6 — re-test justo del estudio comparativo

> Congelado antes de ejecutar la primera celda. Todo lo de acá se decidió sin
> haber observado ningún resultado de G6.

## Por qué existe

G5 **falsó su hipótesis pre-registrada**, y ese resultado no se toca. Pero el
manuscrito identifica dos razones por las que G5 no fue una prueba justa:

1. **El régimen nunca se probó.** Cinco pruebas en el objetivo y ~25k tokens por
   ejecución: ningún agente se acercó a saturar su contexto, que es la condición
   bajo la cual descomponer debería ganar.
2. **La métrica primaria estaba confundida con la condición.** Los criterios se
   compilan por unidad, así que descomponer multiplica las obligaciones y cada
   configuración se evalúa contra su propia vara.

G6 corrige esas dos cosas y **nada más**: no cambia política, fórmula, umbral ni
sistema.

## Acuerdo previo sobre el resultado

**G6 se reporta como salga.** Acordado con Francisco el 2026-07-31, antes de
ejecutar. Si vuelve a falsar la hipótesis, la tesis lo reporta y conserva su
conclusión negativa. No se agregan celdas después de ver datos desfavorables, no
se reinterpreta el falsador, y no se reporta un subconjunto elegido.

## Diseño: seis celdas

**1 tarea × 3 condiciones × 2 repeticiones.**

G5 usó dos tareas. **Se retira la tarea cohesiva (T2)**, y el motivo es que su
resultado ya se sostuvo: las tres condiciones convergieron a una sola unidad,
incluida la que fuerza división fina. Ésa fue la mitad de la hipótesis que G5
**no** falsó, así que re-testearla gastaría la mitad del presupuesto para
confirmar lo ya confirmado. G6 ataca sólo el régimen donde G5 falló como prueba:
la tarea multi-capa sobre un objetivo grande.

Las tres condiciones se conservan porque el aporte necesita las dos direcciones:
A muestra el costo de no dividir, B el de dividir de más.

## Repositorio objetivo

`warehouse-control-tower-compact`, congelado en su HEAD al momento del freeze.

| | G5 | G6 |
|---|---:|---:|
| Archivos `.ts` | 10 | 30 |
| Líneas `.ts` | 617 | 1650 |
| Archivos de test | 4 | 14 |
| Capas | 3 | 6 |

Su procedencia **no se declara como evidencia de ManyHands**: se usa sólo como
repositorio objetivo, igual que cualquier código preexistente.

## Condiciones

- **A** — hoja única forzada.
- **B** — división fina fija, sin coalescing.
- **C** — política adaptativa productiva `adaptive-utility/3.1.0-pilot`, con
  `minimumAdvantage = 0.15` **inmutable durante todo G6**.

## Criterios de aceptación externos

La corrección central. Antes de descomponer, la tarea declara una lista fija de
criterios verificables, **idéntica para las tres condiciones**, que un script
externo evalúa **sobre el árbol entregado** y no sobre las obligaciones que cada
condición compiló.

- la lista se congela en el manifest y su hash queda en el freeze;
- el evaluador es un script versionado con su SHA-256 en el freeze;
- ninguna condición puede agregar, quitar ni reinterpretar un criterio;
- un criterio no se renegocia después de verlo fallar.

## Métricas

**Primaria:** proporción de criterios externos satisfechos sobre el **árbol
candidato que la celda produjo**, haya sido entregado o no.

### Enmienda del 2026-07-31, antes de cualquier dato comparativo

La versión original medía sobre el árbol **entregado**. La primera celda expuso
por qué eso sesga la comparación, y la enmienda se hace ahora, cuando la única
celda ejecutada quedó `not_attributable` y **no existe todavía ningún dato
comparativo** que pudiera haber motivado el cambio.

El compilador de contratos sólo vincula evidencia a una obligación cuando la
unidad tiene **exactamente un criterio de aceptación**
(`contract-compiler.ts`: `if (criteria.length !== 1) return undefined`). La
condición A colapsa el objetivo entero en una hoja, esa hoja acumula todos los
criterios, y por lo tanto **nunca puede vincular evidencia ni entregar**.

Medir sobre el árbol entregado le habría dado a C una victoria automática sobre
A por un artefacto del instrumento, no por granularidad. El estudio compara
condiciones de granularidad, no la maquinaria de validación de ManyHands.

La enmienda **no toca** la hipótesis, el falsador, la regla de inconclusión, los
diez criterios, el umbral ni las condiciones. Cambia qué árbol se evalúa, y sólo
eso.

El defecto de producto se corrige por separado, con TDD, y su corrección se
declara en el freeze de la serie.

**Secundarias**, derivadas del journal por script versionado: entrega verificada
sí/no, tiempo de reloj, tokens, cantidad de hojas, conflictos de integración y
modos de falla.

## Hipótesis, falsador y regla de inconclusión

**H-G6.** En el régimen donde un agente único satura su contexto, C alcanza una
proporción de criterios externos satisfechos **no menor** que A y **no menor**
que B.

**Falsador.** H-G6 queda falsada si A supera a C en la métrica primaria, con la
misma dirección en ambas repeticiones.

**Regla de inconclusión.** Si las dos repeticiones de una celda discrepan en
dirección, la celda se declara **inconclusa** y no cuenta como señal. **No se
agrega una tercera repetición.**

**Lo que G6 no puede responder**, declarado de antemano: con dos observaciones
por celda no hay inferencia estadística. G6 caracteriza dirección, viabilidad y
modos de falla; no produce un p-valor y la tesis no lo va a afirmar.

## Ejecutor

`claude-code-cli` con modelo **`sonnet`**, selección homogénea en planning,
ejecución y reparación, declarada en el manifest y verificada por el preflight.

La elección es de **validez del instrumento**: el objetivo cruza seis capas, y un
ejecutor que no alcance a implementarlo haría fallar a las tres condiciones por
igual, midiendo capacidad del modelo en vez de granularidad. El costo queda
acotado por el techo de tokens declarado abajo, no por bajar el modelo.

Los modelos Claude **no exponen perilla de esfuerzo de razonamiento**: el
registro de ejecutores los declara con `efforts: null` y el adaptador sólo pasa
`--model`. El esfuerzo no es, por lo tanto, una variable de este experimento ni
una que haya quedado sin controlar.

Codex no se usa: su sandbox no arranca en esta máquina y ese fallo ya costó una
celda entera. El ejecutor es **constante del experimento**, no variable, así que
G6 **no es comparable con G5**.

### Enmienda del 2026-08-01, antes de cualquier dato comparativo

El bloque anterior describe el estado previo a la decisión de la etapa 0 y queda
sustituido para la serie comparativa por esta enmienda. G6 se ejecutará con la
selección homogénea `codex-cli / gpt-5.4-mini / low` en planning, ejecución y
reparación. Se elige el escalón Codex más bajo que el registro conoce y que el
preflight verificó funcional en esta máquina, por razón de presupuesto.

La única corrida previa de G6, `g6-01-T1-A-r1`, usó
`claude-code-cli / sonnet`; se conserva íntegra como piloto y no integra la serie
comparativa. La enmienda se registra antes de cualquier dato comparativo: sólo
existía la corrida piloto, que cambia de clasificación pero no se descarta.

El ejecutor es constante dentro de la serie que se analiza. El preflight de
`codex-cli 0.146.0` produjo salida headless con `gpt-5.4-mini` y
`reasoning effort: low`; la evidencia está en
`docs/tesis/evidence/g6/stage-0-executor-preflight.md`. El modelo seleccionado
admite `low`, `medium`, `high` y `xhigh`; G6 fija `low` para las tres etapas del
pipeline y no lo cambia durante la serie.

### Enmienda de escalada del 2026-08-01, antes de la nueva celda A

La primera celda bajo el freeze Codex `gpt-5.4-mini / low` terminó sin candidato:
el planning agotó sus tres intentos internos por errores de compilación del plan y
no se alcanzó ningún criterio externo. El run y sus artefactos se conservan como
fallo pre-candidate del chequeo de piso, fuera de la serie comparativa que se
analizará.

Aplicando la regla declarada en el plan para un piso con cero criterios, se hace la
única escalada permitida: se conserva el modelo `gpt-5.4-mini` y se eleva el
esfuerzo a `medium`. La serie se re-congela con esa selección homogénea antes de
la nueva celda A. No se harán más escaladas ni se reintentará el run `low`.

### Chequeo de piso de capacidad (declarado de antemano)

Un ejecutor demasiado débil para el objetivo haría fallar a las tres condiciones
por igual, y el resultado mediría capacidad del modelo en vez de granularidad.
Para que eso sea **detectable y no silencioso**, se declara ahora:

- La **primera celda A** funciona además como chequeo de piso. Es una celda del
  diseño, no una celda extra: su resultado cuenta igual que las demás.
- Si esa celda no produce **ningún** criterio externo satisfecho, G6 se declara
  **no informativo sobre granularidad** y se reporta como tal: la tesis diría que
  el ejecutor elegido no alcanza el objetivo, no que la política sea peor o
  mejor.
- Ese chequeo **no cambia el diseño, el falsador ni el umbral**, y no autoriza a
  cambiar de modelo a mitad de serie. Si se decidiera repetir G6 con otro modelo,
  sería una serie nueva, con su propio pre-registro, y la anterior se conserva.

## Presupuesto y reglas de corte

- **Techo declarado: 2.000.000 de tokens para toda la serie.** Si se alcanza, la
  serie se detiene y se reporta qué celdas faltaron. No se completa después con
  otra configuración.
- Una ejecución candidata por celda. Un fallo pre-candidate conserva su resultado
  terminal y **no se reintenta**.
- Un fallo de infraestructura, de límite de sesión del proveedor o del entorno
  **no cuenta como fallo de la condición**: la celda se marca `not_attributable`
  y se reporta aparte. Esta regla se fija ahora porque seis de los diez fallos de
  hoja del corpus anterior fueron de esa clase.
- Límite de tiempo de reloj por celda declarado en el manifest.

## Qué se preserva

Journal, snapshot, resultado y diff de cada celda; la salida del evaluador
externo; el freeze con hashes de código, lockfile, tarea, criterios y evaluador;
y el ledger de la serie. Los fallos se preservan igual que las entregas.
