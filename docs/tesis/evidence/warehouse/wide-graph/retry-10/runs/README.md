# retry-10 successor series

All three cells used ManyHands `643a32d`, W1
`71f61c9efa222103ca2fb2f67692434ab493d75c`, condition C and homogeneous
`codex-cli/gpt-5.5/high` selections. They ran sequentially against three new
targets without executable changes between cells.

| Cell | Run | Terminal result | Candidate | Oracle |
|---|---|---|---|---|
| N=4 | `86ad7617-827e-401f-8215-13faf58933c0` | failed at compiled plan review | none | `not_run` |
| N=8 | `d31b219b-4a92-4cef-a452-f58e3f27bda8` | failed at compiled plan review | none | `not_run` |
| N=16 | `ad5dd07a-4181-4baf-9b23-ff6215a89c2b` | failed at compiled plan review | none | `not_run` |

Each planner independently emitted the same artifact/seam pair between the
analytics registry and deterministic study script. The implementation vigente
classified it as `artifact_cycle` and rejected each graph before execution. A
later architecture audit established that this was a validator false positive:
seams are compatibility metadata and do not close the execution DAG. No
delivery existed, so the rule
that at most one delivery receives the external oracle selected zero oracle
runs; every pre-candidate failure has an explicit `not_run` disposition.
