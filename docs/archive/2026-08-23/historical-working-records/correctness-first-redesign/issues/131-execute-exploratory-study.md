# CF-131 — Execute the frozen exploratory study

- **Status:** `ready-for-agent`
- **Blocked by:** CF-130

## Outcome

Run the pre-registered study sequentially in fresh clones, preserving exact
ManyHands candidate/configuration and all success, failure, inconclusive, and
`not_run` evidence.

## Acceptance

- No system, oracle, prompt, goal, policy, or analysis change occurs inside a
  counted series.
- Each productive run has exact candidate SHA/tree, run/events, model/profile,
  token/time/cost observations, topology, attempts/repairs/integration, external
  oracle, browser evidence, and delivery receipt.
- Offline granularity comparisons replay the same frozen inputs and report
  `unknown` rather than invented zero values.
- An instrument defect invalidates the series; remediation occurs via TDD,
  GProd is rerun, and a new study identifier is opened.
