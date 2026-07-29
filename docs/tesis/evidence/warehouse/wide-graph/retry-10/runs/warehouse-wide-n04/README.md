# retry-10 N=4

- Run: `86ad7617-827e-401f-8215-13faf58933c0`.
- Terminal lifecycle: `failed` during compiled plan review.
- Candidate/receipt/oracle: none / none / `not_run`.
- Frozen target remained at W1 `71f61c9efa222103ca2fb2f67692434ab493d75c`.

The planner emitted `analytics-registry` as producer for the registry artifact
consumed by `study-wide-graph-script`, but also emitted the command seam in the
opposite direction, with the study script as producer and the registry as
consumer. Plan review classified the pair as a two-node `artifact_cycle` and
rejected the plan before execution. A later architecture audit established that
this was a validator false positive because the seam is non-ordering; the
journal remains the immutable record of the implementation that produced it.

This is preserved as an adverse productive result. It does not show that the
requested analytics are semantically wrong or that an implementation failed;
no implementation attempt or candidate commit existed.
