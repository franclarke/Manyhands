# Execution bases, worktrees y git

## Objetivo

Garantizar que cada intento vea inputs exactos, que sus cambios puedan
inspeccionarse y descartarse y que el candidato adoptado sea reproducible.

## ExecutionBaseBuilder

Entradas:

- commit base inmutable del run o artifact del composite padre;
- baseline de contratos requerido;
- artifacts declarados por `ArtifactRequirement`;
- graph/contract revisions.

Salida:

```ts
type ExecutionBaseManifest = {
  commitSha: string;
  sourceCommits: string[];
  artifacts: { id: ArtifactId; digest: string }[];
  contractRevisions: Record<string, number>;
  compositionLog: CompositionStep[];
};
```

La composición deduplica ancestry, rechaza commits inalcanzables y registra
conflictos. No aplica todos los commits de predecessors por transitividad.

## Worktree lifecycle

1. crear worktree desde `ExecutionBaseManifest.commitSha`;
2. aplicar excludes de artefactos de build;
3. ejecutar provisioning declarado;
4. invocar agente bajo Process Supervisor;
5. calcular `git diff HEAD` y estado de commits;
6. aplicar scope y validación preliminar;
7. crear commit candidato por el orquestador;
8. validar el commit en otro sandbox limpio;
9. conservar o eliminar el worktree según política de evidencia.

## Propiedad de commits

El agente modifica archivos, no crea el commit adoptable. Si crea commits:

- se detecta comparando HEAD/base y reflog;
- la política default descarta el intento por violar el protocolo;
- una migración puede ofrecer compatibilidad explícita, nunca aceptación
  silenciosa.

## Fuente de cambios

`git diff` y el grafo de commits son autoridad. stdout/stderr son diagnóstico. Un
exit 0 con diff vacío puede ser resultado válido solo si el contrato permite una
tarea de análisis sin artifact de código; para una hoja de implementación es
`empty_candidate`.

## Limpieza y seguridad

- Paths se resuelven y verifican bajo la raíz esperada.
- Nunca se ejecuta delete recursivo sobre targets no validados.
- Worktrees y branches tienen IDs de run/attempt.
- Cleanup es idempotente y no elimina evidencia registrada.
- Artefactos ignorados no se staged, pero su existencia puede ser necesaria para
  validar.
