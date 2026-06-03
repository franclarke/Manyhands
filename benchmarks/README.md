# Benchmarks

Executable fixtures used by ManyHands as target repos for real agent runs.

| Fixture | Purpose |
|---------|---------|
| `expression-calculator/` | Pipeline `tokenize → parse → evaluate`. Showcases real interface seams (`Token`, `Ast`) between sibling leaves — the canonical fixture for the recursive interface-aware decomposer (thesis Artifact 1). |
| `task-manager-api/` | Express REST API with `PUT/DELETE` endpoints intentionally left as stubs. Used for smoke tests where the agent must complete the missing handlers. |

Each fixture is a standalone repo (own `package.json`, own tests). They are NOT pnpm workspace members — ManyHands provisions a per-run copy under `.manyhands/work/<runId>/repo/` and runs Gemini against it.
