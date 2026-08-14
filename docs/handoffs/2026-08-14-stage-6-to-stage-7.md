# Handoff operativo — Stage 6 cerrado, Stage 7 preparada

## Estado de entrada

- **Branch:** codex/correctness-first-full-implementation
- **Stage 6 / GS:** pass
- **Accepted code candidate:** 02f05e4cc320a11a0a1c762e2a2faa04d4bc1af0
- **Accepted tree:** 02c14934156ec6c1d76545952ff75e582ec05367
- **Documentation HEAD:** 945786e9ea2060c34230d8581925e6aa1a01a7cf
- **Audit:** [Stage 6](../audits/stage-6/README.md)
- **Stage 7 / GA:** not_started

## Ruta que Stage 7 debe reemplazar

La planificación, el grafo y la frontier productivas ya son canónicas. El executor sigue siendo transicional en una frontera concreta:

- V2NodeExecutor informa artifacts con kind commit, location y, a veces, cherryPickMainline;
- ArtifactMaterializer sólo acepta ese tipo y usa GitRunner.cherryPick;
- ExecutionBaseBuilder hereda esa materialización;
- ExactCandidateValidatorV2 y EvidenceMatrix aportan una base útil, pero la evidencia aún se liga principalmente a un commit, no a un manifest/tree, receta, entorno y autoridad completos.

Los contratos iniciales ya existen en packages/contracts, packages/run-coordinator y packages/run-store; Stage 7 los profundiza y conecta, sin crear representaciones paralelas.

## Primera slice al iniciar Stage 7

1. Leer el [plan de implementación](../plans/2026-08-14-stage-7-git-native-artifacts-and-exact-validation.md), plan canónico, audit Stage 6, PRODUCT.md, AGENTS.md y source actual.
2. Confirmar Git root, branch, HEAD, tree, git status --short y git diff HEAD. Preservar todo cambio ajeno; nunca usar stash, reset o clean.
3. Crear una RED productiva: daemon/canonical driver no puede producir commit artifacts ni invocar cherry-pick para inputs.
4. Empezar por identidad immutable de attempt y manifests retenidos; no tocar sandbox, modelos live, experimento, tesis, ni integración de Stage 9.

## Límites

- Materialización Git-native exacta y fail-closed: OIDs, modos, deletes, binaries, symlinks, gitlinks, preimages, scope y árbol resultante.
- Git policy bloquea hooks, filters, attributes, config/credential helpers y submodule/network implícitos.
- Un oráculo requerido ausente da needs_input; el modelo no lo sustituye.
- Human review se ata a candidate/tree y rubric exactos; un candidato nuevo lo invalida.
- Readers V2 sólo históricos mientras replay lo requiera; la ruta productiva debe tener reachability cero.

Este handoff no inicia Stage 7 ni Stage 8; no ejecuta modelos live, experimento o tesis.

