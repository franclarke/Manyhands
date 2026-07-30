# Informe final de cierre — 2026-07-30

Informe exigido por `AUTONOMOUS_CLOSURE_PLAN.md` §9. Cada conclusión referencia
una prueba, un commit, un artefacto o una limitación declarada.

## 1. Estado de tickets y fases

Los 26 tickets locales de `.scratch/code-review-remediation/issues/` están
`closed`. Los cerrados en esta sesión:

| Ticket | Resultado |
|---|---|
| 11 — completar el barrido | `closed` por evidencia preservada de `retry-10` y `retry-11`. Ninguna celda entregó. |
| 12 — veredicto sobre `validationDuplication` | `closed` con veredicto explícito: sostiene la lectura (1). |
| 02 — replay C1 honesto | `closed` con rechazo explícito y retiro de la reachability legacy. |
| 14 — rederivar la matriz de claims | `closed`; sólo CLAIM-020 y CLAIM-021 suben. |
| 15 — tesis escrita y verificable | `closed`; PDFs compilados y revisados. |

Alcance retirado por decisión de Francisco el 2026-07-30: la serie compacta
WC1–WC3 sale del mínimo, y no se persigue otra entrega ancha verificada.

## 2. Decisiones y causas raíz

- **Doce tests rojos heredados.** Los tickets 23–26 se cerraron sin correr la
  suite completa en su commit. Causas raíz: (a) `decision.raised` parkeaba el run
  entero, contra el modelo de decisiones locales no bloqueantes; (b) al quitar esa
  transición apareció un dead-end de scheduling que ella tapaba; (c) el chequeo de
  idempotencia de hechos derivados comparaba input crudo contra evento
  normalizado por schema, y un default (`matrix.observations: []`) hacía ver una
  re-derivación idéntica como conflictiva. Corregidos con TDD en `5c48aba`.
- **Celdas de `retry-11` sin resultado atribuible.** El proceso dueño murió
  abruptamente: el heartbeat de 4 s se corta un intervalo después del último y ni
  `catch` ni `finally` corrieron. **La causa de la muerte no está registrada** y
  el documento lo declara en vez de conjeturar
  (`pilot/defects/run-owner-death-leaves-cell-unattributable/`).
- **Código de salida de celda reemplazado por un abort de libuv.** `process.exit()`
  con sockets cerrándose abortaba el driver en Windows y sustituía el código de
  salida por `0xC0000409`. Corregido; documentado en
  `pilot/defects/cell-exit-code-replaced-by-libuv-abort/`.
- **N=16 de la serie de medición sin evaluación.** El planner falló con salida no
  cero y el host no conserva la salida del CLI, así que el fallo no es
  atribuible (`pilot/defects/planning-failure-discards-cli-output/`). No se
  reintentó: el protocolo congelado admite un intento por celda.
- **Elección de salida para C1.** Replay fiel no era reconstruible, así que se
  eligió rechazo explícito y se retiró el código muerto que fingía conservarlo.

## 3. Commits locales

Once commits sobre `main`, todos locales:

```
9e42b72 evidence(thesis): preserve retry-11 adverse wide-graph series
824a5b6 docs(thesis): record 23-26 closure, retry-11 and the minimal scope
6738005 docs(evidence): record the unattributable cell stall of retry-11
1835fe8 feat(evidence): add a planning-only measurement series for H1
0c61dd2 freeze(evidence): add the retry-12 planning-only measurement cells
5c48aba fix(runtime): keep a raised decision from blocking the whole run
b3b0b9f freeze(evidence): pin the retry-12 measurement series
ac8e176 evidence(thesis): settle validationDuplication with the retry-12 measurement
12ab339 fix(granularity): refuse to replay historical C1 and C2 records
f6e0c79 docs(thesis): rederive the claim matrix from closed evidence
a430a57 docs(thesis): report the Warehouse line in the manuscript
```

## 4. Comandos y resultados del gate final

Sobre `a430a57`, árbol limpio, Node `v22.23.1` y pnpm `7.29.3`:

| Comando | Resultado |
|---|---|
| `pnpm test` | **PASS** — 220 archivos, 1534 passed, 2 skipped, 0 failed |
| `pnpm -r --filter "./packages/*" typecheck` | PASS |
| `pnpm --filter @manyhands/web exec tsc --noEmit` | PASS |
| `pnpm build` | PASS |
| `pnpm web:build` | PASS |
| `git diff --check` | exit 0 |

Logs durables junto al clon de ejecución en
`C:\Users\franc\Documents\Proyectos\manyhands-r12-runtime\final-gate-*.log`.

