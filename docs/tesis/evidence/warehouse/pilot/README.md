# Warehouse Pilot

Estado: **iniciado; primer W1 invalidado y no adoptado**.

Esta construcción permite corregir C, ManyHands, prompts y drivers. Sus runs se
conservan como evidencia formativa y no responden las preguntas finales de la
tesis. El piloto sólo cierra cuando W1–W8 pasan sus oráculos externos.

## Intentos preservados

- El primer lanzamiento fue abortado por preflight antes de crear un run:
  `seed_hash_mismatch`. La causa y regresión están en
  [`defects/seed-lock-checkout-normalization/README.md`](defects/seed-lock-checkout-normalization/README.md).
- El run W1 `dbd343bd-3f65-4a51-90e0-742b5806c789` completó y entregó
  `651948b03cccb884ee41cbe4f20d4f43d290bfe1`, pero el oráculo externo falló.
  La entrega no fue adoptada como base W2. Reveló dos defectos independientes:
  la superficie de comandos quedó fuera del scope aunque el planner la exigía,
  y el prompt no publicaba la envoltura JSON exacta esperada por el oráculo.
  Véanse
  [`validation-stub-command-surface`](defects/validation-stub-command-surface/README.md)
  y
  [`oracle-contract-underspecified`](defects/oracle-contract-underspecified/README.md).

Resultado acumulado del piloto: **0/8 incrementos verificados**. El siguiente
intento comienza desde un clon nuevo del seed; no modifica ni oculta esta
evidencia formativa.

## Segundo intento W1

La serie `series-2` ejecutó el run `2d0ef7fe-5f3c-4e33-b8e8-4484b916f98c`
sobre un clon nuevo. ManyHands incluyó `package.json` en scope, reemplazó los
stubs, completó sin repair y entregó
`f49dffa5e33d2bc812a41c4fa3b0810767b712aa`. El incremento tampoco fue adoptado:

1. el oráculo descubrió que el banner de pnpm contaminaba el canal JSON;
2. una reejecución diagnóstica silenciosa reveló además un FAIL productivo: la
   entrega omitió el prefijo `sha256:` y aplanó `layout` e `inventory` fuera de
   `capabilities`.

Las causas y regresiones están en
[`pnpm-json-channel`](defects/pnpm-json-channel/README.md) y
[`contract-fidelity`](defects/contract-fidelity/README.md). Resultado acumulado:
**0/8 incrementos verificados**.

## Endurecimiento del instrumento antes del cuarto intento

Los tres W1 fallaron por tres causas distintas, y dos eran decidibles sin gastar
un run. Antes de reanudar, el instrumento se hizo auto-verificable: el contrato
de la sonda pasó de prosa duplicada en ocho prompts a un specimen único desde el
que se renderizan los prompts y se derivan las reglas del oráculo, probado por
mutación. El oráculo ahora rechaza en milisegundos una superficie de comandos
ausente o stub, y reporta todas las violaciones juntas.

Ese trabajo reclasificó una de las dos causas del segundo W1 como ambigüedad del
estímulo, no como defecto de la entrega. Véase
[`defects/prompt-oracle-contradiction`](defects/prompt-oracle-contradiction/README.md).
El acumulado no cambia: **0/8 incrementos verificados**.

El estudio también cambió de executor a Claude Code CLI `sonnet`, que reporta
tokens y costo exactos donde Codex declaraba `unavailable`. El cuarto intento no
espera a la recuperación de cuota del 2026-07-30.

## Tercer intento W1 — interrupción externa

La serie `series-3` no llegó a producir un breakdown. Sus tres planning attempts
recibieron del Codex CLI el mismo rechazo de cuota y cero bytes de stdout. No
hubo selección C, agente de código ni entrega. Se clasifica como interrupción
de capacidad externa, no como resultado del sistema bajo estudio. Véase
[`interruptions/codex-usage-limit-2026-07-25.md`](interruptions/codex-usage-limit-2026-07-25.md).

## Series 4 a 7 — planning corregido, ejecución interrumpida

Las series `4` a `7` corrieron sobre Claude Code `sonnet`. Produjeron tres
defectos productivos de planning, todos corregidos con TDD y documentados en
`defects/`. `series-7` superó planning por primera vez y persistió una decisión
C real, pero su agente agotó el límite de sesión del proveedor durante la
ejecución; véase `interruptions/claude-session-limit-2026-07-25.md`.

Resultado acumulado del piloto: **0/8 incrementos verificados**.

## Series 8 a 12 — primer incremento verificado y dos defectos de la política

`series-12` produjo el primer resultado positivo del piloto. **W1 entregó
`71f61c9e` y su oráculo externo pasó los seis checks** (`command-surface`,
`test`, `typecheck`, `build`, `layout`, `inventory`), con
`stateHash sha256:1cad6e71fd75…`. Resultado acumulado: **1/8 incrementos
verificados**.

W2 no entregó, y sus dos intentos dejaron defectos distintos de la política C:

- La factibilidad de hoja no medía volumen de producción:
  [`leaf-feasibility-ignored-production`](defects/leaf-feasibility-ignored-production/README.md).
  La cota agregada resultó **no discriminante** — W1 entregó con 10 planned
  paths y W2 falló con 6.
- Los dos términos que deciden un corte medían aristas y no estructura:
  [`cut-terms-measured-edges-not-structure`](defects/cut-terms-measured-edges-not-structure/README.md).
  Corregidos en `adaptive-utility/3.1.0-pilot`; no alcanzan para explicar el
  colapso de W2 y así queda declarado.

El reintento posterior tampoco ejecutó la hoja: un slot huérfano del pool
impidió crear el worktree y el sistema lo clasificó erróneamente como
`code_test`. Es una falla de recuperación de infraestructura, no evidencia para
ni contra la política C; véase
[`worktree-pool-orphan-recovery`](defects/worktree-pool-orphan-recovery/README.md).

Ninguna de las dos correcciones divide W2. El colapso de ese incremento sigue
**sin causa suficiente identificada**, y ése es el estado honesto del piloto.

## Grafos anchos — resultados y correcciones de validacion

El barrido ancho sobre la entrega verificada de W1 produjo evidencia real:
**N=4 y N=8 entregaron y pasaron su oráculo externo**; N=16 verificó sus 19
hojas y murió en la integración de la raíz.

De ese N=16 salieron un defecto de ownership, un diagnostico de seams que luego
debio corregirse, y un resultado adverso sobre la politica:

- [`seam-bindings-escape-cycle-detection`](defects/seam-bindings-escape-cycle-detection/README.md):
  la primera correccion agrego seams al DAG y contradijo A5. Los seams son
  compatibilidad no ordenante; la correccion posterior los saco de la
  adyacencia y conservo su validacion contractual.
- [`contested-planned-output`](defects/contested-planned-output/README.md):
  dieciséis hojas declararon el mismo archivo de test como output propio; el
  compilador modeló los 120 pares en conflicto y la revisión los aceptó como
  remedio suficiente.
- [`policy-c-refuses-a-clean-wide-cut`](defects/policy-c-refuses-a-clean-wide-cut/README.md):
  con el ciclo corregido, la política **sigue** sin aprobar por utilidad un
  fan-out de 19 módulos independientes (`splitAdvantage −0.0347`). El término
  que liga es `validationDuplication`. Queda abierto y sin tocar.

El N=16 también es la primera validación productiva del rediseño `3.1.0-pilot`:
ese fan-out medía **0** de paralelismo con la fórmula anterior y **0.8889** con
la nueva.
