# 01 — El ejecutor corre con configuración controlada

**What to build:** un leaf sólo escribe lo que su contrato pide. Hoy el CLI
ejecutor carga la configuración personal del operador —skills, `CLAUDE.md`
global, hooks— y esa configuración puede escribir archivos dentro del worktree.

**Blocked by:** None — can start immediately.

**Status:** closed

## La observación

Pasada 3 del ensayo (`dbb427ca`). La hoja de aplicación fue rechazada por scope.
El trace `scope_check_failed` nombra la ruta:

```
docs/superpowers/plans/2026-08-07-application-backorder-event-flow.md
```

No es trabajo del leaf. Es un documento de plan que escribió una skill global del
operador, cargada por el CLI porque `buildAgentEnvironment` pasa `HOME` /
`USERPROFILE` a propósito —ahí vive el estado de autenticación de `~/.claude`—
y ese mismo directorio trae además comportamiento.

El comentario de `agent-env.ts` es honesto sobre lo que hace: «esto es
*reducción* de secretos, no un sandbox». La reducción de secretos está bien
resuelta. Lo que no está resuelto es la **reducción de comportamiento**.

## Por qué bloquea el congelamiento

La máquina del operador es hoy una variable no controlada dentro de cada celda.
Puede cambiar entre la celda 1 y la 2 —instalar una skill, editar el `CLAUDE.md`
global— y eso es exactamente lo que un congelamiento existe para impedir. Peor:
su efecto se registra como violación de scope, o sea **atribuido al sistema bajo
prueba**. Una celda adversa sería inexplicable, y una celda que pasa lo haría con
un ejecutor que nadie puede reproducir.

## Diseño

El CLI expone el lever exacto: `--setting-sources <user,project,local>`. Excluir
`user` deja fuera `~/.claude` —skills, `CLAUDE.md` global, hooks, settings—
sin tocar el binario ni las credenciales.

Alternativas descartadas y por qué:

- **Agregar la ruta a `DEFAULT_ARTIFACT_GLOBS`.** El conjunto de emisores no está
  acotado y cambia con la configuración del operador. Sería una denylist que
  crece con cada celda fallida, que es la forma de no cerrar nunca el problema.
- **`--bare`.** Apaga más de lo necesario y, según su propia descripción, cambia
  la autenticación a `ANTHROPIC_API_KEY` estricto, lo que rompería un setup
  OAuth. Demasiado colateral para lo que hace falta.
- **`--disable-slash-commands`.** Apaga las skills pero no el `CLAUDE.md` global
  ni los hooks. Cierra un vector de tres.

`--setting-sources` es lo más chico que cierra los tres vectores a la vez.

**A verificar empíricamente antes de darlo por bueno, no asumir:** que excluir
`user` no rompe la autenticación. La descripción de `--bare` sugiere que es *él*
quien fuerza `ANTHROPIC_API_KEY`, no `--setting-sources`, pero eso es lectura de
un `--help`, no evidencia. Se comprueba con un run real antes de cerrar el
ticket.

**Esa verificación ahora es sobre facturación, no sólo sobre que autentique.**
Las credenciales de suscripción viven en `~/.claude/.credentials.json`
(`subscriptionType: pro`) y `~/.codex/auth.json` (`auth_mode: chatgpt`), o sea
**dentro de `HOME`**, que el allowlist de entorno sigue pasando. Son archivos de
credenciales, no una *setting source*, así que excluir `user` no debería tocarlas
— pero si lo hiciera, el CLI caería a otra vía de auth y el run pasaría a
facturar contra la API. Un `--setting-sources` que aísle el comportamiento y de
paso cambie la facturación sería peor que el problema que resuelve.

Esto refuerza el descarte de `--bare`: su propia descripción dice que la
autenticación pasa a ser `ANTHROPIC_API_KEY` estricto, o sea créditos de API.
Queda descartado por dos razones independientes.

**Nota sobre Codex:** su perfil ya pasa `--ignore-user-config` y `--ephemeral`,
así que el aislamiento de comportamiento que este ticket pide **ya está resuelto
de ese lado**. El precedente está en el mismo repositorio; el que falta es
`claude-code`.

La configuración efectiva del ejecutor —flags exactas incluidas— pasa a formar
parte del freeze. Un ejecutor no registrado hace irreproducible la celda aunque
esté aislado.

## Checklist

- [x] Regresión roja: el perfil de `claude-code-cli` construye sus argumentos sin
      ninguna restricción de fuentes de configuración. El test falla por eso, no
      por otra cosa.
- [x] `buildClaudeCodeArgs` pasa `--setting-sources` excluyendo `user`.
- [x] Verificado con un run real que el ejecutor sigue autenticando. Si no,
      documentar la interacción y elegir la alternativa mínima siguiente.
- [x] Verificado contra el caso observado: un leaf equivalente ya no escribe
      `docs/superpowers/**` ni ningún otro archivo fuera de su contrato.
- [x] La configuración efectiva del ejecutor queda registrada en el freeze y en
      la pre-registración.
- [x] `agent-env.ts` documenta que la reducción de comportamiento vive en las
      flags del perfil, no en el allowlist de variables — para que el próximo
      lector no busque donde no está.

## Cierre verificado

La regresión de argumentos y el aislamiento de entorno quedan cubiertos por
los tests del perfil y de `agent-env`. El 2026-08-09 se ejecutó Claude Code en
un repositorio descartable con `--setting-sources project,local`, sin API keys
en el entorno y con un contrato de escritura de un solo archivo. El CLI
autenticó y escribió únicamente `probe.txt`; no apareció `docs/superpowers/**`
ni ningún otro archivo inesperado. La evidencia completa está en
[`claude-config-check.json`](../claude-config-check.json).
