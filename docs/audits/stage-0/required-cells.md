# Stage 0 required real and adverse cell register

## Status and authority

This is the attributable G0 register for the real and adverse cells required by
the [correctness-first redesign plan](../../plans/2026-08-12-correctness-first-system-redesign.md#required-real-and-adverse-cells).
The architecture plan is normative; this register only records execution
status and evidence.

At G0 every cell is deliberately `not_run`. The redesign has not reached the
earliest gate that makes any of these cells meaningful, and the plan forbids
large live-model or wide-graph experiments before Stage 11. `not_run` is not a
pass, failure, or statement that the current implementation already satisfies
the oracle.

Allowed outcomes for a future attributed execution are `satisfied`, `failed`,
`inconclusive`, `not_run`, and `not_applicable`. A later outcome must bind the
exact candidate, environment, procedure/oracle revision, raw evidence, and gate
review. Adverse evidence is append-only: a later successful run does not erase
an earlier failure.

## Register at G0

| Cell | Earliest gate | Primary dimension | Normative required oracle | G0 status | Why it is not run at G0 |
|---|---|---|---|---|---|
| R0 | GLeaf | tiny single-package goal | exact acceptance and clean clone | `not_run` | Requires the trustworthy live-leaf path and exact candidate evidence introduced by GLeaf. |
| R1 | GI | cross-package seam | typed seam and parent integration evidence | `not_run` | Requires hierarchical integration contracts and parent-owned integration from GI. |
| R2 | GI | independent leaves | parallelism without resource conflict | `not_run` | Productive parallel selection is intentionally deferred until hierarchical integration is proven. |
| R3 | GI | sequential rewrite | explicit artifact/version chain | `not_run` | Requires versioned artifact requirements and the GI convergence path. |
| R4 | GP0 | ambiguous ownership | reject or human clarification | `not_run` | Requires the deterministic semantic-plan verifier from GP0. |
| R5 | G1/GP0 | missing proof authority | `needs_input`, never false success | `not_run` | G1 must first define proof authority and GP0 must prove the planner propagates the blocked outcome. |
| R6 | GA | generated/ignored output | explicit policy outcome | `not_run` | Requires exact Git-native artifact policy and evidence binding from GA. |
| R7 | GA | binary/mode/symlink/gitlink | exact manifest/materialization | `not_run` | Requires the object- and mode-preserving manifest round trip from GA. |
| R8 | GR | daemon restart | one owner and resumed projection | `not_run` | Requires productive lifecycle ownership to have moved to the daemon at GR. |
| R9 | GD1 | crash after physical success | reconciliation without duplicate | `not_run` | Requires durable effect intents, physical receipts, and crash injection from GD1. |
| R10 | GR/GLeaf | cancellation/timeout | no descendant process or ambiguous attempt | `not_run` | GR proves durable command ownership; GLeaf later proves real executor process custody. |
| R11 | GI | integration defect | lowest-authority repair | `not_run` | Requires classified composite failures and authority-directed repair at GI. |
| R12 | GDel | delivery target divergence | fail closed | `not_run` | Requires compare-and-swap delivery and destination reconciliation from GDel. |
| R13 | GA/GDel | stale human approval | invalidated after candidate change | `not_run` | GA introduces candidate-bound review and GDel proves it cannot authorize publication after staleness. |
| R14 | GLeaf | unsupported sandbox | blocked with diagnostic | `not_run` | Requires measured sandbox capabilities and fail-closed live dispatch at GLeaf. |
| R15 | GS | scoped decision pending | unrelated ready leaf continues | `not_run` | Requires the canonical readiness evaluator and productive frontier from GS. |
| R16 | GI | daemon crash during composite integration | one reconciled integration attempt/outcome | `not_run` | Requires both the durable effect protocol and first-class composite attempts available by GI. |
| R17 | GLeaf | leaf failure then repair | new causal input/fingerprint and immutable lineage | `not_run` | Requires live attempts, causal repair, and immutable fingerprints from GLeaf. |
| R18 | GProd | medium real application | independent topology, product and clean-clone oracles | `not_run` | Product evaluation is frozen until every prior gate passes and GProd eligibility is established. |
| R19 | GProd | larger meaningful hierarchy | useful boundaries/parallelism and bounded cost, not node count | `not_run` | Requires the completed architecture plus pre-registered topology, product, and cost oracles at GProd. |

## Update protocol

1. Keep the original G0 row and reason attributable; do not rewrite it as a
   later result.
2. Add an execution record under `docs/audits/stages/` or the approved evidence
   workspace, with a stable execution identifier.
3. Record candidate commit/tree, base, toolchain, model/executor profile,
   sandbox capability, environment, inputs, oracle revision, commands, raw
   outputs, and timestamps.
4. Evaluate the cell only with its normative oracle. A unit test name, process
   exit code, graph size, or absence of an observed error is insufficient.
5. Record `failed`, `inconclusive`, and `not_run` honestly. Use
   `not_applicable` only with a gate-reviewed rationale.
6. Link the execution from the gate record and the
   [transition ledger](transition-ledger.md). A cell counts toward a gate only
   on the exact handoff candidate reviewed for that gate.

The non-normative harness procedure is documented in the
[correctness-first execution runbook](../../agents/correctness-first-execution.md).
