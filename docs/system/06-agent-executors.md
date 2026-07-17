# AgentExecutor y Process Supervisor

## Seam

```ts
interface AgentExecutor {
  execute(input: AgentExecutionInput, signal: AbortSignal):
    Promise<AgentExecutionDiagnostics>;
}
```

El resultado contiene exit code, timings, stdout/stderr refs y metadatos del
provider. No contiene la lista autoritativa de archivos cambiados ni decide
success.

## Entrada

- goal y acceptance criteria;
- consumed/produced contracts;
- artifact requirements ya materializados;
- scope y restricciones;
- repository context relevante;
- baseline/diagnóstico cuando es repair;
- instrucciones explícitas de no commit.

El prompt se deriva del contrato versionado y registra digest/version. No se
reconstruye de texto histórico ambiguo.

## Perfiles

Claude Code CLI puede seguir como default actual y Codex CLI como alternativa,
pero la arquitectura no depende de esos nombres. Cada perfil declara
capabilities, límites, comandos, modelos, timeout y política de sandbox.

Un perfil no disponible falla de forma explícita. No se cambia de executor en
silencio porque alteraría el fingerprint y la reproducibilidad.

## Process Supervisor

- registra PID/tree y attemptId;
- propaga abort y mata descendientes;
- distingue timeout, cancel, missing binary y exit failure;
- confirma `allDead` antes de completar cancelación;
- no permite que un callback tardío persista con fencing vencido.

## Reparación local

Para `code_or_test_failure`, el mismo worktree puede recibir un segundo prompt
con diagnóstico y Evidence Matrix fallida. Es una nueva fase del mismo intento o
un attempt hijo explícito, según el modelo elegido; nunca borra la primera
evidencia. El presupuesto objetivo es una reparación antes de reclasificar.

## Seguridad de comandos

Los comandos del agente no se usan como validation recipe confiable. Los
comandos de validación provienen del compiler/validator, pasan allowlist de
caracteres/estructura y corren con timeout en el entorno declarado.
