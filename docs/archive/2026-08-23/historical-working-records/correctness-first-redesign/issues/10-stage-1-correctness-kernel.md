# CF-010 — Stage 1: canonical correctness kernel

- **Status:** `closed`
- **Blocked by:** CF-005
- **Gate:** G1
- **Required cell:** R5 at G1 where applicable; GP0 completes its planner path

## Outcome

Introduce the single versioned vocabulary for goal/proof, plans/graphs,
repository views, resource/lease claims, artifact/seam requirements, immutable
manifests, fingerprints, validation obligations, and evidence bindings without
changing the live route.

## Mandatory first action

Reinspect current contracts and consumers, then split this envelope into
disjoint TDD tickets for contract shapes, pure invariants, persistence-boundary
readers, and dependency/reachability guards. Name every compatibility consumer
and its Stage 11 retirement; prohibit new legacy producers.

## Acceptance

- Deterministic round trips and canonical digests pass.
- Double writers, illegal version chains, cycles, mutable manifest identity,
  stale evidence, contradictions, and unsupported proof authority fail for the
  intended reason.
- Required criteria without accepted authority cannot be approved.
- Dependency direction remains valid and no package adds legacy core coupling.
- Full affected checks and `pnpm test` pass on the reviewed candidate.

## Retirement

New legacy contract producers are unreachable. Close only after independent G1
review and required evidence is linked from the transition ledger.
