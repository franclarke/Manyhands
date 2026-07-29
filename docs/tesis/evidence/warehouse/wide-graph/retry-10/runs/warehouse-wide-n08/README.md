# retry-10 N=8

- Run: `d31b219b-4a92-4cef-a452-f58e3f27bda8`.
- Terminal lifecycle: `failed` during compiled plan review.
- Candidate/receipt/oracle: none / none / `not_run`.
- Frozen target remained at W1 `71f61c9efa222103ca2fb2f67692434ab493d75c`.

The planner reproduced the artifact/seam pair seen at N=4. The validator then
classified the non-ordering seam as an execution edge and rejected a false
`artifact_cycle`. The later architecture correction does not rewrite the
historical journal.

This is an independent adverse productive result at N=8. It does not establish
semantic correctness or incorrectness of an implementation because no attempt
or candidate commit existed.
