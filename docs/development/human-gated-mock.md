# Human-Gated Mock

Lab Mode note: B4 models gate behavior for evaluation and visualization. It does not implement real human review or a production approval workflow.

B4 `human_gated_mock` models a deterministic review gate on top of `risk_aware` scheduling.

It is implemented as a wrapper over the scheduler output, not as a new scheduler policy. The underlying scheduler remains:

```txt
sequential_dag | parallel_naive | risk_aware
```

## Policy V0

- `medium`: allowed without gate.
- `high`: serialized by gate.
- `blocking`: simulated manual review required, then serialized as singleton tasks.
- `blocked`: represented in the schema for future work, not the default outcome.

## Traceability

The mock gate records:

- `human_gate_required`
- `human_gate_decision_recorded`
- `task_serialized_by_gate`
- `task_blocked_by_gate`
- `batch_modified_by_gate`

These events are auditable but do not represent real human review.
