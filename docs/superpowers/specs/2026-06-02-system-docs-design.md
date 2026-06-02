# System Documentation — Design Spec

**Date:** 2026-06-02  
**Status:** Approved

---

## Objetivo

Crear documentación de componentes del sistema en lenguaje natural (español, términos técnicos en inglés) para que cualquier persona nueva pueda entender cómo está diseñado ManyHands y cómo funciona cada pieza, sin tener que leer el código línea a línea.

---

## Estructura de archivos

```
docs/system/
  README.md              ← Overview: flujo completo del sistema, referencia a todos los componentes
  01-task-graph.md       ← TaskNode, TaskGraph, kinds, dependencias, validación, topo sort
  02-contracts.md        ← AgentTaskContract V1+V2, InterfaceContract, ExecutionScope, ValidationCommands
  03-decomposer.md       ← GeminiRecursiveDecomposer, rúbrica de atomicidad, sharedInterface, step-schema
  04-run-executor.md     ← RunExecutor como orquestador top-level, loop principal, batch coordination
  05-worktree-layer.md   ← WorktreeManager, SimpleGitRunner, git isolation, detección de commits
  06-gemini-executor.md  ← GeminiCliExecutor, invocación headless, approval modes, timeout, stdin
  07-context-and-scope.md← FileSystemContextPacker, ScopeChecker, construcción del prompt, deny wins
  08-result-pipeline.md  ← ResultRecorder, ValidationRunner, git diff como verdad, trace events
  09-composer.md         ← IntegrationAgent, cherry-pick, repair semántico contract-aware
  10-web-app.md          ← Command Center, Run workspace, DAG canvas, SSE, conexión al core
```

---

## Formato por archivo

**README.md (overview):**
- 600-900 palabras
- Describe el sistema de punta a punta con un flujo narrativo
- Incluye diagrama ASCII del pipeline completo
- Cada componente mencionado tiene un link al archivo de detalle correspondiente
- No entra en detalles internos — apunta hacia los otros archivos

**Archivos de componente (01-10):**
- 400-700 palabras cada uno
- Estructura fija:
  1. **Qué es** — una oración
  2. **Responsabilidad** — qué problema resuelve, por qué existe
  3. **Cómo funciona** — el mecanismo interno explicado en lenguaje natural
  4. **Interfaces** — qué recibe, qué produce, con qué otros componentes interactúa
  5. **Decisiones de diseño** — por qué se diseñó así (brevemente)
- Referencias cruzadas con `[→ nombre-de-componente](archivo.md)` cuando corresponda

---

## Tono y estilo

- Lenguaje natural, primera persona de la arquitectura ("el RunExecutor coordina...", "el ScopeChecker verifica...")
- Técnico pero accesible: explicar los conceptos antes de usar el término
- No repetir lo que ya está en `docs/DECISIONS.md` — apuntar a él para el "por qué"
- No duplicar la narrativa de `docs/thesis/project-evolution.md` — apuntar a ella para la historia

---

## Cobertura por archivo

| Archivo | Clases/conceptos principales |
|---------|----------------------------|
| README.md | Sistema completo, flujo narrativo |
| 01-task-graph | TaskNode, TaskGraph, NodeKind (root/integrator/leaf), graph.dependencies, topo sort |
| 02-contracts | AgentTaskContract, ExecutionScope, InterfaceContract, ValidationCommands |
| 03-decomposer | GeminiRecursiveDecomposer, step-schema (atomic/decompose), rúbrica atomicidad, sharedInterface |
| 04-run-executor | RunExecutor, flujo principal, error handling, state machine por hoja |
| 05-worktree-layer | WorktreeManager, SimpleGitRunner, worktree lifecycle, UnexpectedCommitPolicy |
| 06-gemini-executor | GeminiCliExecutor, MockAgentExecutor, AgentExecutor interface, stdin/stdout/stderr |
| 07-context-and-scope | FileSystemContextPacker, ScopeChecker, glob matching, deny wins |
| 08-result-pipeline | ResultRecorder, ValidationRunner, git diff → patch, trace events emitidos |
| 09-composer | IntegrationAgent, cherry-pick order, buildRepairPrompt con sharedInterface |
| 10-web-app | API routes, SSE streaming, RunGraphViewModel, DAG canvas, Command Center |
