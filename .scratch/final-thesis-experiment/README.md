# Final thesis experiment freeze

This directory is the durable custody record for the final thesis series.

- `freeze.json` fixes the runtime, model, oracle, target template and cell order.
- `cells/` fixes each prompt, acceptance criteria and baseline SHA.
- `runs/` will contain raw journals, snapshots, receipts and oracle results.

The rehearsal is excluded from the denominator. No cell is retried. Any failed
cell remains adverse evidence and cannot be relabelled as a successful
measurement.
