# 05 — Los runs facturan contra la suscripción, no contra créditos de API

**What to build:** que la facturación de un run sea una decisión declarada y no
un accidente del entorno del servidor.

**Blocked by:** None.

**Status:** closed

## El estado verificado

Antes de cambiar nada, los hechos de esta máquina:

| | |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` | **sin definir** |
| `~/.claude/.credentials.json` | `claudeAiOauth`, `subscriptionType: pro` |
| `~/.codex/auth.json` | `auth_mode: chatgpt`, `OPENAI_API_KEY: null` |
| `apiKeyHelper` en settings | ausente |

**Los tres ensayos SP2 del 2026-08-07 ya facturaron contra la suscripción, en los
dos proveedores.** No se gastaron créditos de API.

## El defecto

`agent-env.ts` reenviaba `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` y `CODEX_API_KEY`
a todo ejecutor. Ambos CLIs **prefieren una key explícita** por encima de la
credencial de suscripción que ya tienen guardada. Así que el modo de facturación
no era una decisión: era una consecuencia de que el entorno del servidor
estuviera limpio. Una key definida para cualquier otra herramienta, heredada de
una shell, y todos los runs pasaban a créditos de API **sin ninguna señal en el
registro del run**.

Para una serie de medición que reporta costo, eso es además un problema de
evidencia: el número queda sin decir contra qué se facturó.

## Lo que se hizo

- El allowlist de credenciales queda **sólo con credenciales de suscripción**:
  `CLAUDE_CODE_OAUTH_TOKEN`, que es un token de suscripción de larga vida para
  uso headless, no una key metered. Las tres API keys salieron.
- `HOME` / `USERPROFILE` siguen pasando: ahí viven las credenciales de
  suscripción de los dos CLIs. Fijado con un test, porque es la mitad de la que
  depende que esto funcione.
- Facturar contra la API sigue siendo posible, pero hay que pedirlo: declarar la
  key **y** nombrarla en `MANYHANDS_AGENT_ENV_ALLOW`. El escape hatch del
  operador ya existía y es exactamente el opt-in; no hizo falta un segundo
  mecanismo.

## El defecto que el cambio iba a introducir

`defaultCredentialStatus` contaba `ANTHROPIC_API_KEY` como credencial suficiente
y **cortocircuitaba la verificación del token OAuth**. Con las keys ya no
reenviadas, una máquina con key definida y token vencido habría pasado el
preflight y después cada hoja habría dado 401 — el falso «listo» de F-001 que ese
módulo existe para evitar, reintroducido desde el otro lado.

El preflight ahora pregunta por la credencial que **el ejecutor va a recibir**,
no por la que el servidor tiene: `apiKeyReachesExecutor` aplica la misma regla de
allowlist. Los mensajes al operador dejaron de recomendar «configurá
ANTHROPIC_API_KEY» a secas, que lo habría mandado a configurar algo que el
subproceso nunca vería.

## Checklist

- [x] Regresión roja: hoy el ejecutor recibe una API key metered del entorno.
- [x] Sólo credenciales de suscripción en el allowlist por defecto.
- [x] `HOME`/`USERPROFILE` fijados con test.
- [x] Opt-in explícito verificado vía `MANYHANDS_AGENT_ENV_ALLOW`.
- [x] Regresión roja para el falso «listo» del preflight, y corregido.
- [x] Mensajes al operador alineados con la vía que de verdad funciona.
- [x] `docs/design/05-execution-core-and-sandboxing.md` actualizado.
