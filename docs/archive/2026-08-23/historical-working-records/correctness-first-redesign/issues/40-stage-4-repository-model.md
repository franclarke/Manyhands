# CF-040 — Stage 4: Repository Model, views, and Resource Catalog

- **Status:** `ready-for-agent`
- **Blocked by:** CF-030
- **Gate:** GRepo

## Outcome

Build exact, evidence-bearing repository models, immutable overlay views,
budgeted queries, and view-scoped canonical resource identity with
alias/containment and tri-state overlap.

## Mandatory first action

Inspect `packages/repository-index`, planner scans, cache identity, supported
languages, Git edge cases, and current fixtures. Split base model, overlays,
catalog, query budget/context packs, generated/gitlink policy, and real-repo
gate evaluation.

## Acceptance

- Identical base/overlays/budget yield identical model/view/catalog digest and
  query answers.
- Coverage and unknown/partial/conflicting epistemics remain explicit.
- Rename aliases, containment, generated files, symlinks, gitlinks, and changed
  overlays have deterministic outcomes.
- Unknown write overlap fails closed and every planner claim has provenance.

## Retirement

Remove each ad hoc planner scan only after its query replacement is productive
and reachability is proven.
