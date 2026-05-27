# Controlled Conflict Scenarios

Lab Mode note: these scenarios are designed to make risk and gate behavior visible in deterministic runs. They are not claims about real git conflicts or production code quality.

Phase 8 adds `benchmarks/conflict-v0`, a deterministic benchmark focused on conflict stress cases.

The scenarios are:

- `shared-schema-conflict`: two tasks modify `src/lib/db/schema.ts`.
- `public-api-contract-conflict`: one task produces a public approval API while another consumes it.
- `shared-auth-session-conflict`: two tasks touch the auth session boundary.
- `shared-test-fixture-conflict`: two tasks touch the same auth test fixture.
- `scope-violation-simulated`: the mock runner reports a forbidden path.

These scenarios are controlled fixtures. They are designed to make B2, B3 and B4 differ in scheduling, risk and gating behavior. They do not prove real merge conflicts or real code quality outcomes.

## Expected Differences

- B2 may batch risky ready tasks because it ignores risk.
- B3 uses `risk_aware` scheduling to avoid high-risk batches and block `blocking` pairs.
- B4 applies deterministic mock human gate decisions and serializes blocking work after mock review.
