# Stage 5 / GP1 pre-registration

This directory freezes the two and only two initial GP1 cases before any
model-assisted Stage 5 output is generated.

- `manyhands.json` targets the exact ManyHands commit and RepositoryView.
- `express.json` targets the exact public Express commit and RepositoryView.
- Both cases use `codex-cli 0.146.0`, `gpt-5.6-sol`, reasoning effort `high`
  and profile `stage5-gp1-offline-v1`.
- One ephemeral, read-only Codex session is allowed per case.
- A repeat is forbidden unless a changed causal input is documented first.
- The topology oracle evaluates responsibilities, seams, ownership and proof;
  node count is observational only.
- The browser oracle evaluates the standalone read-only preview. It does not
  call the daemon or any privileged endpoint.
- The current planner is a comparator, never the truth oracle.

At pre-registration time there are no GP1 output, result or screenshot files.
Those artifacts must identify this pre-registration commit and the final code
candidate independently.
