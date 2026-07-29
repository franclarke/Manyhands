# retry-10 N=16

- Run: `ad5dd07a-4181-4baf-9b23-ff6215a89c2b`.
- Terminal lifecycle: `failed` during compiled plan review.
- Candidate/receipt/oracle: none / none / `not_run`.
- Frozen target remained at W1 `71f61c9efa222103ca2fb2f67692434ab493d75c`.

The planner reproduced the registry/study-script artifact/seam pair
independently at N=16. The validator treated the seam as ordering and rejected
a false `artifact_cycle` before execution. The productive, checksummed
granularity event is preserved at sequence 24 and summarized in
`granularity-assessment.json`; the full 20 assessments remain in the journal.

The root was selected as a split because a leaf was infeasible even though its
split advantage was `-0.4604`, below the unchanged `0.15` threshold. This is an
adverse measurement, not a reason to tune the formula or stimulus.
