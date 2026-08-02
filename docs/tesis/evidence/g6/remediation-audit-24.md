# G6 rem24 — auditoría de causa raíz y remediación

Fecha: 2026-08-02
Celda: `g6-03-T1-B-r1`
Run: `9e0da089-ff62-4073-b366-d354cce99cf3`
Plan: `8b833f54-4ebc-42c5-8c98-d156c65e15cd`

## Resultado observado

El planner produjo un plan válido y la celda fue aprobada sin responder
aclaraciones. En ejecución, seis hojas de implementación y la sonda produjeron
candidatos y fueron adoptadas. La hoja API (`node-api-backorders-surface-3cf726f97e`)
agotó exactamente su timeout de 1.800.000 ms. El journal registró
`failure.classified`/`attempt.failed` con `timedOut: true`, costo reportado de
USD 0,351855 y una decisión `resolve_conflict`; como el presupuesto de retry era
0, el integrador quedó sin el artefacto API y el run terminó observado como
`waiting_for_input`, sin entrega ni oracle.

La salida del agente contenía un diff y un resumen que afirmaba que `pnpm build`
y `pnpm test` habían pasado, pero el proceso no cerró antes del hard timeout.
Por la regla de evidencia, ese texto no se convirtió en candidato ni se tomó
como verificación independiente.

## Causa raíz investigada

El ejecutor ya usaba el binario standalone de Codex y `--ephemeral`, pero no
aislaba la configuración global del usuario. La invocación real no incluía
`--ignore-user-config`; por tanto, Codex cargaba `C:\Users\franc\.codex\config.toml`,
que habilita múltiples plugins MCP, `node_repl` y un hook `turn-ended`.

En el árbol de procesos observado durante el timeout aparecían el Codex de la
hoja y un `node_repl.exe` descendiente. La misma clase de timeout ya se había
observado en hojas API anteriores. La evidencia permite atribuir la demora a
una fuga de configuración/procesos auxiliares del entorno de ejecución, no a
un cambio del estímulo ni del oracle; no permite afirmar todavía que toda
demora futura de Codex tenga esa única causa.

## Fix aplicado con TDD

Primero se agregó la expectativa de `--ignore-user-config` a las regresiones de
argv y se ejecutó la verificación: fallaron 3 tests por la razón correcta
porque ninguna de las dos invocaciones lo incluía.

Luego se agregó el flag a:

- `packages/execution-core/src/executor/profiles/codex.ts`, para ejecución;
- `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`, para planning.

Verificación posterior:

- `pnpm build`: pasó en 74,2 s;
- `pnpm test -- tests/execution-core-codex-cli.test.ts tests/planning-cli-invocation.test.ts`:
  8/8 tests pasaron;
- canario externo a G6, misma binaria standalone y modelo `gpt-5.4-mini`, con
  `--ephemeral --ignore-user-config`: exit 0 y stdout exacto `OK`; no apareció
  ningún nuevo proceso `codex.exe`/`node_repl.exe` al terminar.

El servidor fue reiniciado con el build nuevo y la misma configuración de
modelo/protocolo. La celda será reintentada en un nuevo directorio de
remediación; el run original y sus artefactos permanecen intactos.

## Qué no se concluye

- No se concluye que la API haya sido implementada correctamente en rem24.
- No se concluye que rem24 sea PASS ni que la hipótesis de granularidad haya
  sido confirmada o falsada por esta celda detenida.
- No se reutiliza el diff producido por el proceso que agotó el timeout como
  candidato o como oracle.
- No se concluye que `--ignore-user-config` garantice por sí solo una pasada
  completa; la nueva celda debe demostrarlo en el camino real.
