# Etapa 0 — preflight del ejecutor y del servidor

Fecha: 2026-08-01  
Commit de referencia del checkout al iniciar: `b17e878c4c0a4488bbd8d9204b89c9b06a302f19`

## CLI de Codex

Verificación de versión:

```text
codex-cli 0.146.0
```

La invocación mínima se ejecutó en `C:\Users\franc\AppData\Local\Temp\manyhands-g6-codex-preflight-20260801`, fuera del repositorio, con:

```text
codex exec --ephemeral --skip-git-repo-check --sandbox read-only -m gpt-5.4-mini -c model_reasoning_effort="low" -C <directorio-temporal> "Reply exactly CODEX_PREFLIGHT_LOW_OK"
```

Resultado observable:

```text
OpenAI Codex v0.146.0
model: gpt-5.4-mini
provider: openai
approval: never
sandbox: read-only
reasoning effort: low
codex
CODEX_PREFLIGHT_LOW_OK
EXIT=0
```

La selección más barata conocida por el registro y elegida para G6 es:

```json
{
  "executorId": "codex-cli",
  "model": "gpt-5.4-mini",
  "effort": "low"
}
```

El registro declara `gpt-5.4-mini` habilitado para planning, execution y repair, y admite los esfuerzos `low`, `medium`, `high` y `xhigh`.

## Mutación autenticada del servidor

Se ejecutó previamente `pnpm build`, con resultado PASS. Después se levantó el servidor web en `http://127.0.0.1:3141` con un token de sesión explícito. El estado del servidor (`MANYHANDS_REPO_ROOT`) y los runs (`MANYHANDS_RUNS_DIR`) se ubicaron en:

```text
C:\Users\franc\AppData\Local\Temp\manyhands-g6-stage0-20260801\state
C:\Users\franc\AppData\Local\Temp\manyhands-g6-stage0-20260801\runs
```

El workspace objetivo fue un repositorio Git temporal, también fuera del checkout. La verificación produjo:

| Comprobación | Resultado |
|---|---|
| `GET /api/health` | HTTP 200 |
| `POST /api/workspaces` sin depender sólo de health | HTTP 201 |
| Autenticación | header `x-manyhands-session`, token correcto |
| Estado persistido | `state/.manyhands/workspaces.json` fuera del repositorio |
| Workspace creado | `85189cd5-1f65-4081-b62a-46558696114e` |
| Rama detectada del repo temporal | `main` |

El servidor de prueba se detuvo después de la verificación. El árbol de trabajo de ManyHands permaneció limpio.

## Decisión

Codex funciona headless en esta máquina y se selecciona `codex-cli / gpt-5.4-mini / low`. Conforme al plan, la celda G6 ejecutada con `claude-code-cli / sonnet` se conserva íntegra y pasa a ser piloto; no se descarta ni se reinterpreta.

## Qué no se concluye

Este preflight no mide capacidad de implementación, cobertura de criterios, granularidad, costo de una celda ni el veredicto de H-G6. Tampoco constituye una celda experimental ni valida que el ejecutor elegido pueda completar T1; eso corresponde a la etapa 2.
