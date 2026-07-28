# Protocolo longitudinal Warehouse

Estado: **pre-registrado antes de W1 Pilot**.

## Pregunta

¿Cómo cambia la frontera elegida por C a medida que un mismo producto crece
desde un seed técnico hasta un control tower con dominio, interfaces,
simulación, persistencia y analítica?

## Unidades y cadena

- Unidad longitudinal: un incremento W1–W8.
- Base W1: commit exacto del seed registrado en `seed-manifest.json`.
- Base Wn: commit entregado por W(n-1) y aprobado sólo después de su oráculo.
- Planner: vivo en cada incremento; no se reutilizan candidate trees.
- Condición: C durante Pilot y Warehouse Final longitudinal.
- Executor, modelo y effort: Codex CLI `gpt-5.5` con `high`, idéntico en
  planning, ejecución y repair. La selección efectiva vive en
  `lib/warehouse-longitudinal.mjs`.

Executor selection (machine-readable): {"executorId":"codex-cli","model":"gpt-5.5","effort":"high"}

### Reversión del executor antes del freeze

El 2026-07-26 el protocolo revirtió su selección formativa anterior a Codex
`gpt-5.5` con `high`. La capacidad resultó ser la restricción dominante: el
executor anterior compartía cuota con la sesión interactiva y no podía sostener
la duración de un incremento. Desde el 2026-07-28, además, Codex es el único
executor instalado y autorizado en la máquina del estudio.

La reversión tiene una consecuencia que se preserva como límite de la evidencia:
Codex declara `usageSource: "unavailable"`, por lo que se informan los tokens
como piso y el costo no medible. No se imputan valores faltantes. Obtener costo
medido exigiría otro executor y repetir la serie completa bajo un freeze nuevo;
nunca se mezclan sus células con esta serie.

## Separación de fases

Pilot permite corregir ManyHands, C, prompts y oráculos. Cada cambio queda en
el ledger y los resultados Pilot son formativos. Después del freeze no cambia
ManyHands, la política, el modelo, los prompts, los oráculos ni el seed. Un
defecto conductual de ManyHands durante Final invalida y reinicia toda la serie
Final; no se mezclan versiones.

## Estímulo y aceptación

Los prompts versionados `W1.md`…`W8.md` son acumulativos y autocontenidos. Cada
entrega debe exponer `pnpm study:probe -- --increment Wn --scenario
thesis-seed-2026 --format json`. La sonda es una interfaz pública de estudio y
debe invocar el mismo dominio, estado y adaptadores productivos: no puede usar
fixtures, respuestas hardcodeadas ni una implementación paralela.

La salida estándar de la sonda contiene únicamente JSON con la envoltura
`{ schemaVersion, increment, scenario, stateHash, capabilities }`. Los prompts
fijan en cada incremento los nombres, tipos y mínimos acumulativos exactos. El
`stateHash` usa el formato `sha256:` seguido por 64 dígitos hexadecimales
minúsculos. Esta forma es parte del estímulo público, no conocimiento oculto del
oráculo.

El oráculo vive fuera del target, verifica su propio hash, ejecuta `pnpm test`,
`pnpm typecheck`, `pnpm build`, invoca dos veces la sonda y comprueba
determinismo más invariantes acumulativos. Las capturas visuales son evidencia
complementaria; nunca reemplazan el oráculo.

## Regla de avance

Un incremento avanza sólo si: lifecycle `completed`, receipt confirmado,
matriz ManyHands verificada, clon limpio instalable, oráculo externo PASS y
commit entregado igual al auditado. Un fallo conserva tiempo/tokens y detiene la
cadena; no se adopta manualmente un diff parcial.

## Variables registradas

Por incremento: commit base/final, lifecycle, reloj, tokens incluidos los runs
fallidos, attempts, repairs, candidate tree hash, frontera, profundidad, hojas,
features/beneficio/costo C, criterios externos satisfechos, diff y defectos.

## Falsadores

- evidencia faltante o hash no coincidente;
- sonda no determinista para el seed fijado;
- resultado que sólo pasa tests internos pero falla el oráculo externo;
- cambio de ManyHands o de un asset durante Final;
- base de un incremento distinta de la entrega verificada anterior.
