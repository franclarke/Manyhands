# Security boundary y threat model (B-006)

ManyHands es un producto **local-first**: un servidor Next que el operador
corre en su propia máquina contra repositorios en los que confía. Este
documento describe la frontera implementada y, con la misma claridad, lo que
**no** defiende.

## Qué protege la frontera

| Control | Implementación | Amenaza que cierra |
|---|---|---|
| Bind a loopback | `next dev/start -H 127.0.0.1` (scripts de `apps/web/package.json`) | Clientes remotos de la LAN no alcanzan el puerto. `dev:lan` existe como opt-in explícito. |
| Validación de Host | `middleware.ts` + `evaluateRequestBoundary` (`lib/server/security/boundary.ts`) | DNS rebinding: una página hostil que resuelve su dominio a 127.0.0.1 llega con su Host real y recibe 403. `MANYHANDS_ALLOWED_HOSTS` permite alias explícitos. |
| Validación de Origin | mismo evaluador | CSRF desde orígenes web: cualquier Origin no-loopback (incluido `"null"`) recibe 403 en toda la API. |
| Capability de sesión | token por boot (`MANYHANDS_SESSION_TOKEN` del launcher o aleatorio); cookie `mh_session` SameSite=Strict emitida al UI local; header `x-manyhands-session` para scripts | Mutaciones, SSE (`events`/`run-events`), terminal, `workspace-file`/`workspace-tree` y `export` exigen el token. Un GET de página hostil no puede exfiltrar ni operar. |
| Realpath containment | `resolveContainedWorkspaceFile` (CF-40) | Symlinks/junctions dentro del workspace que apuntan afuera: la file API responde 403 en lugar de leer/listar fuera del root. |
| Ownership de terminal | `getTerminalSessionForRun`/`closeTerminalSessionForRun` (CF-41) | Un terminal id solo es capability bajo su propio run; cross-run responde 404. |
| Env allowlist | `buildAgentEnvironment` (CF-28) aplicado a executors, decomposers/titler (spawn supervisado), y terminales | Agentes y shells no heredan el entorno completo del servidor: sobrevive el allowlist de sistema (PATH, temp, HOME/APPDATA, locale), credenciales de provider **declaradas** (solo agentes; `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) y lo que el operador permita vía `MANYHANDS_AGENT_ENV_ALLOW`. |

## Qué NO protege (threat model honesto)

1. **Atacante local con el mismo usuario del OS.** Puede leer los archivos de
   runs, el token de sesión del proceso y matar/lanzar procesos. Ninguna
   frontera HTTP defiende contra eso; está fuera del modelo.
2. **Código hostil ejecutado por los agentes.** Los agentes conservan shell,
   filesystem y red como el usuario local. El aislamiento de ManyHands es de
   *cambios git* (worktrees + ScopeChecker) y de *reducción de secretos*
   (allowlist), **no** un sandbox. Repos no confiables requieren un boundary
   adicional (VM/container/usuario dedicado) — decisión de producto futura.
3. **HOME/APPDATA visibles.** Los CLIs (Claude Code, Codex) requieren sus
   stores de auth (`~/.claude`, `~/.codex`), por lo que el HOME del usuario es
   visible para los agentes. Secretos fuera de variables de entorno (archivos
   en el HOME) siguen alcanzables por un agente malicioso.
4. **`node_modules` compartido escribible** entre worktrees (CF-27) se cierra
   recién en B-023 (Phase 3).
5. **LAN/remoto no soportado.** No hay auth multiusuario ni TLS. `dev:lan` y
   `MANYHANDS_ALLOWED_HOSTS` existen para redes en las que el operador confía
   plenamente, bajo su responsabilidad.

## Operación

- El launcher (`pnpm dev`) genera `MANYHANDS_SESSION_TOKEN` si no existe y lo
  comparte con el servidor y su propio monitor. Para scripts headless:
  `curl -H "x-manyhands-session: $MANYHANDS_SESSION_TOKEN" …`.
- Con `next dev` a mano (sin launcher), el token es aleatorio por boot y el UI
  lo recibe por cookie en el primer page load; los scripts deben exportar
  `MANYHANDS_SESSION_TOKEN` antes de arrancar el servidor para conocerlo.
