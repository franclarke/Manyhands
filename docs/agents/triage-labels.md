# Triage labels

| Skill role | Local status | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | The report still needs evaluation. |
| `needs-info` | `needs-info` | More information is required. |
| `ready-for-agent` | `ready-for-agent` | Fully specified; claimable when every declared blocker is closed. |
| `ready-for-human` | `ready-for-human` | Requires a human-only action or decision. |
| `wontfix` | `wontfix` | Deliberately not pursued. |
| n/a | `closed` | Acceptance criteria were verified and the work is complete. |

`ready-for-agent` describes specification quality, not current reachability.
Blocking edges remain authoritative: the working frontier contains only tickets
whose every `Blocked by` entry is `closed`.
