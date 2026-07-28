# Issue tracker: Local Markdown

Engineering work for this repository is tracked as Markdown under `.scratch/`.
This keeps the thesis-closing backlog local and auditable; no GitHub issue or
push is required.

## Conventions

- One effort per directory: `.scratch/<effort-slug>/`.
- A specification, when needed, is `.scratch/<effort-slug>/spec.md`.
- Implementation issues are individual files under
  `.scratch/<effort-slug>/issues/<NN>-<slug>.md`.
- `Blocked by` declares the dependency edges. The working frontier is every
  open issue whose blockers are closed.
- `Status` uses the roles in `docs/agents/triage-labels.md`.
- Tickets produced by `to-tickets` are already agent-ready and do not pass
  through triage.

## Skill operations

When a skill says to publish an issue, create or update the corresponding local
Markdown file. When it says to fetch an issue, read that file in full. Never
publish these issues remotely unless Francisco explicitly changes this policy.
