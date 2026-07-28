# retry-10 N=8

- Run: `d31b219b-4a92-4cef-a452-f58e3f27bda8`.
- Terminal lifecycle: `failed` during compiled plan review.
- Candidate/receipt/oracle: none / none / `not_run`.
- Frozen target remained at W1 `71f61c9efa222103ca2fb2f67692434ab493d75c`.

The planner reproduced the two-node artifact cycle seen at N=4: the registry
artifact points from `analytics-registry` to `study-wide-graph-script`, while
the command seam points back from the study script to the registry. Plan review
rejected the graph before execution.

This is an independent adverse productive result at N=8. It does not establish
semantic correctness or incorrectness of an implementation because no attempt
or candidate commit existed.