Resultado adverso preservado del gate anterior (freeze `5c48aba`): el
microbenchmark de caché del indexer falló bajo contención paralela con
30,11 ms contra una cota de 25 ms, y pasó con el archivo aislado. **La cota no se
movió.** En el gate final el mismo caso pasó dentro de la suite completa; ambos
resultados quedan registrados.

## 5. Runs, ejecutores, modelos y SHAs

| Serie | Freeze | Ejecutor | Celdas | Resultado |
|---|---|---|---|---|
| `retry-11` | `4f64258` | `codex-cli/gpt-5.5/high` | 4, 8, 16 | 3× `not_delivered`; N=16 sin plan |
| `retry-12-measure` | `5c48aba` | `claude-code-cli/haiku` | 4, 8, 16 | 2 medidas, 1 sin medición |

- Base W1 verificada: `71f61c9efa222103ca2fb2f67692434ab493d75c`, tree
  `f1592137`.
- **Cero receipts nuevos.** Ninguna celda produjo commit candidato ni entrega, de
  modo que **ningún oráculo externo se ejecutó**; las seis disposiciones son
  `not_run`.
- Runs de la serie de medición: `1664d097` (N=4), `4ba80bca` (N=8), `6e1e5ed3`
  (N=16, planning fallido). Journals en
  `docs/tesis/evidence/warehouse/wide-graph/retry-12-measure/`.
- Mutación autenticada verificada antes de medir: `POST /api/workspaces` → 201,
  workspace `1961d676` con la identidad física del clon objetivo.

## 6. Veredictos

**H1 — calidad de la política C: sostenido, con límite declarado.**
Con las intenciones de aceptación particionadas por hoja, y sin tocar término,
fórmula ni umbral, `validationDuplication` cae de 0,7333 a 0,3750 (N=4) y de
0,8500 a 0,4828 (N=8), y `splitAdvantage` pasa a +0,1710 y +0,3275. El caso N=4
es el único de las dieciocho evaluaciones de raíz preservadas cuya razón
registrada es la utilidad. La lectura sostenida es (1): el término mide lo que
declara medir, y lo que producía el rechazo era el planificador adhiriendo
criterios de objetivo completo a las hojas.

**H2 — arquitectura de grafos a escala: no sostenido.**
Nueve celdas de grafo ancho en tres series congeladas terminaron sin commit
candidato ni comprobante. La cadena longitudinal quedó en 1/8: W1 es la única
entrega externamente verificada. Cada causa terminal está documentada y ninguna
es una decisión de granularidad, pero eso acota el resultado sin revertirlo.

## 7. Tesis, presentación y PDFs

- `docs/tesis/main.pdf` — 47 páginas, compilado desde limpio, sin errores, sin
  referencias indefinidas y sin citas rotas. Incorpora la sección 7.7 con toda la
  línea Warehouse.
- `docs/tesis/presentacion.pdf` — 30 páginas, mismas condiciones, con dos
  diapositivas nuevas y notas de orador que anticipan las preguntas incómodas.
- Revisión visual de las páginas nuevas de ambos PDFs.
- Dos corrupciones de archivo reparadas: cinco `\textbf` como tabulador +
  `extbf`, y un `\ref` como retorno de carro + `ef` que imprimía
  «efsec:defecto-medicion».

## 8. Limitaciones reales

1. **El caso motivador nunca fue re-medido a su propia anchura.** El rechazo
   original ocurrió sobre 19 hijos; el veredicto se apoya en árboles de 7 y 11
   hojas.
2. **La serie de medición no es comparable** con ninguna serie Codex: el ejecutor
   es el Architect, así que cambiarlo cambia el árbol candidato. No eleva ni
   corrige ningún resultado anterior.
3. **Nada obliga a un Architect a particionar las intenciones.** Dos ejecutores
   produjeron reparticiones distintas sobre el mismo estímulo; esa variabilidad
   sigue sin control.
4. **Ninguna serie ancha entregó**, de modo que los claims end-to-end
   (CLAIM-040/041/042/043/044/052/053) no suben.
5. **`minimumAdvantage` y `maxLeafPlannedPaths` siguen provisionales.** Ninguna
   evidencia de este trabajo los deriva.
6. **La causa de la muerte del proceso dueño en `retry-11` no es atribuible**, ni
   la del fallo de planning en N=16 de la serie de medición.
7. Codex sigue inutilizable en esta máquina: su sandbox no puede lanzar el
   helper de setup.

## 9. Push

**No se hizo push.** Los once commits son locales sobre `main`; `origin/main`
permanece en `c501c7e` y es ancestro de HEAD. No se ejecutó `reset`, `clean`,
checkout destructivo ni `stash` global, y no se borró ningún pool, worktree,
clon, journal ni artefacto.
