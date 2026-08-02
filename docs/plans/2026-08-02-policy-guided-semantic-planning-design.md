# Policy-guided semantic planning

## Status

Approved for implementation on 2026-08-02. This is a product-engineering
successor to G6. It does not alter the preregistration, raw runs, oracle, or
reported G6 result.

## Problem

The productive flow currently asks the model for one semantic
`WorkBreakdown`, then lets the deterministic granularity policy retain or
collapse cuts from that one proposal. The policy cannot request competing
semantic alternatives before the proposal is formed. It also propagates every
ancestor acceptance intent into every selected leaf. Although the contract
compiler later allocates each intent once, that propagation destroys the
planner's original local-versus-integration ownership signal and can move local
criteria to the lowest common ancestor.

The utility formula consequently ranks structural convenience inside a single,
potentially weak proposal. Compiler findings arrive after selection, so a plan
can look attractive because of context relief and parallelism before its seams,
materialization, acceptance ownership, or validation surface are shown to be
executable.

## Design

Planning becomes a bounded four-step decision:

1. A deterministic `GranularityPlanningBrief` is built from the inspected
   repository and the versioned utility-policy limits. It tells the semantic
   planner the leaf budgets, acceptance-ownership rules, relation rules, hard
   gates, and requested candidate count before the model proposes a tree.
2. The planner requests up to three independently named semantic candidates.
   Candidate requests include prior hashes so the model is asked for a genuine
   alternative rather than a path-level reshuffle. Duplicate valid outputs are
   deduplicated. Historical/experimental replay still consumes exactly its
   frozen candidate.
3. Every candidate is checked before ranking. Deterministic semantic gates
   reject missing or ambiguous acceptance ownership and a seam that claims its
   consumers require producer files without a materialized artifact for every
   consumer. The existing strategy selector then chooses a frontier, and the
   real Graph Compiler validates that selected frontier. Compiler failure makes
   the candidate ineligible; it is not averaged into a utility score.
4. The candidate selector ranks only eligible compilations. It uses the
   existing strategy assessments and leaves the G6 formula and
   `minimumAdvantage` unchanged. Selection and rejection evidence are persisted
   with the existing granularity strategy event and diagnostic artifact.

If no candidate is viable, productive planning performs one bounded semantic
replan with the concrete gate/compiler findings. It never partitions paths
mechanically. If that replan also has no viable candidate, planning fails with
the preserved reasons.

## Acceptance ownership

`acceptanceIntentIds` remain the canonical references; no parallel contract
model is introduced. Ownership is derived without mutation:

- one deepest leaf reference is leaf acceptance;
- references spanning exactly the participants of a declared seam are seam
  acceptance, owned by their lowest common integration ancestor;
- one deepest composite reference is global/integration acceptance;
- multi-branch references that match no seam are ambiguous and fail a hard
  gate.

The selector no longer copies ancestor intent IDs into descendants. A collapsed
frontier naturally owns the union of its descendants' intents. Every executable
unit still receives a local observable-outcome criterion when it owns no user
intent, preserving independent validation without duplicating the user's global
criterion.

## Compatibility and limits

`CandidateSeam.delivery` distinguishes `contract_only` from `producer_files`.
It defaults to `contract_only` when reading historical breakdowns, while new
planner prompts require it explicitly. An optional `planCandidates` dependency
keeps non-productive test adapters and approval paths compatible; the real V2
planning host provides the multi-candidate implementation.

The gates can verify declared dependencies and repository/compiler facts. They
cannot prove that the model disclosed every latent semantic dependency. That
remaining uncertainty is explicit and is not reported as proof that planning
quality is solved.

